import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { isStaff, type Role } from '@lettly/core';
import { withOrg } from './db/client.ts';
import { users } from './db/schema.ts';
import { env } from './env.ts';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  /** Set for landlord logins. */
  landlordId: string | null;
}

export type AppEnv = { Variables: { auth: AuthContext } };

const verifier = CognitoJwtVerifier.create({
  userPoolId: env.USER_POOL_ID,
  clientId: env.USER_POOL_CLIENT_ID,
  tokenUse: 'id',
});

/**
 * Verifies the Cognito ID token and loads the user. The organisation and role
 * come from token attributes that only the API (as an administrator) can set;
 * the app client is not allowed to write them.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HTTPException(401, { message: 'Sign in required' });

  let claims: Record<string, unknown>;
  try {
    claims = await verifier.verify(token);
  } catch {
    throw new HTTPException(401, { message: 'Session expired. Please sign in again.' });
  }

  const orgId = String(claims['custom:org_id'] ?? '');
  const sub = String(claims.sub ?? '');
  if (!orgId || !sub) throw new HTTPException(403, { message: 'Account is not linked to an organisation' });

  const [user] = await withOrg(orgId, (tx) => tx.select().from(users).where(eq(users.cognitoSub, sub)).limit(1));
  if (!user) throw new HTTPException(403, { message: 'Account not found' });

  c.set('auth', { userId: user.id, orgId, role: user.role, email: user.email, landlordId: user.landlordId });
  await next();
});

export function requireStaff(auth: AuthContext): void {
  if (!isStaff(auth.role)) throw new HTTPException(403, { message: 'Only agency staff can do this' });
}
