import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { live } from '../lib/live';
import type { AudioEvent, Channel, EventStats, EventStatus, Metrics, Page, PipelineStatus, Segment, Settings } from '../lib/types';
import { useLive } from './useLive';

/** Channels: live WS snapshot wins; REST is the initial / fallback source. */
export function useChannels(): { channels: Channel[] | null; loading: boolean; error: unknown } {
  const liveChannels = useLive((s) => s.channels);
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('/channels'), refetchInterval: liveChannels ? false : 10_000 });
  return { channels: liveChannels ?? q.data ?? null, loading: !liveChannels && q.isLoading, error: liveChannels ? null : q.error };
}

export function useChannelMap(): Map<number, Channel> {
  const { channels } = useChannels();
  const m = new Map<number, Channel>();
  channels?.forEach((c) => m.set(c.id, c));
  return m;
}

export function useMetrics(): Metrics | null {
  const m = useLive((s) => s.metrics);
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => api<Metrics>('/system/metrics'), refetchInterval: m ? false : 10_000 });
  return m ?? q.data ?? null;
}

export function usePipeline(): PipelineStatus | null {
  const p = useLive((s) => s.pipeline);
  const q = useQuery({ queryKey: ['pipeline'], queryFn: () => api<PipelineStatus>('/system/pipeline'), refetchInterval: p ? 30_000 : 10_000 });
  return p ?? q.data ?? null;
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 30_000 });
}

export function useEventStats() {
  const latest = useLive((s) => s.events[0]?.id);
  const q = useQuery({ queryKey: ['events', 'stats'], queryFn: () => api<EventStats>('/events/stats'), refetchInterval: 60_000 });
  const { refetch } = q;
  useEffect(() => {
    if (latest !== undefined) void refetch();
  }, [latest, refetch]);
  return q;
}

/** Seed live store with recent history once. */
export function useSeedLive() {
  const t = useQuery({ queryKey: ['seed', 'transcripts'], queryFn: () => api<Page<Segment>>('/transcripts', { query: { limit: 60 } }), staleTime: Infinity });
  const e = useQuery({ queryKey: ['seed', 'events'], queryFn: () => api<Page<AudioEvent>>('/events', { query: { limit: 30 } }), staleTime: Infinity });
  useEffect(() => {
    if (t.data) live.seedTranscripts(t.data.items);
  }, [t.data]);
  useEffect(() => {
    if (e.data) live.seedEvents(e.data.items);
  }, [e.data]);
}

export function useReviewEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status?: EventStatus; note?: string | null }) => api<AudioEvent>(`/events/${id}`, { method: 'PATCH', body: { status, note } }),
    onSuccess: (ev) => {
      live.patchEvent(ev);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useReconnect() {
  return useMutation({
    mutationFn: (id: number) => api<Channel>(`/channels/${id}/reconnect`, { method: 'POST' }),
    onSuccess: (ch) => live.patchChannel(ch),
  });
}
