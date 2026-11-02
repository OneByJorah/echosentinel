import { useEffect, useRef, useState } from 'react';
import { live } from '../lib/live';
import { useReducedMotion } from '../hooks/useLive';

const STALE_MS = 1500;

/**
 * Rolling waveform drawn from real decoded-audio peaks (levels WS messages).
 * When no fresh data arrives the canvas stops animating and shows a flat line.
 */
export function LiveWaveform({ channelId, active, height = 96, bars = 150 }: { channelId: number; active: boolean; height?: number; bars?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let lastDrawnUpdate = -1;

    const draw = () => {
      const ring = live.peaks.get(channelId);
      const fresh = !!ring && performance.now() - ring.updatedAt < STALE_MS;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        lastDrawnUpdate = -1;
      }
      const updated = ring?.updatedAt ?? 0;
      if (updated !== lastDrawnUpdate) {
        lastDrawnUpdate = updated;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const mid = h / 2;
        ctx.fillStyle = 'rgba(255,179,0,0.18)';
        ctx.fillRect(0, mid - 0.5, w, 1);
        if (ring && fresh && active) {
          const n = Math.max(16, Math.min(bars, Math.floor(w / 3)));
          const vals = ring.latest(n);
          const step = w / n;
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, '#FFD466');
          grad.addColorStop(0.5, '#FFB300');
          grad.addColorStop(1, '#FFD466');
          ctx.fillStyle = grad;
          ctx.shadowColor = 'rgba(255,179,0,0.45)';
          ctx.shadowBlur = 6;
          for (let i = 0; i < n; i++) {
            // sqrt for perceptual scaling of quiet signals
            const v = Math.sqrt(vals[i]);
            const bh = Math.max(1, v * (h - 6));
            ctx.fillRect(i * step + step * 0.2, mid - bh / 2, Math.max(1, step * 0.6), bh);
          }
          ctx.shadowBlur = 0;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [channelId, active, bars, reduced]);

  if (reduced) return <LevelBar channelId={channelId} active={active} />;
  return <canvas ref={canvas} className="block w-full" style={{ height }} aria-label="Live audio waveform from decoded stream" role="img" />;
}

/** Reduced-motion alternative: a plain RMS level bar updated a few times per second. */
export function LevelBar({ channelId, active }: { channelId: number; active: boolean }) {
  const [rms, setRms] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const r = live.peaks.get(channelId);
      setRms(r && performance.now() - r.updatedAt < STALE_MS ? r.rms : null);
    }, 300);
    return () => clearInterval(t);
  }, [channelId]);
  const v = active && rms !== null ? Math.min(1, Math.sqrt(rms) * 1.6) : 0;
  return (
    <div className="flex h-24 flex-col justify-center gap-2">
      <div className="h-3 w-full overflow-hidden rounded-full bg-ink-600" role="meter" aria-label="Audio level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
        <div className="h-full bg-amber" style={{ width: `${v * 100}%` }} />
      </div>
      <span className="num text-xs text-bone-muted">{rms === null || !active ? 'No audio data' : `Level ${(v * 100).toFixed(0)}%`}</span>
    </div>
  );
}
