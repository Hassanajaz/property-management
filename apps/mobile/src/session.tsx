import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createApiClient,
  createDemoApi,
  identityFrom,
  refresh,
  type ApiClient,
  type AuthConfig,
  type Identity,
  type Role,
  type Session,
} from '@lettly/core';
import { sessionStore } from './platform';

/** Set in apps/mobile/.env from the `cdk deploy` outputs. */
export const authConfig: AuthConfig = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'eu-west-2',
  userPoolClientId: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? '',
};
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const STORE_KEY = 'lettly.session';

/**
 * Demo mode is on whenever no API address is configured. The app then runs on
 * sample data held in memory, with no backend and no real sign-in.
 */
export const DEMO_MODE = API_URL === '';

interface SessionValue {
  /** `undefined` while the stored session is being loaded. */
  identity: Identity | null | undefined;
  api: ApiClient;
  demo: boolean;
  signedIn: (session: Session) => Promise<void>;
  /** Demo mode only: enter the app as one of the sample people. */
  signInDemo: (role: Role) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(DEMO_MODE ? null : undefined);

  const store = useCallback(async (session: Session | null) => {
    sessionRef.current = session;
    setIdentity(session ? identityFrom(session) : null);
    if (DEMO_MODE) return;
    if (session) await sessionStore.set(STORE_KEY, JSON.stringify(session));
    else await sessionStore.remove(STORE_KEY);
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
    sessionStore
      .get(STORE_KEY)
      .then((raw) => store(raw ? (JSON.parse(raw) as Session) : null))
      .catch(() => store(null));
  }, [store]);

  const liveApi = useMemo(
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

  const role = identity?.role;
  const api = useMemo(() => (DEMO_MODE && role ? createDemoApi(role) : liveApi), [role, liveApi]);

  const value = useMemo<SessionValue>(
    () => ({
      identity,
      api,
      demo: DEMO_MODE,
      signedIn: (session) => store(session),
      signInDemo: (demoRole) => setIdentity({ userId: `demo-${demoRole}`, email: `${demoRole.replace('_', '.')}@demo.example`, orgId: 'demo', role: demoRole }),
      signOut: async () => {
        if (DEMO_MODE) setIdentity(null);
        else await store(null);
      },
    }),
    [identity, api, store],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
