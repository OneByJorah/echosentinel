import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AudioLines,
  Bell,
  BrainCircuit,
  ChevronDown,
  Cpu,
  FileText,
  HardDrive,
  Keyboard,
  LogOut,
  Menu,
  MemoryStick,
  PlayCircle,
  Radio,
  Settings as SettingsIcon,
  BarChart3,
  Zap,
  Server,
  Siren,
  X,
  Gauge,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLive } from '../hooks/useLive';
import { useChannels, useEventStats, useMetrics, usePipeline } from '../hooks/queries';
import { live } from '../lib/live';
import { bytes, clock } from '../lib/format';
import { LogoMark, Wordmark } from './Logo';
import { Dialog, Dot, cx, serviceLabel, serviceTone, Skeleton } from './ui';

export const NAV = [
  { to: '/', label: 'Live Audio', icon: AudioLines, key: 'l' },
  { to: '/recordings', label: 'Recordings', icon: PlayCircle, key: 'r' },
  { to: '/events', label: 'AI Events', icon: Siren, key: 'e' },
  { to: '/transcripts', label: 'Transcripts', icon: FileText, key: 't' },
  { to: '/channels', label: 'Channels', icon: Radio, key: 'c' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, key: 'a' },
  { to: '/automation', label: 'Automation', icon: Zap, key: 'u' },
  { to: '/system', label: 'System', icon: Server, key: 's' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, key: ',' },
] as const;

