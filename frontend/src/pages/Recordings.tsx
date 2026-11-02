import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileAudio, Loader2, Play } from 'lucide-react';
import { api, download } from '../lib/api';
import type { Recording } from '../lib/types';
import { bytes, channelLabel, dateTime, duration, fromLocalInput, toLocalInput } from '../lib/format';
import { useChannels } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { playback } from '../lib/playback';
import { TimelinePanel } from '../components/Timeline';
import { Badge, Button, Empty, ErrorNote, PageHeader, Panel } from '../components/ui';

export default function Recordings() {
  const { channels } = useChannels();
  const { can } = useAuth();
  const toast = useToast();
  const [channelId, setChannelId] = useState<number | ''>('');
  const [day, setDay] = useState(() => toLocalInput(new Date(Date.now() - 24 * 3600_000)));
  const startIso = fromLocalInput(day);

  const recs = useQuery({
    queryKey: ['recordings-list', channelId, startIso],
    queryFn: () => api<Recording[]>('/recordings', { query: { channel_id: channelId || undefined, start: startIso } }),
  });

  const now = useMemo(() => new Date(), []);
  const [clip, setClip] = useState({ channel: '' as number | '', start: toLocalInput(new Date(now.getTime() - 5 * 60_000)), end: toLocalInput(now) });
  const [busy, setBusy] = useState(false);

  const exportClip = async () => {
    const s = fromLocalInput(clip.start);
    const e = fromLocalInput(clip.end);
    if (!clip.channel || !s || !e) return toast('error', 'Choose a channel, start and end.');
    if (new Date(e).getTime() - new Date(s).getTime() > 15 * 60_000) return toast('error', 'Clips are limited to 15 minutes.');
    if (new Date(e) <= new Date(s)) return toast('error', 'End must be after start.');
    setBusy(true);
    try {
      const ch = channels?.find((c) => c.id === clip.channel);
      await download('/exports/clip', { method: 'POST', body: { channel_id: clip.channel, start: s, end: e }, filename: `echosentinel_CH${String(ch?.slot ?? 0).padStart(2, '0')}_${s.replace(/[:.]/g, '-')}.mp3` });
      toast('ok', 'Clip exported');
    } catch (x) {
      toast('error', errText(x));
    } finally {
      setBusy(false);
    }
  };

  const chMap = new Map((channels ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <PageHeader title="Recordings" subtitle="Browse recorded audio, jump to events and export clips." />
      {channels && <TimelinePanel channels={channels} tall title="Timeline" />}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel
          title="Recorded segments"
          icon={<FileAudio className="h-5 w-5" />}
          actions={
            <>
              <select className="input w-auto py-1.5 text-[13px]" value={channelId} onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : '')} aria-label="Filter by channel">
                <option value="">All channels</option>
                {channels?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelLabel(c.slot, c.name)}
                  </option>
                ))}
              </select>
              <input type="datetime-local" className="input w-auto py-1.5 text-[13px]" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Show recordings since" />
            </>
          }
        >
          <ErrorNote error={recs.error} />
          {recs.isLoading ? (
            <p className="py-6 text-center text-sm text-bone-muted">
              <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : !recs.data?.length ? (
            <Empty title="No recordings in this range">Recording starts automatically for online channels with recording enabled.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-bone-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Channel</th>
                    <th className="px-2 py-2 font-medium">Start</th>
                    <th className="px-2 py-2 font-medium">Duration</th>
                    <th className="px-2 py-2 font-medium">Size</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="num">
                  {recs.data.map((r) => {
                    const ch = chMap.get(r.channel_id);
                    return (
                      <tr key={r.id} className="border-t border-ink-600/70 hover:bg-ink-750">
                        <td className="px-2 py-2 font-sans">{ch ? channelLabel(ch.slot, ch.name) : `#${r.channel_id}`}</td>
                        <td className="px-2 py-2">{dateTime(r.start)}</td>
                        <td className="px-2 py-2">{duration(r.duration_s)}</td>
                        <td className="px-2 py-2">{bytes(r.bytes)}</td>
                        <td className="px-2 py-2">
                          <Badge tone={r.status === 'complete' ? 'ok' : r.status === 'writing' ? 'amber' : 'bad'}>{r.status}</Badge>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn-icon h-8 w-8"
                              aria-label="Play recording"
                              onClick={() => void playback.open({ recordingId: r.id, channelId: r.channel_id, baseMs: new Date(r.start).getTime(), offsetS: 0, label: `${ch ? channelLabel(ch.slot) : ''} ${dateTime(r.start)}`, autoplay: true })}
                            >
                              <Play className="h-4 w-4" />
                            </button>
                            <a className="btn-icon h-8 w-8" href={r.url} download aria-label="Download recording" title="Download">
                              <Download className="h-4 w-4" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Export a clip" icon={<Download className="h-5 w-5" />}>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="clip-ch">
                Channel
              </label>
              <select id="clip-ch" className="input" value={clip.channel} onChange={(e) => setClip({ ...clip, channel: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Choose a channel</option>
                {channels?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelLabel(c.slot, c.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div>
                <label className="label" htmlFor="clip-s">
                  Start
                </label>
                <input id="clip-s" type="datetime-local" step={1} className="input" value={clip.start} onChange={(e) => setClip({ ...clip, start: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="clip-e">
                  End
                </label>
                <input id="clip-e" type="datetime-local" step={1} className="input" value={clip.end} onChange={(e) => setClip({ ...clip, end: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-bone-dim">MP3, up to 15 minutes. Start/end times and channel are included in the export metadata. Exports are audit-logged.</p>
            <Button variant="primary" className="w-full" onClick={exportClip} disabled={busy} disabledReason={!can('operator') && 'Requires the operator role'}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export clip
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
