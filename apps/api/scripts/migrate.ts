/**
 * Applies database migrations, then (re)applies row-level security.
 * Run from apps/api with the admin secret:  npm run db:migrate
 *
 * Requires: DB_NAME, DB_CLUSTER_ARN, DB_ADMIN_SECRET_ARN, DB_APP_SECRET_ARN
 * (all printed by `cdk deploy`) and AWS credentials in the environment.
 *
 * Two database users are used on purpose:
 *  - the admin user owns the tables and runs migrations;
 *  - `app_user` is what the API signs in as. It owns nothing, so row-level
 *    security always applies to it.
 */
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getTableName, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/aws-data-api/pg';
import { migrate } from 'drizzle-orm/aws-data-api/pg/migrator';
import { ORG_SCOPED_TABLES } from '../src/db/schema.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const db = drizzle(new RDSDataClient({}), {
  database: required('DB_NAME'),
  resourceArn: required('DB_CLUSTER_ARN'),
  secretArn: required('DB_ADMIN_SECRET_ARN'),
});

await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied');

// Create or update the API's database user from its secret.
const secret = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: required('DB_APP_SECRET_ARN') }));
const { password } = JSON.parse(secret.SecretString ?? '{}') as { password?: string };
if (!password || !/^[A-Za-z0-9]+$/.test(password)) throw new Error('App user secret must hold an alphanumeric password');

const [existing] = (await db.execute(sql`select 1 from pg_roles where rolname = 'app_user'`)).rows ?? [];
await db.execute(sql.raw(`${existing ? 'alter' : 'create'} role app_user login password '${password}'`));
await db.execute(sql.raw('grant usage on schema public to app_user'));
await db.execute(sql.raw('grant select, insert, update, delete on all tables in schema public to app_user'));
await db.execute(sql.raw('alter default privileges in schema public grant select, insert, update, delete on tables to app_user'));

// Row-level security: a row is visible only when its org_id matches the
// organisation set for the current transaction (see withOrg in src/db/client.ts).
for (const table of ORG_SCOPED_TABLES) {
  const name = getTableName(table);
  await db.execute(sql.raw(`alter table "${name}" enable row level security`));
  // Not FORCEd: the admin (table owner) bypasses it for migrations and account
  // set-up scripts. The API never signs in as the admin.
  await db.execute(sql.raw(`drop policy if exists org_isolation on "${name}"`));
  await db.execute(
    sql.raw(
      `create policy org_isolation on "${name}" to app_user ` +
        `using (org_id = nullif(current_setting('app.org_id', true), '')::uuid) ` +
        `with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)`,
    ),
  );
}
// `organisations` has no org_id column: restrict it by its own id.
await db.execute(sql.raw('alter table "organisations" enable row level security'));
await db.execute(sql.raw('drop policy if exists org_isolation on "organisations"'));
await db.execute(
  sql.raw(`create policy org_isolation on "organisations" to app_user using (id = nullif(current_setting('app.org_id', true), '')::uuid)`),
);

console.log(`Row-level security applied to ${ORG_SCOPED_TABLES.length + 1} tables`);
