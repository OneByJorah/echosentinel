import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, HardDrive, Loader2, MemoryStick, ScrollText, Server, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api';
import type { AuditEntry, Role, User } from '../lib/types';
import { bytes, dateTime } from '../lib/format';
import { useMetrics, usePipeline } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { StateIcon } from '../components/SystemStatus';
import { Badge, Button, Dialog, ErrorNote, Meter, PageHeader, Panel, Skeleton, serviceLabel } from '../components/ui';

export default function SystemPage() {
  const pipeline = usePipeline();
  const metrics = useMetrics();
  const { can } = useAuth();
  const rows = pipeline
    ? [
        { name: 'Speech-to-text', what: 'Turns speech into text, on this server', s: pipeline.stt.state, info: [pipeline.stt.engine, pipeline.stt.model, pipeline.stt.device].filter(Boolean).join(' · '), extra: `queue ${pipeline.stt.queue ?? 0}${pipeline.stt.latency_ms_p50 ? ` · p50 ${pipeline.stt.latency_ms_p50} ms` : ''}`, detail: pipeline.stt.detail },
        { name: 'Sound classifier', what: 'Recognises sounds like barking, alarms and glass', s: pipeline.classifier.state, info: [pipeline.classifier.engine, pipeline.classifier.model].filter(Boolean).join(' · '), extra: `queue ${pipeline.classifier.queue ?? 0}${pipeline.classifier.latency_ms_p50 ? ` · p50 ${pipeline.classifier.latency_ms_p50} ms` : ''}`, detail: pipeline.classifier.detail },
        { name: 'Voice activity detection', what: 'Finds where speech starts and stops', s: pipeline.vad.state, info: pipeline.vad.engine ?? '', extra: '', detail: null },
        { name: 'Ollama', what: 'Text reasoning for summaries only — never hears audio', s: pipeline.ollama.state, info: [pipeline.ollama.url_host, pipeline.ollama.model].filter(Boolean).join(' · '), extra: pipeline.ollama.models?.length ? `${pipeline.ollama.models.length} models available` : '', detail: pipeline.ollama.detail },
        { name: 'Recorder', what: 'Writes segmented audio files to disk', s: pipeline.recorder.state, info: pipeline.recorder.free_bytes !== undefined ? `${bytes(pipeline.recorder.free_bytes)} free (min ${bytes(pipeline.recorder.min_free_bytes)})` : '', extra: '', detail: pipeline.recorder.detail },
        { name: 'Speaker diarization', what: 'Who-spoke-when labelling', s: pipeline.diarization.state, info: 'No validated model installed — speaker labels are not shown', extra: '', detail: null },
      ]
    : [];
  return (
    <div className="space-y-4">
      <PageHeader title="System" subtitle={pipeline ? `${pipeline.streams.online} of ${pipeline.streams.total} audio streams online` : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={<Cpu className="h-4 w-4" />} label="CPU" value={metrics ? `${metrics.cpu_pct.toFixed(0)}%` : null} pct={metrics?.cpu_pct ?? null} sub={metrics ? `load ${metrics.load_avg.map((l) => l.toFixed(2)).join(' ')}` : undefined} />
        <MetricTile icon={<MemoryStick className="h-4 w-4" />} label="Memory" value={metrics ? `${bytes(metrics.ram_used_bytes)} / ${bytes(metrics.ram_total_bytes)}` : null} pct={metrics ? (metrics.ram_used_bytes / metrics.ram_total_bytes) * 100 : null} />
        <MetricTile icon={<HardDrive className="h-4 w-4" />} label={`Storage${metrics ? ` (${metrics.disk_path})` : ''}`} value={metrics ? `${bytes(metrics.disk_used_bytes)} / ${bytes(metrics.disk_total_bytes)}` : null} pct={metrics ? (metrics.disk_used_bytes / metrics.disk_total_bytes) * 100 : null} />
        <MetricTile icon={<Cpu className="h-4 w-4" />} label={metrics?.gpu ? `GPU · ${metrics.gpu.name}` : 'GPU'} value={metrics ? (metrics.gpu ? `${metrics.gpu.util_pct.toFixed(0)}%` : 'Not detected') : null} pct={metrics?.gpu?.util_pct ?? null} sub={metrics?.gpu ? `${bytes(metrics.gpu.mem_used_bytes)} / ${bytes(metrics.gpu.mem_total_bytes)}` : undefined} />
      </div>
      <Panel title="Processing services" icon={<Server className="h-5 w-5" />}>
        {!pipeline ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ul className="panel-inset">
            {rows.map((r) => (
              <li key={r.name} className="flex flex-wrap items-start gap-3 border-b border-ink-600/70 px-3 py-3 last:border-0">
                <StateIcon state={r.s} />
                <div className="min-w-[200px] flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-bone-muted">{r.what}</div>
                  {r.detail && <div className="mt-1 text-xs text-warn">{r.detail}</div>}
                </div>
                <div className="num text-right text-xs text-bone-muted">
                  <div className="text-sm text-bone">{serviceLabel(r.s)}</div>
                  {r.info && <div>{r.info}</div>}
                  {r.extra && <div>{r.extra}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {can('admin') && (
        <div className="grid gap-4 xl:grid-cols-2">
          <UsersPanel />
          <AuditPanel />
        </div>
      )}
    </div>
  );
}

function MetricTile({ icon, label, value, pct, sub }: { icon: React.ReactNode; label: string; value: string | null; pct: number | null; sub?: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-sm text-bone-muted">
        <span className="text-amber">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="num mt-2 text-lg font-semibold">{value ?? <Skeleton className="h-5 w-24" />}</div>
      <div className="mt-2">
        <Meter value={pct} label={label} tone={pct !== null && pct > 90 ? 'bad' : 'amber'} />
      </div>
      {sub && <div className="num mt-1.5 text-[11px] text-bone-dim">{sub}</div>}
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ username: '', password: '', role: 'viewer' as Role });
  const create = useMutation({
    mutationFn: () => api<User>('/users', { method: 'POST', body: f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
      setF({ username: '', password: '', role: 'viewer' });
      toast('ok', 'User created');
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number; role?: Role; disabled?: boolean }) => api<User>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast('error', errText(e)),
  });
  return (
    <Panel
      title="Users"
      icon={<Users className="h-5 w-5" />}
      actions={
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" /> Add user
        </Button>
      }
    >
      <ErrorNote error={q.error} />
      <ul className="panel-inset">
        {q.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 border-b border-ink-600/70 px-3 py-2 text-sm last:border-0">
            <span className="font-medium">{u.username}</span>
            {u.disabled && <Badge tone="bad">disabled</Badge>}
            <span className="num text-xs text-bone-dim">last login {u.last_login_at ? dateTime(u.last_login_at) : 'never'}</span>
            <select className="input ml-auto w-auto py-1 text-xs" aria-label={`Role for ${u.username}`} value={u.role} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, role: e.target.value as Role })}>
              <option value="viewer">viewer</option>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
            </select>
            <button type="button" className="btn px-2 py-1 text-xs" disabled={u.id === me?.id} title={u.id === me?.id ? "You can't disable yourself" : undefined} onClick={() => patch.mutate({ id: u.id, disabled: !u.disabled })}>
              {u.disabled ? 'Enable' : 'Disable'}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add user">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor="nu-name">
              Username
            </label>
            <input id="nu-name" className="input" required autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="nu-pass">
              Password
            </label>
            <input id="nu-pass" className="input" type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <p className="mt-1 text-xs text-bone-dim">At least 10 characters.</p>
          </div>
          <div>
            <label className="label" htmlFor="nu-role">
              Role
            </label>
            <select id="nu-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="viewer">Viewer — watch and listen</option>
              <option value="operator">Operator — also review, export, summarize</option>
              <option value="admin">Admin — full control</option>
            </select>
          </div>
          <ErrorNote error={create.error} />
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create user
            </button>
          </div>
        </form>
      </Dialog>
    </Panel>
  );
}

function AuditPanel() {
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api<{ items: AuditEntry[]; next_before_id?: number | null }>('/system/audit', { query: { limit: 50, before_id: pageParam } }),
    getNextPageParam: (p) => p.next_before_id ?? (p.items.length === 50 ? p.items[p.items.length - 1].id : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel title="Audit log" icon={<ScrollText className="h-5 w-5" />}>
      <ErrorNote error={q.error} />
      <ul className="panel-inset max-h-[420px] overflow-auto text-sm">
        {items.map((a) => (
          <li key={a.id} className="border-b border-ink-600/60 px-3 py-1.5 last:border-0">
            <div className="flex flex-wrap gap-x-2">
              <span className="num text-xs text-bone-muted">{dateTime(a.at)}</span>
              <span className="font-medium">{a.username ?? 'system'}</span>
              <span className="text-amber">{a.action}</span>
              {a.target && <span className="text-bone-muted">{a.target}</span>}
            </div>
            {(a.ip || a.detail) && <div className="num text-[11px] text-bone-dim">{[a.ip, a.detail].filter(Boolean).join(' · ')}</div>}
          </li>
        ))}
        {!items.length && !q.isLoading && <li className="px-3 py-3 text-bone-muted">No entries.</li>}
      </ul>
      {q.hasNextPage && (
        <Button className="mt-2 w-full" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Load older entries
        </Button>
      )}
    </Panel>
  );
}
