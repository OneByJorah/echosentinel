import { useSyncExternalStore } from 'react';
import { currentClip, onClipChange, playback, type PlaybackState } from '../lib/playback';
import type { AudioEvent, Segment } from '../lib/types';

export function usePlayback<T>(sel: (s: PlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => sel(playback.getState()));
}

export function useCurrentClip(): string | null {
  return useSyncExternalStore(onClipChange, currentClip);
}

/** Open the recording behind a transcript segment or event (from a click). Returns false if no recording. */
export function playAt(item: Pick<Segment, 'recording_id' | 'offset_s' | 'channel_id'> & { start?: string; at?: string }, label?: string): boolean {
  if (item.recording_id === null || item.offset_s === null) return false;
  const t = new Date(item.start ?? item.at ?? Date.now()).getTime();
  void playback.open({ recordingId: item.recording_id, channelId: item.channel_id, baseMs: t - item.offset_s * 1000, offsetS: Math.max(0, item.offset_s - 1), label, autoplay: true });
  return true;
}

export function playEvent(ev: AudioEvent) {
  return playAt({ recording_id: ev.recording_id, offset_s: ev.offset_s, channel_id: ev.channel_id, at: ev.at }, ev.label);
}
