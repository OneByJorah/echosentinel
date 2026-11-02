import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loader2, LogIn, Terminal } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { errText } from './hooks/useToast';
import { Shell } from './components/Shell';
import { NowPlaying } from './components/NowPlaying';
import { LogoMark } from './components/Logo';
import LiveAudio from './pages/LiveAudio';

const Recordings = lazy(() => import('./pages/Recordings'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const Transcripts = lazy(() => import('./pages/Transcripts'));
const Channels = lazy(() => import('./pages/Channels'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Automation = lazy(() => import('./pages/Automation'));
const SystemPage = lazy(() => import('./pages/SystemPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="panel w-full max-w-sm p-6">{children}</div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex flex-col items-center gap-2 text-center">
      <LogoMark className="h-14 w-14" />
      <h1 className="text-2xl font-bold tracking-tight">EchoSentinel</h1>
      <p className="text-xs text-bone-muted">Audio Surveillance • AI Recognition • Transcription</p>
    </div>
  );
}

function Login() {
  const { login, meta } = useAuth();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(username, password);
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <Brand />
      {meta?.demo_mode && <p className="mb-4 rounded-lg bg-amber/15 px-3 py-2 text-center text-xs font-semibold text-amber">Demo mode — synthetic data only</p>}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="u" className="label">
            Username
          </label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} required autoFocus />
        </div>
        <div>
          <label htmlFor="p" className="label">
            Password
          </label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />
        </div>
        {err && (
          <p className="text-sm text-bad" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full py-2" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
        </button>
      </form>
    </Centered>
  );
}

function Setup() {
  return (
    <Centered>
      <Brand />
      <h2 className="mb-2 text-base font-semibold">Create the first administrator</h2>
      <p className="mb-3 text-sm text-bone-muted">For security, accounts can't be created from the browser until one exists. On the server, run:</p>
      <pre className="panel-inset num mb-3 overflow-x-auto p-3 text-[12.5px] text-amber">
        <Terminal className="mb-1 h-4 w-4 text-bone-muted" />
        echosentinel create-user --role admin
      </pre>
      <p className="text-sm text-bone-muted">Then reload this page and sign in.</p>
      <button type="button" className="btn mt-4 w-full" onClick={() => location.reload()}>
        Reload
      </button>
    </Centered>
  );
}

function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-bone-muted">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
    </div>
  );
}

export default function App() {
  const { meta, metaError, user, loading } = useAuth();
  if (metaError && !meta)
    return (
      <Centered>
        <Brand />
        <p className="text-center text-sm text-bad">Can't reach the EchoSentinel server. Check that the service is running, then reload.</p>
        <button type="button" className="btn mt-4 w-full" onClick={() => location.reload()}>
          Reload
        </button>
      </Centered>
    );
  if (!meta || loading) return <Loading />;
  if (meta.setup_required) return <Setup />;
  if (!user) return <Login />;
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<LiveAudio />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/transcripts" element={<Transcripts />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<p className="p-6 text-bone-muted">Page not found.</p>} />
        </Routes>
      </Suspense>
      <NowPlaying />
    </Shell>
  );
}
