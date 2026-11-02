import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, Loader2, Search, ShieldCheck } from 'lucide-react';
import { API, api, toQuery } from '../lib/api';
import type { Page, Segment } from '../lib/types';
import { channelLabel, fromLocalInput } from '../lib/format';
import { useChannels } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { TranscriptLine, segmentsToText } from '../components/Transcript';
import { Button, Empty, ErrorNote, PageHeader, Panel, Toggle } from '../components/ui';

export default function Transcripts() {
  const { channels } = useChannels();
  const { can } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState({ q: '', channel_id: '', kind: '', start: '', end: '' });
  const [f, setF] = useState(draft);
  const [redacted, setRedacted] = useState(false);

  const query = { q: f.q, channel_id: f.channel_id, kind: f.kind, start: fromLocalInput(f.start), end: fromLocalInput(f.end) };
  const q = useInfiniteQuery({
    queryKey: ['transcripts', f],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api<Page<Segment>>('/transcripts', { query: { ...query, limit: 100, before_id: pageParam } }),
    getNextPageParam: (p) => p.next_before_id ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const chMap = new Map((channels ?? []).map((c) => [c.id, c]));
  const exportUrl = (format: string) => `${API}/transcripts/export?${toQuery({ ...query, format })}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transcripts"
        subtitle="Machine transcription of recorded speech. Treat text as approximate — play the audio to confirm."
        actions={
          <div className="flex flex-wrap gap-2">
            {(['txt', 'json', 'csv'] as const).map((fmt) =>
              can('operator') ? (
                <a key={fmt} className="btn" href={exportUrl(fmt)}>
                  <Download className="h-4 w-4" /> {fmt.toUpperCase()}
                </a>
              ) : (
                <Button key={fmt} disabledReason="Requires the operator role">
                  <Download className="h-4 w-4" /> {fmt.toUpperCase()}
                </Button>
              ),
            )}
          </div>
        }
      />
      <Panel>
        <form
          className="grid gap-2 pt-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setF(draft);
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-bone-dim" />
            <input className="input pl-8" placeholder="Keyword" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} aria-label="Keyword" />
          </div>
          <select className="input" value={draft.channel_id} onChange={(e) => setDraft({ ...draft, channel_id: e.target.value })} aria-label="Channel">
            <option value="">All channels</option>
            {channels?.map((c) => (
              <option key={c.id} value={c.id}>
                {channelLabel(c.slot, c.name)}
              </option>
            ))}
          </select>
          <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="Type">
            <option value="">Speech and noise</option>
            <option value="speech">Speech</option>
            <option value="noise">Noise</option>
            <option value="unintelligible">Unintelligible</option>
          </select>
          <input type="datetime-local" className="input" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} aria-label="From" />
          <input type="datetime-local" className="input" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} aria-label="To" />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
        </form>
      </Panel>
      <Panel
        title={`Results${items.length ? ` (${items.length}${q.hasNextPage ? '+' : ''})` : ''}`}
        icon={<FileText className="h-5 w-5" />}
        actions={
          <>
            <Toggle checked={redacted} onChange={setRedacted} label="Redact personal details" />
            <span className="sr-only">
              <ShieldCheck />
            </span>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void navigator.clipboard
                  .writeText(segmentsToText([...items].reverse(), chMap, redacted))
                  .then(() => toast('ok', 'Copied'))
                  .catch(() => toast('error', 'Clipboard is not available'))
              }
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
          </>
        }
      >
        <ErrorNote error={q.error} />
        {q.isLoading ? (
          <p className="py-6 text-center text-sm text-bone-muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty title="No transcript lines found">Adjust the search, or check that speech-to-text is running on the System page.</Empty>
        ) : (
          <ul className="panel-inset p-1">
            {items.map((s) => (
              <TranscriptLine key={s.id} seg={s} channel={chMap.get(s.channel_id)} redacted={redacted} showChannel highlight={!!f.q && s.text.toLowerCase().includes(f.q.toLowerCase())} />
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <Button className="mt-3 w-full" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />} Load older lines
          </Button>
        )}
      </Panel>
    </div>
  );
}
