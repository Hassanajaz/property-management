import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApiClient, identityFrom, refresh, type ApiClient, type AuthConfig, type Identity, type Session } from '@lettly/core';

/** Set in apps/mobile/.env from the `cdk deploy` outputs. */
export const authConfig: AuthConfig = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'eu-west-2',
  userPoolClientId: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? '',
};
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const STORE_KEY = 'lettly.session';

interface SessionValue {
  /** `undefined` while the stored session is being loaded. */
  identity: Identity | null | undefined;
  api: ApiClient;
  signedIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);

  const store = useCallback(async (session: Session | null) => {
    sessionRef.current = session;
    setIdentity(session ? identityFrom(session) : null);
    if (session) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => store(raw ? (JSON.parse(raw) as Session) : null))
      .catch(() => store(null));
  }, [store]);

  const api = useMemo(
    () =>
      createApiClient(API_URL, async () => {
        let session = sessionRef.current;
        if (!session) throw new Error('Not signed in');
        // Renew the token a minute before it expires.
        if (Date.now() > session.expiresAt - 60_000) {
          try {
            session = await refresh(authConfig, session);
            await store(session);
          } catch {
            await store(null);
            throw new Error('Session expired. Please sign in again.');
          }
        }
        return session.idToken;
      }),
    [store],
  );

  const value = useMemo<SessionValue>(
    () => ({ identity, api, signedIn: (session) => store(session), signOut: () => store(null) }),
    [identity, api, store],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
