import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Copy, Download, Search, ShieldCheck, Play } from 'lucide-react';
import type { Channel, Segment } from '../lib/types';
import { channelLabel, clock } from '../lib/format';
import { redact } from '../lib/redact';
import { playAt } from '../hooks/usePlayback';
import { useLive } from '../hooks/useLive';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { API, toQuery } from '../lib/api';
import { Badge, Empty, cx } from './ui';

export function TranscriptLine({ seg, channel, redacted, showChannel, highlight }: { seg: Segment; channel?: Channel; redacted: boolean; showChannel?: boolean; highlight?: boolean }) {
  const text = redacted ? redact(seg.text) : seg.text;
  const canPlay = seg.recording_id !== null && seg.offset_s !== null;
  const lowConf = seg.confidence !== null && seg.confidence < 0.5;
  return (
    <li className={cx('group grid grid-cols-[auto_1fr_auto] items-start gap-x-3 rounded-md px-2 py-1.5 text-[13.5px] hover:bg-ink-700/60', highlight && 'bg-amber/10 ring-1 ring-amber/40')}>
      <time className="num pt-px text-[12px] text-bone-muted" dateTime={seg.start}>
        {clock(seg.start)}
      </time>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {showChannel && channel && <span className="num text-[11px] text-bone-dim">CH{String(channel.slot).padStart(2, '0')}</span>}
          {seg.kind === 'speech' ? (
            seg.speaker ? <span className="text-[12px] text-speech">[{seg.speaker}]</span> : null
          ) : (
            <span className={cx('text-[12px]', seg.kind === 'noise' ? 'text-bone-dim' : 'text-warn')}>[{seg.kind === 'noise' ? 'Noise' : 'Unintelligible'}]</span>
          )}
          <span className={cx(seg.kind !== 'speech' && 'italic text-bone-muted', !seg.final && 'italic text-bone-muted', lowConf && 'decoration-warn/70 underline decoration-dotted underline-offset-4')} title={lowConf ? `Low confidence (${Math.round(seg.confidence! * 100)}%) — may not be verbatim` : undefined}>
            {text || <span className="text-bone-dim">(empty)</span>}
          </span>
          {!seg.final && <Badge>interim</Badge>}
          {seg.demo && <Badge tone="amber">demo</Badge>}
        </div>
        {(seg.language || seg.confidence !== null) && (
          <div className="num mt-0.5 hidden text-[10.5px] text-bone-dim group-hover:block">
            {seg.language && <span>lang {seg.language}</span>}
            {seg.confidence !== null && <span> · conf {Math.round(seg.confidence * 100)}%</span>}
          </div>
        )}
      </div>
      <button type="button" className={cx('rounded p-1 text-bone-muted hover:text-amber disabled:opacity-30')} disabled={!canPlay} title={canPlay ? 'Play this moment' : 'No recording for this segment'} aria-label={`Play at ${clock(seg.start)}`} onClick={() => playAt(seg, `Transcript ${clock(seg.start)}`)}>
        <Play className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

export function segmentsToText(segs: Segment[], chans: Map<number, Channel>, redacted: boolean): string {
  return segs
    .map((s) => {
      const ch = chans.get(s.channel_id);
      const tag = s.kind === 'speech' ? (s.speaker ? `[${s.speaker}] ` : '') : `[${s.kind}] `;
      return `${clock(s.start)}  ${ch ? `CH${String(ch.slot).padStart(2, '0')}` : `#${s.channel_id}`}  ${tag}${redacted ? redact(s.text) : s.text}`;
    })
    .join('\n');
}

export function LiveTranscriptPanel({ channels, compact }: { channels: Channel[]; compact?: boolean }) {
  const segs = useLive((s) => s.transcripts);
  const [channelId, setChannelId] = useState<number | 'all'>('all');
  const [auto, setAuto] = useState(true);
  const [redacted, setRedacted] = useState(false);
  const [q, setQ] = useState('');
  const { can } = useAuth();
  const toast = useToast();
  const listRef = useRef<HTMLUListElement>(null);
  const chMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return segs.filter((s) => (channelId === 'all' || s.channel_id === channelId) && (!ql || s.text.toLowerCase().includes(ql)));
  }, [segs, channelId, q]);

  useEffect(() => {
    if (auto && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [filtered, auto]);

  const head = channelId === 'all' ? null : chMap.get(channelId);
  const exportHref = `${API}/transcripts/export?${toQuery({ format: 'txt', channel_id: channelId === 'all' ? undefined : channelId })}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1.5 text-[13px]" value={channelId} onChange={(e) => setChannelId(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Filter transcript by channel">
          <option value="all">All channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {channelLabel(c.slot, c.name)}
            </option>
          ))}
        </select>
        {head?.state === 'online' && <span className="chip bg-bad px-2 py-1 text-white">LIVE</span>}
        <div className="relative min-w-[120px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-bone-dim" />
          <input className="input py-1.5 pl-8 text-[13px]" placeholder="Search live text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search live transcript" />
        </div>
        <div className="flex gap-1">
          <button type="button" className={cx('btn-icon h-8 w-8', auto && 'border-amber/60 text-amber')} aria-pressed={auto} title="Auto-scroll" aria-label="Auto-scroll" onClick={() => setAuto((a) => !a)}>
            <ArrowDownToLine className="h-4 w-4" />
          </button>
          <button type="button" className={cx('btn-icon h-8 w-8', redacted && 'border-amber/60 text-amber')} aria-pressed={redacted} title="Redact numbers, emails and phone numbers on screen" aria-label="Redact personal details" onClick={() => setRedacted((r) => !r)}>
            <ShieldCheck className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-icon h-8 w-8"
            title="Copy visible transcript"
            aria-label="Copy visible transcript"
            onClick={() => {
              void navigator.clipboard
                .writeText(segmentsToText(filtered, chMap, redacted))
                .then(() => toast('ok', 'Transcript copied'))
                .catch(() => toast('error', 'Clipboard is not available'));
            }}
          >
            <Copy className="h-4 w-4" />
          </button>
          {can('operator') ? (
            <a className="btn-icon h-8 w-8" href={exportHref} title="Export TXT" aria-label="Export transcript as text">
              <Download className="h-4 w-4" />
            </a>
          ) : (
            <span className="btn-icon h-8 w-8 opacity-45" title="Requires the operator role">
              <Download className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
      <ul ref={listRef} className={cx('panel-inset min-h-0 flex-1 overflow-y-auto p-1', compact ? 'max-h-[230px]' : 'max-h-[60vh]')} aria-live="polite" aria-relevant="additions" onWheel={() => auto && setAuto(false)}>
        {filtered.length === 0 ? (
          <Empty title={segs.length === 0 ? 'No transcript yet' : 'No matching lines'}>{segs.length === 0 ? 'Speech from online channels appears here as it is transcribed.' : 'Try another channel or search term.'}</Empty>
        ) : (
          filtered.map((s) => <TranscriptLine key={s.id} seg={s} channel={chMap.get(s.channel_id)} redacted={redacted} showChannel={channelId === 'all'} />)
        )}
      </ul>
    </div>
  );
}
