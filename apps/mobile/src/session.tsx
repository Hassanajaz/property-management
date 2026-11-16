import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createApiClient,
  createDemoApi,
  createLocalClient,
  identityFrom,
  localInviteTenant,
  localSignIn,
  localSignUp,
  refresh,
  type ApiClient,
  type AuthConfig,
  type Identity,
  type LocalSession,
  type Role,
  type Session,
} from '@lettly/core';
import { sessionStore } from './platform';

/** Set in apps/mobile/.env. */
export const authConfig: AuthConfig = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'eu-west-2',
  userPoolClientId: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? '',
};
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const STORE_KEY = 'lettly.session';

/**
 * How the app gets its data:
 *  - demo:  no server address set. Sample data held in memory, nothing saved.
 *  - local: a server address is set. Real accounts and saved data on the local
 *           server (apps/server), signed in with an email and password.
 *  - cloud: the AWS backend, signed in through Amazon Cognito.
 */
export type Mode = 'demo' | 'local' | 'cloud';
export const MODE: Mode = API_URL === '' ? 'demo' : process.env.EXPO_PUBLIC_AUTH === 'cognito' ? 'cloud' : 'local';

interface Stored {
  cloud?: Session;
  local?: LocalSession;
}

interface SessionValue {
  /** `undefined` while the stored session is being loaded. */
  identity: Identity | null | undefined;
  api: ApiClient;
  mode: Mode;
  demo: boolean;
  /** Cloud mode: finish sign-in with a Cognito session. */
  signedIn: (session: Session) => Promise<void>;
  /** Demo mode: enter the app as one of the sample people. */
  signInDemo: (role: Role) => void;
  /** Local mode: sign in, or create a landlord account. */
  signInLocal: (email: string, password: string) => Promise<void>;
  signUpLocal: (input: { name: string; email: string; password: string; sample: boolean }) => Promise<void>;
  /** Local mode: give a tenant a sign-in. Returns the temporary password to pass on, or null if they already had one. */
  inviteTenant: (input: { tenancyId: string; name: string; email: string }) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function identityOf(stored: Stored | null): Identity | null {
  if (stored?.local) {
    const { user } = stored.local;
    return { userId: user.id, email: user.email, orgId: user.accountId, role: user.role };
  }
  return stored?.cloud ? identityFrom(stored.cloud) : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const storedRef = useRef<Stored | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(MODE === 'demo' ? null : undefined);

  const store = useCallback(async (next: Stored | null) => {
    storedRef.current = next;
    setIdentity(identityOf(next));
    if (MODE === 'demo') return;
    if (next) await sessionStore.set(STORE_KEY, JSON.stringify(next));
    else await sessionStore.remove(STORE_KEY);
  }, []);

  useEffect(() => {
    if (MODE === 'demo') return;
    sessionStore
      .get(STORE_KEY)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Stored) : null;
        // Ignore a session saved by a different mode.
        return store(saved && (MODE === 'local' ? saved.local : saved.cloud) ? saved : null);
      })
      .catch(() => store(null));
  }, [store]);

  const liveApi = useMemo<ApiClient>(() => {
    if (MODE === 'local') return createLocalClient(API_URL, () => storedRef.current?.local?.token ?? null);
    return createApiClient(API_URL, async () => {
      let session = storedRef.current?.cloud;
      if (!session) throw new Error('Not signed in');
      // Renew the token a minute before it expires.
      if (Date.now() > session.expiresAt - 60_000) {
        try {
          session = await refresh(authConfig, session);
          await store({ cloud: session });
        } catch {
          await store(null);
          throw new Error('Session expired. Please sign in again.');
        }
      }
      return session.idToken;
    });
  }, [store]);

  const role = identity?.role;
  const api = useMemo(() => (MODE === 'demo' && role ? createDemoApi(role) : liveApi), [role, liveApi]);

  const value = useMemo<SessionValue>(
    () => ({
      identity,
      api,
      mode: MODE,
      demo: MODE === 'demo',
      signedIn: (session) => store({ cloud: session }),
      signInDemo: (demoRole) => setIdentity({ userId: `demo-${demoRole}`, email: `${demoRole}@demo.example`, orgId: 'demo', role: demoRole }),
      signInLocal: async (email, password) => store({ local: await localSignIn(API_URL, email, password) }),
      signUpLocal: async (input) => store({ local: await localSignUp(API_URL, input) }),
      inviteTenant: async (input) => {
        const token = storedRef.current?.local?.token;
        if (!token) throw new Error('Sign in required');
        return (await localInviteTenant(API_URL, token, input)).temporaryPassword;
      },
      signOut: async () => {
        if (MODE === 'demo') setIdentity(null);
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
