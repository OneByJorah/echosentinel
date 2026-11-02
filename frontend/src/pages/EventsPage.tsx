import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, Save, Siren } from 'lucide-react';
import { api } from '../lib/api';
import { EVENT_CATEGORIES, type AudioEvent, type Page } from '../lib/types';
import { categoryLabel, channelLabel, dateTime, fromLocalInput } from '../lib/format';
import { useChannels, useEventStats, useReviewEvent } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { playEvent } from '../hooks/usePlayback';
import { EventRow } from '../components/Events';
import { Button, Empty, ErrorNote, PageHeader, Panel } from '../components/ui';

export default function EventsPage() {
  const [sp, setSp] = useSearchParams();
  const { channels } = useChannels();
  const stats = useEventStats();
  const f = {
    category: sp.get('category') ?? '',
    channel_id: sp.get('channel_id') ?? '',
    status: sp.get('status') ?? '',
    start: sp.get('start') ?? '',
    end: sp.get('end') ?? '',
  };
  const setF = (k: keyof typeof f, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const q = useInfiniteQuery({
    queryKey: ['events', 'list', f],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AudioEvent>>('/events', { query: { category: f.category, channel_id: f.channel_id, status: f.status, start: fromLocalInput(f.start), end: fromLocalInput(f.end), limit: 50, before_id: pageParam } }),
    getNextPageParam: (p) => p.next_before_id ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const [sel, setSel] = useState<AudioEvent | null>(null);
  const selected = sel ? (items.find((i) => i.id === sel.id) ?? sel) : null;
  const chMap = new Map((channels ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Events"
        subtitle="Sounds detected by the local classifier. Scores are model outputs, not proof — review before acting."
        actions={
          stats.data && (
            <div className="num flex gap-3 text-sm">
              <span>
                <span className="text-amber">{stats.data.unreviewed}</span> to review
              </span>
              <span className="text-bone-muted">{stats.data.today} today</span>
            </div>
          )
        }
      />
      <Panel>
        <div className="grid gap-2 pt-4 sm:grid-cols-2 lg:grid-cols-5">
          <select className="input" value={f.category} onChange={(e) => setF('category', e.target.value)} aria-label="Category">
            <option value="">All sound types</option>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
                {stats.data?.by_category[c] ? ` (${stats.data.by_category[c]})` : ''}
              </option>
            ))}
          </select>
          <select className="input" value={f.channel_id} onChange={(e) => setF('channel_id', e.target.value)} aria-label="Channel">
            <option value="">All channels</option>
            {channels?.map((c) => (
              <option key={c.id} value={c.id}>
                {channelLabel(c.slot, c.name)}
              </option>
            ))}
          </select>
          <select className="input" value={f.status} onChange={(e) => setF('status', e.target.value)} aria-label="Review status">
            <option value="">Any status</option>
            <option value="new">Needs review</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="bookmarked">Bookmarked</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <input type="datetime-local" className="input" value={f.start} onChange={(e) => setF('start', e.target.value)} aria-label="From" />
          <input type="datetime-local" className="input" value={f.end} onChange={(e) => setF('end', e.target.value)} aria-label="To" />
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="Events" icon={<Siren className="h-5 w-5" />}>
          <ErrorNote error={q.error} />
          {q.isLoading ? (
            <p className="py-6 text-center text-sm text-bone-muted">Loading…</p>
          ) : items.length === 0 ? (
            <Empty title="No events match">Change the filters, or check the classifier status on the System page.</Empty>
          ) : (
            <ul className="space-y-2">
              {items.map((ev) => (
                <EventRow key={ev.id} ev={ev} channel={chMap.get(ev.channel_id)} onSelect={setSel} selected={selected?.id === ev.id} />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <Button className="mt-3 w-full" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />} Load older events
            </Button>
          )}
        </Panel>
        <EventDetail key={selected?.id ?? 0} ev={selected} channelName={selected ? (chMap.get(selected.channel_id) ? channelLabel(chMap.get(selected.channel_id)!.slot, chMap.get(selected.channel_id)!.name) : `#${selected.channel_id}`) : ''} />
      </div>
    </div>
  );
}

function EventDetail({ ev, channelName }: { ev: AudioEvent | null; channelName: string }) {
  const [note, setNote] = useState(ev?.note ?? '');
  const review = useReviewEvent();
  const toast = useToast();
  const { can } = useAuth();
  if (!ev)
    return (
      <Panel title="Details">
        <Empty title="Select an event">Choose an event to see details, add a note and play the recording around it.</Empty>
      </Panel>
    );
  return (
    <Panel title="Details">
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-bone-muted">Sound</dt>
        <dd>
          {categoryLabel(ev.category)} <span className="text-bone-muted">({ev.label})</span>
        </dd>
        <dt className="text-bone-muted">Channel</dt>
        <dd>{channelName}</dd>
        <dt className="text-bone-muted">Time</dt>
        <dd className="num">{dateTime(ev.at)}</dd>
        <dt className="text-bone-muted">Score</dt>
        <dd className="num">{ev.score.toFixed(3)}</dd>
        <dt className="text-bone-muted">Model</dt>
        <dd className="num break-all">{ev.model}</dd>
        <dt className="text-bone-muted">Status</dt>
        <dd className="capitalize">{ev.status}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => !playEvent(ev) && toast('error', 'No recording covers this event')} disabled={ev.recording_id === null} title={ev.recording_id === null ? 'No recording covers this event' : undefined}>
          Play in recording
        </Button>
        {ev.clip_url && can('operator') && (
          <a className="btn" href={ev.clip_url} download>
            Download clip
          </a>
        )}
      </div>
      <label className="label mt-4" htmlFor="ev-note">
        Note
      </label>
      <textarea id="ev-note" className="input min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)} disabled={!can('operator')} maxLength={2000} placeholder="What did you find when you reviewed this?" />
      <Button
        className="mt-2"
        variant="primary"
        disabledReason={!can('operator') && 'Requires the operator role'}
        disabled={review.isPending}
        onClick={() => review.mutate({ id: ev.id, note: note || null }, { onSuccess: () => toast('ok', 'Note saved'), onError: (e) => toast('error', errText(e)) })}
      >
        <Save className="h-4 w-4" /> Save note
      </Button>
    </Panel>
  );
}