function NavItems({ onNavigate, unreviewed }: { onNavigate?: () => void; unreviewed: number }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((n) => (
        <li key={n.to}>
          <NavLink
            to={n.to}
            end={n.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] font-medium transition-colors',
                isActive ? 'bg-amber text-ink shadow-[0_0_20px_rgba(255,179,0,0.25)]' : 'text-bone-muted hover:bg-ink-700 hover:text-bone',
              )
            }
          >
            <n.icon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="flex-1">{n.label}</span>
            {n.to === '/events' && unreviewed > 0 && (
              <span className="num min-w-[22px] rounded-full bg-bad px-1.5 py-0.5 text-center text-[11px] font-bold text-white" aria-label={`${unreviewed} unreviewed events`}>
                {unreviewed > 99 ? '99+' : unreviewed}
              </span>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SidebarFooter() {
  const pipeline = usePipeline();
  const meta = useAuth().meta;
  const healthy = pipeline && pipeline.recorder.state !== 'stopped' && pipeline.stt.state !== 'error' && pipeline.classifier.state !== 'error';
  return (
    <div className="mt-auto space-y-3 px-2 pt-6 text-center">
      <div className="flex items-center justify-center gap-2 text-xs text-bone-dim">
        <LogoMark className="h-5 w-5" />
        <span>by OneByJorah</span>
      </div>
      <div className="flex items-center justify-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1.5 text-xs">
        {pipeline ? <Dot tone={healthy ? 'ok' : 'warn'} /> : <Dot tone="muted" />}
        <span className={healthy ? 'text-ok' : pipeline ? 'text-warn' : 'text-bone-muted'}>{pipeline ? (healthy ? 'System healthy' : 'Needs attention') : 'Checking…'}</span>
      </div>
      <div className="num text-[11px] text-bone-dim">EchoSentinel v{meta?.version ?? '—'}</div>
    </div>
  );
}

function Stat({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800/80 px-3 py-1.5" title={label}>
      <span className="text-bone-muted" aria-hidden>
        {icon}
      </span>
      <div className="leading-tight">
        <div className="sr-only">{label}</div>
        <div className={cx('num text-[13px] font-medium', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
        {sub && <div className="text-[11px] text-bone-muted">{sub}</div>}
      </div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const notes = useLive((s) => s.notifications);
  const stats = useEventStats();
  const unread = notes.filter((n) => !n.read).length;
  const unreviewed = stats.data?.unreviewed ?? 0;
  const total = unread + unreviewed;
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-icon relative h-10 w-10 border-transparent bg-transparent"
        aria-label={`Notifications${total ? `, ${total} new` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          live.markNotificationsRead();
        }}
      >
        <Bell className="h-5 w-5" />
        {total > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-[10.5px] font-bold leading-[18px] text-white">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="panel absolute right-0 top-12 z-40 w-[min(92vw,360px)] p-2">
          {unreviewed > 0 && (
            <button
              type="button"
              className="mb-1 flex w-full items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-left text-sm text-amber hover:bg-amber/15"
              onClick={() => {
                setOpen(false);
                nav('/events?status=new');
              }}
            >
              <Siren className="h-4 w-4" /> {unreviewed} event{unreviewed === 1 ? '' : 's'} waiting for review
            </button>
          )}
          {notes.length === 0 && unreviewed === 0 && <p className="px-3 py-6 text-center text-sm text-bone-muted">No notifications.</p>}
          <ul className="max-h-80 overflow-auto">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-2 rounded-lg px-3 py-2 hover:bg-ink-700">
                <Dot tone={n.level === 'error' ? 'bad' : n.level === 'warning' ? 'warn' : 'muted'} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="text-xs text-bone-muted">{n.body}</div>
                </div>
                <span className="num text-[11px] text-bone-dim">{clock(n.at)}</span>
              </li>
            ))}
          </ul>
          {notes.length > 0 && (
            <button type="button" className="btn btn-ghost mt-1 w-full text-xs" onClick={() => live.clearNotifications()}>
              Clear notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex items-center gap-1.5 rounded-full border border-amber/60 py-1 pl-1 pr-1 hover:bg-ink-700 sm:pr-2" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber/15 text-sm font-bold uppercase text-amber">{user.username.slice(0, 2)}</span>
        <ChevronDown className="hidden h-4 w-4 text-bone-muted sm:block" />
      </button>
      {open && (
        <div className="panel absolute right-0 top-12 z-40 w-56 p-1.5 text-sm">
          <div className="px-3 py-2">
            <div className="font-medium">{user.username}</div>
            <div className="text-xs capitalize text-bone-muted">{user.role}</div>
          </div>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => (setOpen(false), nav('/settings'))}>
            <SettingsIcon className="h-4 w-4" /> Settings
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => (setOpen(false), window.dispatchEvent(new Event('es:shortcuts')))}>
            <Keyboard className="h-4 w-4" /> Keyboard shortcuts
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-bad hover:bg-ink-700" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const metrics = useMetrics();
  const pipeline = usePipeline();
  const { channels } = useChannels();
  const conn = useLive((s) => s.conn);
  const online = channels?.filter((c) => c.state === 'online').length ?? null;
  const total = channels?.length ?? null;
  const ollama = pipeline?.ollama;
  const pipeTone = useMemo(() => {
    if (!pipeline) return 'muted' as const;
    const states = [pipeline.stt.state, pipeline.classifier.state, pipeline.recorder.state];
    if (states.some((s) => s === 'error' || s === 'stopped')) return 'bad' as const;
    if (states.some((s) => s === 'degraded' || s === 'loading')) return 'warn' as const;
    return 'ok' as const;
  }, [pipeline]);
  const nav = useNavigate();
  const diskPct = metrics ? (metrics.disk_used_bytes / Math.max(1, metrics.disk_total_bytes)) * 100 : null;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-600 bg-ink/90 px-3 backdrop-blur md:px-5">
      <button type="button" className="btn-icon lg:hidden" aria-label="Open navigation" onClick={onMenu}>
        <Menu className="h-5 w-5" />
      </button>
      <div className="min-w-0 shrink lg:min-w-[250px]">
        <Wordmark />
      </div>

      <div className="ml-auto hidden shrink-0 items-center gap-2 xl:flex">
        <Stat
          icon={<Radio className="h-4 w-4" />}
          label="Channels online"
          value={online === null ? <Skeleton className="h-3 w-10" /> : `${online}/${total} online`}
          tone={online ? 'ok' : undefined}
        />
        <button type="button" onClick={() => nav('/system')} className="rounded-lg text-left">
          <Stat
            icon={<BrainCircuit className="h-4 w-4" />}
            label="Ollama text reasoning"
            value={<span className="font-sans">Ollama</span>}
            sub={
              ollama ? (
                <span className="flex items-center gap-1">
                  <Dot tone={serviceTone(ollama.state)} className="h-1.5 w-1.5" />
                  {serviceLabel(ollama.state)}
                  {ollama.state === 'running' && ollama.model ? ` (${ollama.model})` : ''}
                </span>
              ) : (
                '—'
              )
            }
          />
        </button>
        <button type="button" onClick={() => nav('/system')} className="rounded-lg text-left">
          <Stat
            icon={<Gauge className="h-4 w-4" />}
            label="Processing pipeline"
            value={
              <span className="flex items-center gap-1.5 font-sans">
                <Dot tone={pipeTone} /> Pipeline
              </span>
            }
          />
        </button>
        <Stat icon={<Cpu className="h-4 w-4" />} label="CPU" value={metrics ? `CPU ${metrics.cpu_pct.toFixed(0)}%` : <Skeleton className="h-3 w-12" />} />
        <Stat icon={<MemoryStick className="h-4 w-4" />} label="RAM" value={metrics ? `RAM ${bytes(metrics.ram_used_bytes)} / ${bytes(metrics.ram_total_bytes, 0)}` : <Skeleton className="h-3 w-20" />} />
        {metrics?.gpu && <Stat icon={<Cpu className="h-4 w-4" />} label={`GPU ${metrics.gpu.name}`} value={`GPU ${metrics.gpu.util_pct.toFixed(0)}%`} />}
        <Stat
          icon={<HardDrive className="h-4 w-4" />}
          label="Storage"
          value={metrics ? `${bytes(metrics.disk_used_bytes)} / ${bytes(metrics.disk_total_bytes, 0)} (${diskPct!.toFixed(0)}%)` : <Skeleton className="h-3 w-24" />}
          tone={diskPct !== null && diskPct > 90 ? 'bad' : undefined}
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5 xl:ml-2">
        <span className="hidden items-center gap-1.5 text-xs text-bone-muted sm:flex" title="Live connection to server">
          <Dot tone={conn === 'open' ? 'ok' : conn === 'connecting' ? 'warn' : 'bad'} pulse={conn === 'connecting'} />
          <span className="hidden md:inline">{conn === 'open' ? 'Live' : conn === 'connecting' ? 'Connecting' : 'Disconnected'}</span>
        </span>
        <Notifications />
        <button type="button" className="btn-icon hidden h-10 w-10 border-transparent bg-transparent sm:inline-flex" aria-label="Settings" onClick={() => nav('/settings')}>
          <SettingsIcon className="h-5 w-5" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function MobileTabs({ unreviewed }: { unreviewed: number }) {
  const items = NAV.slice(0, 4);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-ink-600 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-amber' : 'text-bone-muted')}>
          <n.icon className="h-5 w-5" />
          {n.label}
          {n.to === '/events' && unreviewed > 0 && <span className="num absolute right-[22%] top-1 rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unreviewed}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'g') {
        pendingG = Date.now();
        return;
      }
      if (Date.now() - pendingG < 1200) {
        const hit = NAV.find((n) => n.key === e.key);
        if (hit) {
          e.preventDefault();
          nav(hit.to);
        }
        pendingG = 0;
      }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('es:shortcuts', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('es:shortcuts', show);
    };
  }, [nav]);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li className="flex justify-between gap-2">
          <span>Show this help</span>
          <kbd className="num rounded border border-ink-500 px-1.5">?</kbd>
        </li>
        <li className="flex justify-between gap-2">
          <span>Close dialog</span>
          <kbd className="num rounded border border-ink-500 px-1.5">Esc</kbd>
        </li>
        {NAV.map((n) => (
          <li key={n.to} className="flex justify-between gap-2">
            <span>Go to {n.label}</span>
            <kbd className="num rounded border border-ink-500 px-1.5">g {n.key}</kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { meta } = useAuth();
  const stats = useEventStats();
  const unreviewed = stats.data?.unreviewed ?? 0;
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);

  useEffect(() => {
    live.connect();
    return () => live.disconnect();
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only z-50 rounded bg-amber px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      {meta?.demo_mode && (
        <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber px-3 py-1 text-center text-xs font-bold text-ink">
          DEMO MODE — synthetic data. Nothing on this screen comes from real audio.
        </div>
      )}
      <TopBar onMenu={() => setDrawer(true)} />
      <div className="flex flex-1">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[250px] shrink-0 flex-col border-r border-ink-600 px-3 py-4 lg:flex" aria-label="Sidebar">
          <nav aria-label="Main">
            <NavItems unreviewed={unreviewed} />
          </nav>
          <SidebarFooter />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
            <aside className="flex h-full w-72 flex-col border-r border-ink-600 bg-ink-850 px-3 py-4" aria-label="Navigation drawer">
              <div className="mb-4 flex items-center px-2">
                <Wordmark compact />
                <button type="button" className="btn-icon ml-auto" aria-label="Close navigation" onClick={() => setDrawer(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav aria-label="Main">
                <NavItems unreviewed={unreviewed} onNavigate={() => setDrawer(false)} />
              </nav>
              <SidebarFooter />
            </aside>
          </div>
        )}
        <main id="main" className="min-w-0 flex-1 px-3 pb-24 pt-4 md:px-5 lg:pb-6">
          {children}
        </main>
      </div>
      <MobileTabs unreviewed={unreviewed} />
      <ShortcutsDialog />
    </div>
  );
}

