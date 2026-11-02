// PCM helpers for the /ws/audio stream (s16le, mono, 16 kHz).

export function decodeS16LE(buf: ArrayBuffer): Float32Array {
  const n = Math.floor(buf.byteLength / 2);
  const view = new DataView(buf, 0, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function peakAbs(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

export interface StreamFormat {
  format: string;
  sample_rate: number;
  channels: number;
}

/**
 * Plays a live PCM stream from a WebSocket through Web Audio with a gain node.
 * Must be started from a user gesture (autoplay policies).
 */
export class LivePcmPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private ws: WebSocket | null = null;
  private playhead = 0;
  private sampleRate = 16000;
  private volume = 1;
  private muted = false;
  onState: (s: 'connecting' | 'playing' | 'stopped' | 'error', detail?: string) => void = () => {};

  async start(url: string) {
    this.stop();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      this.ctx = new Ctx({ sampleRate: 16000 });
    } catch {
      this.ctx = new Ctx();
    }
    await this.ctx.resume();
    this.gain = this.ctx.createGain();
    this.applyGain();
    this.gain.connect(this.ctx.destination);
    this.playhead = 0;
    this.onState('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const f = JSON.parse(ev.data) as StreamFormat;
          if (f.sample_rate) this.sampleRate = f.sample_rate;
        } catch {
          /* ignore */
        }
        return;
      }
      this.enqueue(decodeS16LE(ev.data as ArrayBuffer));
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.onState(ev.code === 4404 ? 'error' : 'stopped', ev.code === 4404 ? 'Channel is offline' : ev.reason || undefined);
      this.teardownAudio();
    };
    ws.onerror = () => this.onState('error', 'Audio stream failed');
  }

  private enqueue(samples: Float32Array) {
    if (!this.ctx || !this.gain || samples.length === 0) return;
    const buf = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    // Keep ~150 ms of jitter buffer; resync if we fell behind or drifted >1 s ahead.
    if (this.playhead < now + 0.05 || this.playhead > now + 1.0) this.playhead = now + 0.15;
    src.start(this.playhead);
    this.playhead += buf.duration;
    this.onState('playing');
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyGain();
  }

  private applyGain() {
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  private teardownAudio() {
    this.gain?.disconnect();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
  }

  stop() {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close(1000);
    this.teardownAudio();
  }
}
