import { ApiError, type ApiClient } from './client.ts';
import type { Role } from './types.ts';

/**
 * Client for the local server (apps/server): sign-in with an email and
 * password, and every app action sent as one kind of request.
 */
export interface LocalUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  accountId: string;
}

export interface LocalSession {
  token: string;
  user: LocalUser;
}

async function post<T>(baseUrl: string, path: string, body: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check it is running and that this device is on the same Wi-Fi.');
  }
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, json.error ?? `Request failed (${response.status})`);
  return json as T;
}

export function localSignUp(baseUrl: string, input: { name: string; email: string; password: string; sample: boolean }): Promise<LocalSession> {
  return post(baseUrl, '/auth/sign-up', input);
}

export function localSignIn(baseUrl: string, email: string, password: string): Promise<LocalSession> {
  return post(baseUrl, '/auth/sign-in', { email, password });
}

/** The landlord gives a tenant a sign-in. Returns a temporary password to pass on (null if they already had a sign-in). */
export function localInviteTenant(
  baseUrl: string,
  token: string,
  input: { tenancyId: string; name: string; email: string },
): Promise<{ email: string; temporaryPassword: string | null }> {
  return post(baseUrl, '/auth/invite', input, token);
}

export function localChangePassword(baseUrl: string, token: string, newPassword: string): Promise<{ ok: true }> {
  return post(baseUrl, '/auth/password', { newPassword }, token);
}

/** The full app API, with every call sent to the local server. */
export function createLocalClient(baseUrl: string, getToken: () => string | null): ApiClient {
  return new Proxy({} as ApiClient, {
    get(_target, method) {
      // `then` must stay undefined, or awaiting the client would treat it as a promise.
      if (typeof method !== 'string' || method === 'then') return undefined;
      return async (...args: unknown[]) => {
        const token = getToken();
        if (!token) throw new ApiError(401, 'Sign in required');
        const { result } = await post<{ result: unknown }>(baseUrl, '/rpc', { method, args }, token);
        return result;
      };
    },
  });
}
