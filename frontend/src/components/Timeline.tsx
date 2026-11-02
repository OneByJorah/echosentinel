import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioWaveform, CalendarDays, Maximize2, Minimize2, Pause, Play, Rewind, FastForward, ZoomIn, ZoomOut, Loader2, Radio } from 'lucide-react';
import { api } from '../lib/api';
import type { AudioEvent, Channel, Page, Recording, Segment, Timeline as TL } from '../lib/types';
import { categoryLabel, channelLabel, clock } from '../lib/format';
import { playback } from '../lib/playback';
import { usePlayback } from '../hooks/usePlayback';
import { TranscriptLine } from './Transcript';
import { Panel, cx } from './ui';

const SPANS = [5, 15, 30, 60, 180, 360, 720, 1440]; // minutes
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function dayInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function niceStep(spanMs: number): number {
  const candidates = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600].map((s) => s * 1000);
  return candidates.find((c) => spanMs / c <= 7) ?? 21600000;
}

export function TimelinePanel({ channels, tall, title = 'Audio Playback & Events' }: { channels: Channel[]; tall?: boolean; title?: string }) {
  const firstOnline = channels.find((c) => c.state === 'online') ?? channels[0];
  const [channelId, setChannelId] = useState<number | null>(firstOnline?.id ?? null);
  useEffect(() => {
    if (channelId === null && firstOnline) setChannelId(firstOnline.id);
  }, [channelId, firstOnline]);

  const [spanMin, setSpanMin] = useState(tall ? 60 : 15);
  const [endMs, setEndMs] = useState<number | null>(null); // null = follow live "now"
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endMs !== null) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [endMs]);
  const end = endMs ?? now;
  const start = end - spanMin * 60_000;

  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<AudioEvent | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();

  const tl = useQuery({
    queryKey: ['timeline', channelId, startIso, endIso],
    queryFn: () => api<TL>('/timeline', { query: { channel_id: channelId, start: startIso, end: endIso, buckets: 300 } }),
    enabled: channelId !== null,
    refetchInterval: endMs === null ? 30_000 : false,
    placeholderData: (p) => p,
  });
  const recs = useQuery({
    queryKey: ['recordings', channelId, startIso, endIso],
    queryFn: () => api<Recording[]>('/recordings', { query: { channel_id: channelId, start: startIso, end: endIso } }),
    enabled: channelId !== null,
    placeholderData: (p) => p,
  });

  const pb = usePlayback((s) => s);
  useEffect(() => {
    playback.mountTimeline(1);
    return () => playback.mountTimeline(-1);
  }, []);
  const playheadMs = pb.baseMs !== null && pb.channelId === channelId ? pb.baseMs + pb.currentTime * 1000 : null;

  const recordingAt = useCallback(
    (ms: number): Recording | undefined =>
      recs.data?.find((r) => {
        const s = new Date(r.start).getTime();
        const e = r.end ? new Date(r.end).getTime() : Date.now();
        return ms >= s && ms <= e;
      }),
    [recs.data],
  );

  const seekToMs = useCallback(
    (ms: number, autoplay = true) => {
      if (channelId === null) return false;
      const rec = recordingAt(ms);
      if (!rec) return false;
      const base = new Date(rec.start).getTime();
      void playback.open({ recordingId: rec.id, channelId, baseMs: base, offsetS: (ms - base) / 1000, label: channelLabel(channels.find((c) => c.id === channelId)?.slot ?? 0), autoplay });
      return true;
    },
    [channelId, recordingAt, channels],
  );

  // Transcript context for a selected event.
  const ctx = useQuery({
    queryKey: ['event-context', selected?.id],
    enabled: !!selected,
    queryFn: () => {
      const t = new Date(selected!.at).getTime();
      return api<Page<Segment>>('/transcripts', { query: { channel_id: selected!.channel_id, start: new Date(t - 30_000).toISOString(), end: new Date(t + 30_000).toISOString(), limit: 20 } });
    },
  });

  const zoom = (dir: 1 | -1) => {
    const i = SPANS.indexOf(spanMin);
    const ni = Math.max(0, Math.min(SPANS.length - 1, (i < 0 ? 3 : i) + (dir > 0 ? -1 : 1)));
    const center = playheadMs ?? (start + end) / 2;
    const newSpan = SPANS[ni];
    if (endMs === null && dir < 0) {
      setSpanMin(newSpan);
      return;
    }
    const newEnd = Math.min(Date.now(), center + (newSpan * 60_000) / 2);
    setEndMs(newEnd >= Date.now() - 5000 ? null : newEnd);
    setSpanMin(newSpan);
  };

  const onDate = (v: string) => {
    if (!v) return;
    const [y, m, d] = v.split('-').map(Number);
    const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    if (endOfDay >= Date.now()) setEndMs(null);
    else {
      setEndMs(endOfDay);
      setSpanMin(1440);
    }
  };

  const toggleFull = () => setFull((f) => !f);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [full]);

  const selectEvent = (ev: AudioEvent) => {
    setSelected(ev);
    if (!seekToMs(new Date(ev.at).getTime() - 2000)) {
      /* no recording – context still shown */
    }
  };

  const controls = (
    <>
      <label className="relative flex items-center">
        <CalendarDays className="pointer-events-none absolute left-2.5 h-4 w-4 text-bone-muted" />
        <input type="date" className="input w-[150px] py-1.5 pl-8 text-[13px]" value={dayInput(new Date(end))} max={dayInput(new Date())} onChange={(e) => onDate(e.target.value)} aria-label="Timeline date" />
      </label>
      <select className="input w-auto py-1.5 text-[13px]" value={channelId ?? ''} onChange={(e) => setChannelId(Number(e.target.value))} aria-label="Timeline channel">
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {channelLabel(c.slot, c.name)}
          </option>
        ))}
      </select>
      <div className="flex items-center rounded-lg border border-ink-600 bg-ink-850">
        <button type="button" className="btn-icon h-9 w-9 border-0 bg-transparent" aria-label="Back 10 seconds" title="Back 10 s" disabled={!pb.src} onClick={() => playback.skip(-10)}>
          <Rewind className="h-4 w-4" />
        </button>
        <button type="button" className="btn-icon h-9 w-11 border-0 bg-transparent text-amber" aria-label={pb.playing ? 'Pause' : 'Play'} disabled={!pb.src} title={pb.src ? undefined : 'Click the timeline or an event to load audio'} onClick={() => playback.toggle()}>
          {pb.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-amber" />}
        </button>
        <button type="button" className="btn-icon h-9 w-9 border-0 bg-transparent" aria-label="Forward 10 seconds" title="Forward 10 s" disabled={!pb.src} onClick={() => playback.skip(10)}>
          <FastForward className="h-4 w-4" />
        </button>
      </div>
      <select className="input num w-[74px] py-1.5 text-[13px]" value={pb.rate} onChange={(e) => playback.setRate(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-icon h-9 w-9" aria-label="Zoom in" title="Zoom in" disabled={spanMin === SPANS[0]} onClick={() => zoom(1)}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" className="btn-icon h-9 w-9" aria-label="Zoom out" title="Zoom out" disabled={spanMin === SPANS[SPANS.length - 1]} onClick={() => zoom(-1)}>
          <ZoomOut className="h-4 w-4" />
        </button>
        {endMs !== null && (
          <button type="button" className="btn h-9 px-2.5 text-xs" onClick={() => setEndMs(null)} title="Jump back to live">
            <Radio className="h-3.5 w-3.5 text-bad" /> Live
          </button>
        )}
        <button type="button" className="btn-icon h-9 w-9" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={toggleFull}>
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </>
  );

  const body = (
    <>
      <TimelineCanvas data={tl.data} start={start} end={end} playheadMs={playheadMs} hoverMs={hoverMs} setHoverMs={setHoverMs} onSeek={(ms) => seekToMs(ms)} onEvent={selectEvent} height={full ? 260 : tall ? 200 : 132} />
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-bone-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-sm bg-amber" /> Audio
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-sm bg-speech" /> Speech (AI)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-sm bg-bad" /> Event (AI)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hatch h-2.5 w-3.5 rounded-sm border border-bad/40" /> Gap / offline
        </span>
        <span className="num ml-auto">
          {tl.isFetching && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {clock(start)} – {clock(end)} · {spanMin >= 60 ? `${spanMin / 60} h` : `${spanMin} min`}
          {pb.src && pb.channelId === channelId && playheadMs && <span className="text-amber"> · ▶ {clock(playheadMs)}</span>}
        </span>
      </div>
      {tl.error ? <p className="mt-2 text-sm text-bad">{(tl.error as Error).message}</p> : null}
      {pb.error && <p className="mt-2 text-sm text-warn">{pb.error}</p>}
      {selected && (
        <div className="panel-inset mt-3 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-semibold">{categoryLabel(selected.category)}</span>
            <span className="num text-bone-muted">
              {clock(selected.at)} · score {selected.score.toFixed(2)}
            </span>
            <button type="button" className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          {ctx.isLoading ? (
            <p className="text-sm text-bone-muted">Loading transcript…</p>
          ) : ctx.data && ctx.data.items.length ? (
            <ul className="max-h-40 overflow-auto">
              {[...ctx.data.items].reverse().map((s) => (
                <TranscriptLine key={s.id} seg={s} redacted={false} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-bone-muted">No transcript within 30 s of this event.</p>
          )}
        </div>
      )}
    </>
  );

  if (!channels.length) return null;

  return (
    <div className={cx(full && 'fixed inset-0 z-50 overflow-auto bg-ink/95 p-4 backdrop-blur')}>
      <Panel title={title} icon={<AudioWaveform className="h-5 w-5" />} actions={controls} className={cx(full && 'min-h-full')}>
        {body}
      </Panel>
    </div>
  );
}

function TimelineCanvas({
  data,
  start,
  end,
  playheadMs,
  hoverMs,
  setHoverMs,
  onSeek,
  onEvent,
  height,
}: {
  data: TL | undefined;
  start: number;
  end: number;
  playheadMs: number | null;
  hoverMs: number | null;
  setHoverMs: (v: number | null) => void;
  onSeek: (ms: number) => boolean;
  onEvent: (ev: AudioEvent) => void;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const span = end - start;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const x = useCallback((ms: number) => ((ms - start) / span) * width, [start, span, width]);
  const ms = (px: number) => start + (px / width) * span;

  const eventHits = useMemo(() => (data?.events ?? []).map((ev) => ({ ev, x: x(new Date(ev.at).getTime()) })), [data, x]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const waveH = height - 22;
    const mid = waveH / 2 + 4;
    const span0 = (a: string, b: string) => [Math.max(0, x(new Date(a).getTime())), Math.min(width, x(new Date(b).getTime()))];

    // Unrecorded background (anything not covered).
    const hatch = (x0: number, x1: number, color: string) => {
      g.save();
      g.beginPath();
      g.rect(x0, 2, x1 - x0, waveH);
      g.clip();
      g.fillStyle = color;
      g.fillRect(x0, 2, x1 - x0, waveH);
      g.strokeStyle = 'rgba(242,85,90,0.35)';
      g.lineWidth = 1;
      for (let i = x0 - waveH; i < x1; i += 7) {
        g.beginPath();
        g.moveTo(i, waveH + 2);
        g.lineTo(i + waveH, 2);
        g.stroke();
      }
      g.restore();
    };
    data?.offline.forEach((o) => {
      const [a, b] = span0(o.start, o.end);
      if (b > a) hatch(a, b, 'rgba(242,85,90,0.06)');
    });
    data?.gaps.forEach((o) => {
      const [a, b] = span0(o.start, o.end);
      if (b > a) hatch(a, b, 'rgba(242,85,90,0.04)');
    });

    // Event regions (±2s glow).
    data?.events.forEach((ev) => {
      const t = new Date(ev.at).getTime();
      const a = x(t - 2000);
      const b = Math.max(a + 3, x(t + 2000));
      const grd = g.createLinearGradient(a, 0, b, 0);
      grd.addColorStop(0, 'rgba(242,85,90,0.05)');
      grd.addColorStop(0.5, 'rgba(242,85,90,0.35)');
      grd.addColorStop(1, 'rgba(242,85,90,0.05)');
      g.fillStyle = grd;
      g.fillRect(a, 2, b - a, waveH);
    });

    // Peaks, only drawn where audio is covered.
    const peaks = data?.peaks ?? [];
    if (peaks.length) {
      const bw = width / peaks.length;
      const covered = (px: number) => {
        const t = ms(px);
        return data!.coverage.some((cv) => t >= new Date(cv.start).getTime() && t <= new Date(cv.end).getTime());
      };
      for (let i = 0; i < peaks.length; i++) {
        const px = i * bw;
        if (!covered(px + bw / 2)) continue;
        const v = Math.sqrt(Math.max(0, Math.min(1, peaks[i])));
        const h = Math.max(1, v * (waveH - 8));
        g.fillStyle = '#FFB300';
        g.fillRect(px + bw * 0.15, mid - h / 2, Math.max(1, bw * 0.7), h);
      }
    }
    // Baseline across coverage.
    g.fillStyle = 'rgba(255,179,0,0.35)';
    data?.coverage.forEach((cv) => {
      const [a, b] = span0(cv.start, cv.end);
      if (b > a) g.fillRect(a, mid - 0.5, b - a, 1);
    });

    // Speech track.
    g.fillStyle = '#9b7bff';
    data?.speech.forEach((s) => {
      const [a, b] = span0(s.start, s.end);
      if (b > a) g.fillRect(a, waveH + 6, Math.max(2, b - a), 4);
    });

    // Event ticks.
    data?.events.forEach((ev) => {
      const px = x(new Date(ev.at).getTime());
      g.fillStyle = '#f2555a';
      g.fillRect(px - 1, 2, 2, waveH);
      g.beginPath();
      g.arc(px, waveH + 8, 3.5, 0, Math.PI * 2);
      g.fill();
    });
  }, [data, width, height, start, end, x]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = niceStep(span);
  const firstTick = Math.ceil(start / step) * step;
  const ticks = Array.from({ length: Math.max(0, Math.floor((end - firstTick) / step) + 1) }, (_, i) => firstTick + i * step);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const hit = eventHits.find((h) => Math.abs(h.x - px) < 7);
    if (hit) onEvent(hit.ev);
    else onSeek(ms(px));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && playheadMs === null) onSeek(end - 60_000);
  };

  const hover = hoverMs !== null && hoverMs >= start && hoverMs <= end ? hoverMs : null;
  const hasData = !!data && (data.coverage.length > 0 || data.events.length > 0 || data.speech.length > 0);

  return (
    <div className="relative select-none" ref={wrap}>
      <div
        className="panel-inset relative cursor-crosshair overflow-hidden"
        style={{ height }}
        onClick={onClick}
        onMouseMove={(e) => setHoverMs(ms(e.clientX - e.currentTarget.getBoundingClientRect().left))}
        onMouseLeave={() => setHoverMs(null)}
        role="slider"
        tabIndex={0}
        aria-label="Audio timeline. Click to seek, click a red marker to open an event."
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={playheadMs ?? undefined}
        aria-valuetext={playheadMs ? clock(playheadMs) : 'Not playing'}
        onKeyDown={onKey}
      >
        <canvas ref={ref} style={{ width: '100%', height }} className="block" />
        {!hasData && data && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-bone-muted">No recorded audio in this window.</div>}
        {!data && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-bone-muted">Loading timeline…</div>}
        {hover !== null && <div className="pointer-events-none absolute top-0 h-full w-px bg-bone/30" style={{ left: x(hover) }} />}
        {playheadMs !== null && playheadMs >= start && playheadMs <= end && (
          <>
            <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]" style={{ left: x(playheadMs) }} />
            <div className="num pointer-events-none absolute top-1 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink" style={{ left: Math.min(width - 40, Math.max(40, x(playheadMs))) }}>
              {clock(playheadMs)}
            </div>
          </>
        )}
        {hover !== null && (
          <div className="num pointer-events-none absolute bottom-1 -translate-x-1/2 rounded bg-ink-700 px-1 text-[10.5px] text-bone" style={{ left: Math.min(width - 30, Math.max(30, x(hover))) }}>
            {clock(hover)}
          </div>
        )}
      </div>
      <div className="relative mt-1 h-5">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2 text-[11px] text-bone-muted" style={{ left: x(t) }}>
            {clock(t).slice(0, step >= 60000 ? 5 : 8)}
          </span>
        ))}
      </div>
    </div>
  );
}
