import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl } from '../lib/api';
import { LivePcmPlayer } from '../lib/pcm';

export type ListenState = 'idle' | 'connecting' | 'playing' | 'stopped' | 'error';

/** Per-channel live listening. start() must be called from a click handler (autoplay policy). */
export function useListener(channelId: number) {
  const player = useRef<LivePcmPlayer | null>(null);
  const [state, setState] = useState<ListenState>('idle');
  const [detail, setDetail] = useState<string | undefined>();
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);

  const start = useCallback(async () => {
    const p = new LivePcmPlayer();
    p.onState = (s, d) => {
      setState(s);
      setDetail(d);
    };
    player.current?.stop();
    player.current = p;
    p.setVolume(volume);
    p.setMuted(muted);
    try {
      await p.start(wsUrl(`/ws/audio/${channelId}`));
    } catch (e) {
      setState('error');
      setDetail(e instanceof Error ? e.message : 'Audio could not start');
    }
  }, [channelId, volume, muted]);

  const stop = useCallback(() => {
    player.current?.stop();
    player.current = null;
    setState('idle');
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    player.current?.setVolume(v);
  }, []);
  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    player.current?.setMuted(m);
  }, []);

  useEffect(() => () => player.current?.stop(), []);

  const listening = state === 'connecting' || state === 'playing';
  return { state, detail, listening, start, stop, volume, setVolume, muted, setMuted };
}
