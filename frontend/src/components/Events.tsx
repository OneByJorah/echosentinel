import { useEffect, useRef, useState } from 'react';
import { AlertOctagon, Bell, Bookmark, Car, Check, Dog, DoorClosed, GlassWater, Megaphone, MoreHorizontal, Pause, Play, Siren, Users, Waves, X } from 'lucide-react';
import type { AudioEvent, Channel, EventCategory, EventStatus } from '../lib/types';
import { categoryLabel, clock } from '../lib/format';
import { playClip } from '../lib/playback';
import { useCurrentClip } from '../hooks/usePlayback';
import { useReviewEvent } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { Badge, cx } from './ui';

export const CATEGORY_ICON: Record<EventCategory, typeof Dog> = {
  speech: Users,
  barking: Dog,
  alarm_siren: Siren,
  glass_break: GlassWater,
  gunshot_like: AlertOctagon,
  distress: Megaphone,
  vehicle: Car,
  knock: DoorClosed,
  other: Waves,
};

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  speech: '#9b7bff',
  barking: '#FFB300',
  alarm_siren: '#f2555a',
  glass_break: '#5cc8ff',
  gunshot_like: '#f2555a',
  distress: '#ff7a59',
  vehicle: '#4fb3ff',
  knock: '#c9a26b',
  other: '#8a877e',
};

export const STATUS_TONE: Record<EventStatus, 'amber' | 'ok' | 'muted' | 'speech'> = {
  new: 'amber',
  acknowledged: 'ok',
  dismissed: 'muted',
  bookmarked: 'speech',
};

export function ClipButton({ ev }: { ev: AudioEvent }) {
  const current = useCurrentClip();
  const toast = useToast();
  const { can } = useAuth();
  const playing = !!ev.clip_url && current === ev.clip_url;
  const disabled = !ev.clip_url || !can('operator');
  return (
    <button
      type="button"
      className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-bone-muted/60 text-bone transition-colors hover:border-amber hover:text-amber disabled:opacity-35', playing && 'border-amber text-amber')}
      disabled={disabled}
      title={!ev.clip_url ? 'No audio clip saved for this event' : !can('operator') ? 'Requires the operator role' : playing ? 'Stop clip' : 'Play clip'}
      aria-label={playing ? 'Stop clip' : `Play clip of ${ev.label}`}
      onClick={() => ev.clip_url && playClip(ev.clip_url).catch((e) => toast('error', errText(e)))}
    >
      {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
    </button>
  );
}

export function ReviewMenu({ ev }: { ev: AudioEvent }) {
  const [open, setOpen] = useState(false);
  const review = useReviewEvent();
  const toast = useToast();
  const { can } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
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
  const act = (status: EventStatus, verb: string) => {
    setOpen(false);
    review.mutate({ id: ev.id, status }, { onSuccess: () => toast('ok', verb), onError: (e) => toast('error', errText(e)) });
  };
  const allowed = can('operator');
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-icon h-9 w-9 border-transparent bg-transparent" aria-label="Review actions" aria-expanded={open} disabled={!allowed} title={allowed ? 'Review actions' : 'Requires the operator role'} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="panel absolute right-0 top-10 z-30 w-48 p-1 text-sm">
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => act('acknowledged', 'Event acknowledged')}>
            <Check className="h-4 w-4 text-ok" /> Acknowledge
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => act('bookmarked', 'Event bookmarked')}>
            <Bookmark className="h-4 w-4 text-speech" /> Bookmark
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => act('dismissed', 'Marked as false positive')}>
            <X className="h-4 w-4 text-bone-muted" /> Dismiss (false positive)
          </button>
          {ev.status !== 'new' && (
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-ink-700" onClick={() => act('new', 'Event reopened')}>
              <Bell className="h-4 w-4 text-amber" /> Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function EventRow({ ev, channel, onSelect, selected }: { ev: AudioEvent; channel?: Channel; onSelect?: (ev: AudioEvent) => void; selected?: boolean }) {
  const Icon = CATEGORY_ICON[ev.category] ?? Waves;
  const color = CATEGORY_COLOR[ev.category] ?? '#8a877e';
  const fresh = Date.now() - new Date(ev.at).getTime() < 60_000;
  return (
    <li
      className={cx('flex items-center gap-3 rounded-lg border bg-ink-800 py-2 pl-3 pr-1.5', selected ? 'border-amber' : ev.status === 'new' && fresh ? 'border-amber/70' : 'border-ink-600', ev.status === 'dismissed' && 'opacity-60')}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <Icon className="h-6 w-6 shrink-0" style={{ color }} aria-hidden />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect?.(ev)} disabled={!onSelect}>
        <div className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-semibold">{categoryLabel(ev.category)}</span>
          {ev.label && ev.label.toLowerCase() !== categoryLabel(ev.category).toLowerCase() && <span className="truncate text-xs text-bone-muted">({ev.label})</span>}
        </div>
        <div className="num flex flex-wrap items-center gap-x-2 text-[12px] text-bone-muted">
          <span>{channel ? `CH${String(channel.slot).padStart(2, '0')}` : `#${ev.channel_id}`}</span>
          <span>{clock(ev.at)}</span>
          <span title={`Model ${ev.model}. Score is the classifier's output, not proof.`}>score {ev.score.toFixed(2)}</span>
          {fresh && ev.status === 'new' && <Badge tone="amber">Live</Badge>}
          {ev.status !== 'new' && <Badge tone={STATUS_TONE[ev.status]}>{ev.status}</Badge>}
          {ev.demo && <Badge tone="amber">demo</Badge>}
        </div>
      </button>
      <ClipButton ev={ev} />
      <ReviewMenu ev={ev} />
    </li>
  );
}
