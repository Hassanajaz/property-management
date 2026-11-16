/**
 * Local server: the whole app backend running on your own computer, with the
 * data in a single SQLite database file. No cloud account and no packages to
 * install: it uses only what ships with Node.js (version 22.13 or later).
 *
 * Each landlord account's data is kept as one document, loaded into memory
 * and saved after every change. That is simple and fast for one landlord or a
 * handful; it is meant for testing and personal use, not for hosting many
 * customers. The AWS design in infra/ is the route to a hosted service.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, createStoreApi, emptyStore, seedSampleStore, type ApiClient, type DemoStore, type Role, type Viewer } from '../../../packages/core/src/index.ts';

interface UserRow {
  id: string;
  account_id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  salt: string;
  tenancy_ids: string;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_FILE_BYTES = 15_000_000;
const SESSION_DAYS = 30;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, accountId: user.account_id };
}

export function startServer(options: { dataDir: string; port: number; host?: string }): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const filesDir = join(options.dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });
  const db = new DatabaseSync(join(options.dataDir, 'lettly.db'));
  db.exec(`
    create table if not exists accounts (id text primary key, name text not null, data text not null, created_at text not null);
    create table if not exists users (
      id text primary key, account_id text not null references accounts(id), email text not null unique, name text not null,
      role text not null, password_hash text not null, salt text not null, tenancy_ids text not null default '[]', created_at text not null
    );
    create table if not exists sessions (token text primary key, user_id text not null references users(id), created_at text not null);
    create table if not exists files (id text primary key, account_id text not null, content_type text not null, upload_token text, stored integer not null default 0);
  `);

  // Account data is held in memory once loaded, and written back after each change.
  const stores = new Map<string, { store: DemoStore; saved: string }>();
  function loadStore(accountId: string): DemoStore {
    const cached = stores.get(accountId);
    if (cached) return cached.store;
    const row = db.prepare('select data from accounts where id = ?').get(accountId) as { data: string } | undefined;
    if (!row) throw new HttpError(404, 'Account not found');
    stores.set(accountId, { store: JSON.parse(row.data) as DemoStore, saved: row.data });
    return stores.get(accountId)!.store;
  }
  function saveStore(accountId: string): void {
    const entry = stores.get(accountId);
    if (!entry) return;
    const data = JSON.stringify(entry.store);
    if (data === entry.saved) return;
    db.prepare('update accounts set data = ? where id = ?').run(data, accountId);
    entry.saved = data;
  }

  function newSession(user: UserRow) {
    const token = randomBytes(32).toString('hex');
    db.prepare('insert into sessions (token, user_id, created_at) values (?, ?, ?)').run(token, user.id, new Date().toISOString());
    return { token, user: publicUser(user) };
  }

  function userFromRequest(req: IncomingMessage): UserRow {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Sign in required');
    const session = db.prepare('select user_id, created_at from sessions where token = ?').get(token) as { user_id: string; created_at: string } | undefined;
    if (!session || Date.now() - Date.parse(session.created_at) > SESSION_DAYS * 86_400_000) throw new HttpError(401, 'Session expired. Please sign in again.');
    const user = db.prepare('select * from users where id = ?').get(session.user_id) as UserRow | undefined;
    if (!user) throw new HttpError(401, 'Account not found');
    return user;
  }

  function viewerFor(user: UserRow): Viewer {
    return user.role === 'landlord' ? { role: 'landlord' } : { role: 'tenant', tenancyIds: JSON.parse(user.tenancy_ids) as string[] };
  }

  function createUser(input: { accountId: string; email: string; name: string; role: Role; password: string; tenancyIds?: string[] }): UserRow {
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    if (input.password.length < 8) throw new HttpError(400, 'Choose a password of at least 8 characters');
    if (db.prepare('select 1 from users where email = ?').get(email)) throw new HttpError(409, 'There is already an account with that email address');
    const salt = randomBytes(16).toString('hex');
    const id = randomBytes(12).toString('hex');
    db.prepare('insert into users (id, account_id, email, name, role, password_hash, salt, tenancy_ids, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, input.accountId, email, input.name.trim(), input.role, hashPassword(input.password, salt), salt, JSON.stringify(input.tenancyIds ?? []), new Date().toISOString(),
    );
    return db.prepare('select * from users where id = ?').get(id) as UserRow;
  }

  async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new HttpError(413, 'That is too large to upload');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const body = await readBody(req, MAX_BODY_BYTES);
    try {
      const parsed: unknown = body.length ? JSON.parse(body.toString('utf8')) : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'The request was not valid JSON');
    }
  }

  const text = (value: unknown): string => (typeof value === 'string' ? value : '');

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/health') {
      const { n } = db.prepare('select count(*) as n from accounts').get() as { n: number };
      return send(200, { ok: true, accounts: n });
    }

    // ------------------------------------------------------------- accounts
    if (req.method === 'POST' && url.pathname === '/auth/sign-up') {
      const body = await readJson(req);
      if (!text(body.name).trim()) throw new HttpError(400, 'Enter your name');
      const accountId = randomBytes(12).toString('hex');
      const store = body.sample === true ? seedSampleStore() : emptyStore();
      db.exec('begin');
      try {
        db.prepare('insert into accounts (id, name, data, created_at) values (?, ?, ?, ?)').run(accountId, text(body.name).trim(), JSON.stringify(store), new Date().toISOString());
        const user = createUser({ accountId, email: text(body.email), name: text(body.name), role: 'landlord', password: text(body.password) });
        db.exec('commit');
        return send(201, newSession(user));
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    }

    if (req.method === 'POST' && url.pathname === '/auth/sign-in') {
      const body = await readJson(req);
      const user = db.prepare('select * from users where email = ?').get(text(body.email).trim().toLowerCase()) as UserRow | undefined;
      const given = Buffer.from(hashPassword(text(body.password), user?.salt ?? 'no-such-user'), 'hex');
      const expected = Buffer.from(user?.password_hash ?? '00'.repeat(64), 'hex');
      if (!user || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Incorrect email or password.');
      return send(200, newSession(user));
    }

    if (req.method === 'POST' && url.pathname === '/auth/password') {
      const user = userFromRequest(req);
      const body = await readJson(req);
      if (text(body.newPassword).length < 8) throw new HttpError(400, 'Choose a password of at least 8 characters');
      const salt = randomBytes(16).toString('hex');
      db.prepare('update users set password_hash = ?, salt = ? where id = ?').run(hashPassword(text(body.newPassword), salt), salt, user.id);
      return send(200, { ok: true });
    }

    // The landlord gives a tenant a sign-in for one of their tenancies.
    if (req.method === 'POST' && url.pathname === '/auth/invite') {
      const user = userFromRequest(req);
      if (user.role !== 'landlord') throw new HttpError(403, 'Only the landlord can do this');
      const body = await readJson(req);
      const tenancy = loadStore(user.account_id).tenancies.find((t) => t.id === text(body.tenancyId));
      if (!tenancy) throw new HttpError(404, 'Tenancy not found');
      const email = text(body.email).trim().toLowerCase();
      const existing = db.prepare('select * from users where email = ?').get(email) as UserRow | undefined;
      if (existing) {
        if (existing.account_id !== user.account_id || existing.role !== 'tenant') throw new HttpError(409, 'That email address is already used by another account');
        const ids = new Set(JSON.parse(existing.tenancy_ids) as string[]);
        ids.add(tenancy.id);
        db.prepare('update users set tenancy_ids = ? where id = ?').run(JSON.stringify([...ids]), existing.id);
        return send(200, { email, temporaryPassword: null });
      }
      // No email is sent from a local server: the landlord passes this password on.
      const temporaryPassword = randomBytes(6).toString('base64url');
      createUser({ accountId: user.account_id, email, name: text(body.name) || email, role: 'tenant', password: temporaryPassword, tenancyIds: [tenancy.id] });
      return send(201, { email, temporaryPassword });
    }

    // ---------------------------------------------------------------- files
    const fileMatch = /^\/files\/([\w-]+)$/.exec(url.pathname);
    if (fileMatch && req.method === 'PUT') {
      const row = db.prepare('select * from files where id = ?').get(fileMatch[1]!) as { id: string; upload_token: string | null } | undefined;
      if (!row || !row.upload_token || row.upload_token !== url.searchParams.get('t')) throw new HttpError(403, 'This upload link is not valid');
      writeFileSync(join(filesDir, row.id), await readBody(req, MAX_FILE_BYTES));
      db.prepare('update files set stored = 1, upload_token = null where id = ?').run(row.id);
      res.writeHead(200);
      return void res.end();
    }
    if (fileMatch && req.method === 'GET') {
      const session = db.prepare('select user_id from sessions where token = ?').get(url.searchParams.get('t') ?? '') as { user_id: string } | undefined;
      const user = session ? (db.prepare('select * from users where id = ?').get(session.user_id) as UserRow | undefined) : undefined;
      if (!user) throw new HttpError(401, 'Sign in required');
      const row = db.prepare('select * from files where id = ? and account_id = ?').get(fileMatch[1]!, user.account_id) as { id: string; content_type: string; stored: number } | undefined;
      const visible = (await createStoreApi(loadStore(user.account_id), viewerFor(user)).listDocuments()).some((d) => d.id === fileMatch[1]);
      const path = join(filesDir, fileMatch[1]!);
      if (!row || !row.stored || !visible || !existsSync(path)) throw new HttpError(404, 'File not found');
      res.writeHead(200, { 'Content-Type': row.content_type, 'Content-Disposition': 'inline' });
      return void res.end(readFileSync(path));
    }

    // ------------------------------------------------------------------ app
    // Every app action arrives here as { method, args } and runs against the account's data.
    if (req.method === 'POST' && url.pathname === '/rpc') {
      const user = userFromRequest(req);
      const body = await readJson(req);
      const method = text(body.method);
      const args = Array.isArray(body.args) ? body.args : [];
      const api = createStoreApi(loadStore(user.account_id), viewerFor(user)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      if (!Object.hasOwn(api, method) || typeof api[method] !== 'function') throw new HttpError(404, `Unknown action: ${method}`);
      const base = `${url.protocol}//${url.host}`;

      let result: unknown;
      if (method === 'requestUpload') {
        const input = (args[0] ?? {}) as { contentType?: string };
        const ticket = (await api.requestUpload!(...args)) as { documentId: string };
        const uploadToken = randomBytes(16).toString('hex');
        db.prepare('insert into files (id, account_id, content_type, upload_token) values (?, ?, ?, ?)').run(ticket.documentId, user.account_id, text(input.contentType) || 'application/octet-stream', uploadToken);
        result = { documentId: ticket.documentId, uploadUrl: `${base}/files/${ticket.documentId}?t=${uploadToken}` };
      } else if (method === 'downloadUrl') {
        const documentId = text(args[0]);
        const visible = (await (api as unknown as ApiClient).listDocuments()).some((d) => d.id === documentId);
        const row = db.prepare('select stored from files where id = ? and account_id = ?').get(documentId, user.account_id) as { stored: number } | undefined;
        if (!visible || !row?.stored) throw new HttpError(404, 'There is no file stored for this document');
        result = { url: `${base}/files/${documentId}?t=${(req.headers.authorization ?? '').slice(7)}` };
      } else {
        result = await api[method]!(...args);
      }
      saveStore(user.account_id);
      return send(200, { result: result ?? null });
    }

    throw new HttpError(404, 'Not found');
  }

  const server = createServer((req, res) => {
    // The app in a browser is served from a different address, so allow it to call this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return void res.end();
    }
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError || error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong. Please try again.' : (error as Error).message }));
    });
  });

  return new Promise((resolve) => {
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : options.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              db.close();
              done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}
