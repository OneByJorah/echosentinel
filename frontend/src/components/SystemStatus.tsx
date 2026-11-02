import { Activity, CheckCircle2, CircleSlash, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import type { Metrics, PipelineStatus, ServiceState } from '../lib/types';
import { bytes } from '../lib/format';
import { Panel, Skeleton, serviceLabel, serviceTone } from './ui';

export function StateIcon({ state }: { state: ServiceState | undefined }) {
  const tone = serviceTone(state);
  if (state === 'loading') return <Loader2 className="h-5 w-5 animate-spin text-warn" aria-hidden />;
  if (tone === 'ok') return <CheckCircle2 className="h-5 w-5 fill-ok/20 text-ok" aria-hidden />;
  if (tone === 'bad') return <XCircle className="h-5 w-5 text-bad" aria-hidden />;
  if (tone === 'warn') return <AlertTriangle className="h-5 w-5 text-warn" aria-hidden />;
  return <CircleSlash className="h-5 w-5 text-bone-dim" aria-hidden />;
}

function Row({ name, role, state, right }: { name: string; role?: string; state: ServiceState | undefined; right: React.ReactNode }) {
  const tone = serviceTone(state);
  return (
    <li className="flex items-center gap-3 border-b border-ink-600/70 px-3 py-2.5 last:border-0">
      <StateIcon state={state} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{name}</div>
        {role && <div className="text-[11.5px] text-bone-dim">{role}</div>}
      </div>
      <div className={`num text-right text-[12.5px] ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-bone-muted'}`}>{right}</div>
    </li>
  );
}

export function SystemStatusCard({ pipeline, metrics }: { pipeline: PipelineStatus | null; metrics: Metrics | null }) {
  if (!pipeline)
    return (
      <Panel title="System Status" icon={<Activity className="h-5 w-5" />}>
        <div className="space-y-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Panel>
    );
  const p = pipeline;
  const diskPct = metrics ? (metrics.disk_used_bytes / Math.max(1, metrics.disk_total_bytes)) * 100 : null;
  return (
    <Panel title="System Status" icon={<Activity className="h-5 w-5" />}>
      <ul className="panel-inset">
        <Row name="Speech-to-text" role={[p.stt.engine, p.stt.model, p.stt.device].filter(Boolean).join(' · ') || undefined} state={p.stt.state} right={<>{serviceLabel(p.stt.state)}{p.stt.queue ? <span className="block text-[11px] text-bone-dim">queue {p.stt.queue}</span> : null}</>} />
        <Row name="Sound classifier" role={[p.classifier.engine, p.classifier.model].filter(Boolean).join(' · ') || undefined} state={p.classifier.state} right={serviceLabel(p.classifier.state)} />
        <Row name="Ollama (text reasoning)" role={p.ollama.url_host} state={p.ollama.state} right={<>{p.ollama.state === 'running' && p.ollama.model ? `${p.ollama.model} • ` : ''}{serviceLabel(p.ollama.state)}</>} />
        <Row name="Recording service" role={p.recorder.detail ?? undefined} state={p.recorder.state} right={serviceLabel(p.recorder.state)} />
        <Row name="Storage" state={diskPct === null ? undefined : diskPct > 92 ? 'degraded' : 'active'} right={metrics ? `${bytes(metrics.disk_used_bytes)} / ${bytes(metrics.disk_total_bytes, 0)} (${diskPct!.toFixed(0)}%)` : '—'} />
        <Row name="Audio streams" state={p.streams.online > 0 ? 'active' : p.streams.total ? 'stopped' : undefined} right={`${p.streams.online} online / ${p.streams.total} total`} />
      </ul>
    </Panel>
  );
}
