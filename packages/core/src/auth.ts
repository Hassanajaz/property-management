import type { Role } from './types.ts';

/**
 * Sign-in against Amazon Cognito using plain fetch, so the same code runs in
 * the web app and the Expo mobile app with no native modules.
 *
 * Landlords and tenants use this one sign-in. Invited tenants arrive
 * with a temporary password and are asked to choose a new one.
 */
export interface AuthConfig {
  region: string;
  userPoolClientId: string;
}

export interface Session {
  idToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the ID token expires. */
  expiresAt: number;
}

export interface Identity {
  userId: string;
  email: string;
  orgId: string;
  role: Role;
}

export type SignInResult =
  | { kind: 'signed_in'; session: Session }
  | { kind: 'new_password_required'; challengeSession: string; email: string };

async function cognito(config: AuthConfig, target: string, body: unknown): Promise<any> {
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    const type = String(json.__type ?? '');
    if (type.includes('NotAuthorized') || type.includes('UserNotFound')) {
      throw new Error('Incorrect email or password.');
    }
    throw new Error(json.message ?? 'Sign-in failed. Please try again.');
  }
  return json;
}

function toSession(result: any, existingRefreshToken?: string): Session {
  return {
    idToken: result.IdToken,
    refreshToken: result.RefreshToken ?? existingRefreshToken ?? '',
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  };
}

export async function signIn(config: AuthConfig, email: string, password: string): Promise<SignInResult> {
  const json = await cognito(config, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.userPoolClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (json.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return { kind: 'new_password_required', challengeSession: json.Session, email };
  }
  if (json.ChallengeName) {
    throw new Error(`This account needs an extra sign-in step that the app does not support yet (${json.ChallengeName}).`);
  }
  return { kind: 'signed_in', session: toSession(json.AuthenticationResult) };
}

/** Completes a first sign-in for an invited user by setting their own password. */
export async function setNewPassword(
  config: AuthConfig,
  email: string,
  newPassword: string,
  challengeSession: string,
): Promise<Session> {
  const json = await cognito(config, 'RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: config.userPoolClientId,
    Session: challengeSession,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  return toSession(json.AuthenticationResult);
}

export async function refresh(config: AuthConfig, session: Session): Promise<Session> {
  const json = await cognito(config, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: config.userPoolClientId,
    AuthParameters: { REFRESH_TOKEN: session.refreshToken },
  });
  return toSession(json.AuthenticationResult, session.refreshToken);
}

/**
 * Reads who the user is from the ID token, for showing the right screens.
 * This does NOT verify the token: the API verifies it on every request.
 */
export function identityFrom(session: Session): Identity {
  const payload = session.idToken.split('.')[1] ?? '';
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
  const claims = JSON.parse(atob(base64));
  return {
    userId: claims.sub,
    email: claims.email,
    orgId: claims['custom:org_id'],
    role: claims['custom:role'] as Role,
  };
}
