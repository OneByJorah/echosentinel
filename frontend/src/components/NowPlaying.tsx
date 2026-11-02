import { Pause, Play, X, Rewind, FastForward } from 'lucide-react';
import { playback } from '../lib/playback';
import { usePlayback } from '../hooks/usePlayback';
import { clock, duration } from '../lib/format';

/** Floating mini-player for recorded audio when no timeline is on screen. */
export function NowPlaying() {
  const s = usePlayback((x) => x);
  if (!s.src || s.timelineMounted > 0) return null;
  const at = s.baseMs !== null ? s.baseMs + s.currentTime * 1000 : null;
  return (
    <div className="panel fixed bottom-20 left-3 right-3 z-40 flex items-center gap-2 px-3 py-2 sm:left-auto sm:w-[380px] lg:bottom-4">
      <button type="button" className="btn-icon h-8 w-8" aria-label="Back 10 seconds" onClick={() => playback.skip(-10)}>
        <Rewind className="h-4 w-4" />
      </button>
      <button type="button" className="btn-icon h-9 w-9 border-amber text-amber" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => playback.toggle()}>
        {s.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" className="btn-icon h-8 w-8" aria-label="Forward 10 seconds" onClick={() => playback.skip(10)}>
        <FastForward className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{s.label ?? 'Recording'}</div>
        <div className="num text-[11px] text-bone-muted">
          {at ? clock(at) : '—'} · {duration(s.currentTime)} / {duration(s.duration)}
        </div>
        {s.error && <div className="text-[11px] text-warn">{s.error}</div>}
      </div>
      <button type="button" className="btn-icon h-8 w-8" aria-label="Close player" onClick={() => playback.close()}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
