import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clock, Timer, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import type { Analytics as A } from '../lib/types';
import { categoryLabel, channelLabel, pct } from '../lib/format';
import { useChannels } from '../hooks/queries';
import { Empty, ErrorNote, PageHeader, Panel, Skeleton, Tabs } from '../components/ui';

type Range = '24h' | '7d' | '30d';

/** Horizontal single-hue bars (magnitude). Labels in text ink, values right-aligned. */
function HBars({ rows, max, unit = '', label }: { rows: { key: string; label: string; value: number; sub?: string }[]; max?: number; unit?: string; label: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty title="No data in this range" />;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${r.value.toFixed(unit === '%' ? 1 : 0)}${unit}${r.sub ? ` · ${r.sub}` : ''}`}>
          <span className="truncate text-bone-muted">{r.label}</span>
          <span className="h-3 overflow-hidden rounded-r bg-ink-700">
            <span className="block h-full rounded-r bg-amber" style={{ width: `${Math.max(0.5, (r.value / m) * 100)}%` }} />
          </span>
          <span className="num w-20 text-right text-bone">
            {unit === '%' ? pct(r.value, 1) : r.value.toFixed(r.value % 1 ? 1 : 0) + unit}
            {r.sub && <span className="block text-[11px] text-bone-dim">{r.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Columns({ data }: { data: { hour: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <Empty title="No events in this range" />;
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 600;
  const H = 160;
  const bw = W / data.length;
  const fmt = (h: string) => new Date(h).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  return (
    <div className="relative grid grid-cols-[28px_1fr] gap-x-2">
      <div className="num relative h-[180px] text-[10.5px] text-bone-dim">
        {[max, Math.round(max / 2), 0].map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[180px] w-full" role="img" aria-label="Events per hour">
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke="#2b2c27" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const h = (d.count / max) * H;
          return (
            <g key={d.hour} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {d.count > 0 && <rect x={i * bw + bw * 0.15} y={H - h} width={Math.max(1, bw * 0.7)} height={h} fill={hover === i ? '#ffc94d' : '#FFB300'} />}
            </g>
          );
        })}
      </svg>
      <div />
      <div className="num mt-1 flex justify-between text-[11px] text-bone-muted">
        <span>{fmt(data[0].hour)}</span>
        <span>{fmt(data[Math.floor(data.length / 2)].hour)}</span>
        <span>{fmt(data[data.length - 1].hour)}</span>
      </div>
      {hover !== null && (
        <div className="num pointer-events-none absolute top-0 rounded-md border border-ink-500 bg-ink-750 px-2 py-1 text-xs shadow-panel" style={{ left: `${Math.min(75, (hover / data.length) * 100)}%` }}>
          {fmt(data[hover].hour)} · <b>{data[hover].count}</b> events
        </div>
      )}
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-sm text-bone-muted">
        <span className="text-amber">{icon}</span>
        {label}
      </div>
      <div className="num mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-bone-muted">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const [range, setRange] = useState<Range>('24h');
  const { channels } = useChannels();
  const q = useQuery({ queryKey: ['analytics', range], queryFn: () => api<A>('/analytics', { query: { range } }), refetchInterval: 60_000 });
  const chMap = new Map((channels ?? []).map((c) => [String(c.id), c]));
  const chName = (id: string | number) => {
    const c = chMap.get(String(id));
    return c ? channelLabel(c.slot, c.name) : `#${id}`;
  };
  const d = q.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="Computed from stored channel history, events and transcripts."
        actions={<Tabs value={range} onChange={setRange} tabs={[{ id: '24h', label: '24 hours' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }]} />}
      />
      <ErrorNote error={q.error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={<BarChart3 className="h-4 w-4" />} label="Events" value={d ? Object.values(d.events_by_category).reduce((a, b) => a + b, 0) : <Skeleton className="h-6 w-12" />} />
        <Tile icon={<Timer className="h-4 w-4" />} label="Speech-to-text latency" value={d ? (d.stt_latency_ms ? `${(d.stt_latency_ms.p50 / 1000).toFixed(1)} s` : 'No data') : <Skeleton className="h-6 w-16" />} sub={d?.stt_latency_ms ? `p95 ${(d.stt_latency_ms.p95 / 1000).toFixed(1)} s` : 'median'} />
        <Tile icon={<Clock className="h-4 w-4" />} label="Classifier latency" value={d ? (d.classifier_latency_ms ? `${d.classifier_latency_ms.p50.toFixed(0)} ms` : 'No data') : <Skeleton className="h-6 w-16" />} sub={d?.classifier_latency_ms ? `p95 ${d.classifier_latency_ms.p95.toFixed(0)} ms` : 'median'} />
        <Tile icon={<AlertCircle className="h-4 w-4" />} label="Errors" value={d ? d.error_count : <Skeleton className="h-6 w-10" />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Channel uptime">
          {d ? <HBars label="Uptime per channel" max={100} unit="%" rows={d.uptime.map((u) => ({ key: String(u.channel_id), label: chName(u.channel_id), value: u.uptime_pct, sub: `${u.outages} outage${u.outages === 1 ? '' : 's'}` }))} /> : <Skeleton className="h-32 w-full" />}
        </Panel>
        <Panel title="Recording coverage">
          {d ? <HBars label="Recording coverage per channel" max={100} unit="%" rows={Object.entries(d.recording_coverage_pct).map(([k, v]) => ({ key: k, label: chName(k), value: v }))} /> : <Skeleton className="h-32 w-full" />}
        </Panel>
        <Panel title="Events by sound type">
          {d ? (
            <HBars
              label="Events by category"
              rows={Object.entries(d.events_by_category)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ key: k, label: categoryLabel(k), value: v }))}
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </Panel>
        <Panel title="Speech activity (minutes)">
          {d ? <HBars label="Speech minutes per channel" rows={Object.entries(d.speech_minutes_by_channel).map(([k, v]) => ({ key: k, label: chName(k), value: v, sub: 'min' }))} /> : <Skeleton className="h-32 w-full" />}
        </Panel>
      </div>
      <Panel title="Events per hour">{d ? <Columns data={d.events_by_hour} /> : <Skeleton className="h-40 w-full" />}</Panel>
      {d && (
        <details className="panel px-4 py-3 text-sm">
          <summary className="cursor-pointer text-bone-muted">Show data table</summary>
          <table className="num mt-3 w-full">
            <thead className="text-left text-xs text-bone-muted">
              <tr>
                <th className="py-1 font-sans font-medium">Channel</th>
                <th className="py-1 font-sans font-medium">Uptime</th>
                <th className="py-1 font-sans font-medium">Outages</th>
                <th className="py-1 font-sans font-medium">Coverage</th>
                <th className="py-1 font-sans font-medium">Speech min</th>
              </tr>
            </thead>
            <tbody>
              {d.uptime.map((u) => (
                <tr key={u.channel_id} className="border-t border-ink-600/60">
                  <td className="py-1 font-sans">{chName(u.channel_id)}</td>
                  <td>{pct(u.uptime_pct, 1)}</td>
                  <td>{u.outages}</td>
                  <td>{pct(d.recording_coverage_pct[String(u.channel_id)], 1)}</td>
                  <td>{(d.speech_minutes_by_channel[String(u.channel_id)] ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
