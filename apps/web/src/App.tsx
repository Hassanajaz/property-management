import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  TENANT_STATUS_LABEL,
  canTransition,
  createApiClient,
  identityFrom,
  isLandlord,
  refresh,
  setNewPassword,
  signIn,
  type AuthConfig,
  type ComplianceItemDto,
  type Identity,
  type MaintenanceCategory,
  type MaintenanceRequestDto,
  type MaintenanceStatus,
  type MaintenanceUrgency,
  type Nation,
  type PropertyDto,
  type Session,
} from '@lettly/core';

const authConfig: AuthConfig = {
  region: import.meta.env.VITE_AWS_REGION ?? 'eu-west-2',
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
};
const API_URL: string = import.meta.env.VITE_API_URL ?? '';
const STORE_KEY = 'lettly.session';

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSessionState] = useState<Session | null>(loadSession);

  const setSession = useCallback((next: Session | null) => {
    setSessionState(next);
    try {
      if (next) sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* storage unavailable: stay signed in for this page only */
    }
  }, []);

  if (!session) return <SignIn onSignedIn={setSession} />;
  return <Workspace session={session} setSession={setSession} />;
}

// ------------------------------------------------------------------- sign-in
function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        onSignedIn(await setNewPassword(authConfig, email.trim(), password, challenge));
        return;
      }
      const result = await signIn(authConfig, email.trim(), password);
      if (result.kind === 'signed_in') onSignedIn(result.session);
      else {
        setChallenge(result.challengeSession);
        setPassword('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form onSubmit={submit} className="card">
        <h1>{challenge ? 'Choose a password' : 'Sign in'}</h1>
        <p className="muted">{challenge ? 'First sign-in: choose a password of at least 10 characters with a number.' : 'For landlords and tenants.'}</p>
        {!challenge && (
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <label>
          {challenge ? 'New password' : 'Password'}
          <input type="password" autoComplete={challenge ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : challenge ? 'Save and continue' : 'Sign in'}</button>
      </form>
    </main>
  );
}

// ----------------------------------------------------------------- workspace
function Workspace({ session, setSession }: { session: Session; setSession: (s: Session | null) => void }) {
  const identity: Identity = useMemo(() => identityFrom(session), [session]);
  const landlord = isLandlord(identity.role);
  const tenant = identity.role === 'tenant';

  const api = useMemo(() => {
    let current = session;
    return createApiClient(API_URL, async () => {
      if (Date.now() > current.expiresAt - 60_000) {
        try {
          current = await refresh(authConfig, current);
          setSession(current);
        } catch {
          setSession(null);
          throw new Error('Session expired. Please sign in again.');
        }
      }
      return current.idToken;
    });
    // The client keeps its own copy of the session; recreate only on sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.refreshToken]);

  const [repairs, setRepairs] = useState<MaintenanceRequestDto[]>([]);
  const [compliance, setCompliance] = useState<{ score: number; items: ComplianceItemDto[] } | null>(null);
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [r, p] = await Promise.all([api.listMaintenance(), api.listProperties()]);
      setRepairs(r);
      setProperties(p);
      if (!tenant) setCompliance(await api.listCompliance());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, [api, tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    }
  }

  return (
    <div className="shell">
      <header>
        <strong>Lettly</strong>
        <span className="muted">{identity.email} · {identity.role.replace('_', ' ')}</span>
        <button onClick={() => setSession(null)}>Sign out</button>
      </header>
      <main>
        {error && <p className="error" role="alert">{error}</p>}

        {compliance && (
          <section>
            <h2>Compliance <span className={`score ${compliance.score >= 90 ? 'good' : compliance.score >= 70 ? 'warn' : 'bad'}`}>{compliance.score} / 100</span></h2>
            <table>
              <thead>
                <tr><th>Status</th><th>Requirement</th><th>Property</th><th>Due</th>{landlord && <th />}</tr>
              </thead>
              <tbody>
                {compliance.items.map((item) => (
                  <tr key={item.id}>
                    <td><span className={`badge ${item.upcoming ? 'muted' : item.status}`}>{item.upcoming ? 'upcoming' : item.status.replace('_', ' ')}</span></td>
                    <td>{item.title}{item.severity === 'best_practice' && <span className="muted"> (best practice)</span>}</td>
                    <td>{item.propertyAddress ?? '—'}</td>
                    <td>{item.expiresOn ?? item.dueDate ?? '—'}</td>
                    {landlord && (
                      <td>
                        <button
                          onClick={() => {
                            const completedOn = window.prompt('Date completed or issued (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
                            if (completedOn) void act(() => api.completeComplianceItem(item.id, { completedOn }));
                          }}
                        >
                          Record
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {compliance.items.length === 0 && <tr><td colSpan={5} className="muted">Add a property to see what it needs.</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h2>{tenant ? 'Your repairs' : 'Repairs'}</h2>
          {tenant && <ReportForm onSubmit={(input) => act(() => api.reportMaintenance(input))} />}
          <table>
            <thead>
              <tr><th>Status</th><th>Issue</th><th>Property</th><th>Reported</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {repairs.map((repair) => (
                <tr key={repair.id}>
                  <td><span className={`badge ${repair.urgency === 'emergency' ? 'overdue' : 'due_soon'}`}>{TENANT_STATUS_LABEL[repair.status]}</span></td>
                  <td><strong>{repair.title}</strong><br /><span className="muted">{repair.description}</span></td>
                  <td>{repair.propertyAddress}</td>
                  <td>{new Date(repair.reportedAt).toLocaleDateString('en-GB')}{repair.urgency === 'emergency' && <strong> · Emergency</strong>}</td>
                  <td className="actions">
                    {NEXT_STEPS.filter((step) => canTransition(identity.role, repair.status, step.to)).map((step) => (
                      <button key={step.to} onClick={() => act(() => api.updateMaintenance(repair.id, { status: step.to }))}>{step.label}</button>
                    ))}
                    <button
                      onClick={() => {
                        const message = window.prompt('Message');
                        if (message) void act(() => api.updateMaintenance(repair.id, { message }));
                      }}
                    >
                      Message
                    </button>
                  </td>
                </tr>
              ))}
              {repairs.length === 0 && <tr><td colSpan={5} className="muted">No repairs reported.</td></tr>}
            </tbody>
          </table>
        </section>

        {landlord && (
          <section>
            <h2>Properties ({properties.length})</h2>
            <PropertyForm onSubmit={(input) => act(() => api.createProperty(input))} />
            <ul>
              {properties.map((p) => (
                <li key={p.id}>{p.addressLine1}, {p.town} {p.postcode} <span className="muted">· {p.nation.replace('_', ' ')}</span></li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

const NEXT_STEPS: { to: MaintenanceStatus; label: string }[] = [
  { to: 'triaged', label: 'Mark reviewed' },
  { to: 'scheduled', label: 'Book visit' },
  { to: 'in_progress', label: 'Start work' },
  { to: 'completed', label: 'Mark done' },
  { to: 'confirmed', label: 'Confirm fixed' },
  { to: 'reopened', label: 'Still a problem' },
  { to: 'cancelled', label: 'Cancel' },
];

// --------------------------------------------------------------------- forms
function ReportForm({ onSubmit }: { onSubmit: (input: { title: string; description: string; category: MaintenanceCategory; urgency: MaintenanceUrgency }) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('plumbing');
  const [urgency, setUrgency] = useState<MaintenanceUrgency>('routine');
  return (
    <form
      className="inline"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, description, category, urgency });
        setTitle('');
        setDescription('');
      }}
    >
      <label>What is the problem?<input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>
        Type
        <select value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
          {['plumbing', 'heating', 'electrical', 'appliance', 'damp_mould', 'structural', 'security', 'pest', 'garden_exterior', 'other'].map((c) => (
            <option key={c} value={c}>{c.replace('_', ' ')}</option>
          ))}
        </select>
      </label>
      <label>
        Urgency
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as MaintenanceUrgency)}>
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </select>
      </label>
      <label className="wide">Details<textarea required maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button className="primary">Report repair</button>
    </form>
  );
}

function PropertyForm({ onSubmit }: { onSubmit: (input: Omit<PropertyDto, 'id'>) => void }) {
  const [addressLine1, setAddressLine1] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const [nation, setNation] = useState<Nation>('england');
  const [hasGas, setHasGas] = useState(true);
  const [isHmo, setIsHmo] = useState(false);
  return (
    <form
      className="inline"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ addressLine1, addressLine2: null, town, postcode, nation, hasGas, isHmo });
        setAddressLine1('');
        setTown('');
        setPostcode('');
      }}
    >
      <label>Address<input required value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} /></label>
      <label>Town<input required value={town} onChange={(e) => setTown(e.target.value)} /></label>
      <label>Postcode<input required minLength={5} maxLength={8} value={postcode} onChange={(e) => setPostcode(e.target.value)} /></label>
      <label>
        Nation
        <select value={nation} onChange={(e) => setNation(e.target.value as Nation)}>
          <option value="england">England</option>
          <option value="wales">Wales</option>
          <option value="scotland">Scotland</option>
          <option value="northern_ireland">Northern Ireland</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={hasGas} onChange={(e) => setHasGas(e.target.checked)} /> Has gas</label>
      <label className="check"><input type="checkbox" checked={isHmo} onChange={(e) => setIsHmo(e.target.checked)} /> HMO</label>
      <button className="primary">Add property</button>
    </form>
  );
}
