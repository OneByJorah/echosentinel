// Global recorded-audio playback (one HTMLAudioElement, Range-capable server URLs).
import { API } from './api';

export interface PlaybackState {
  recordingId: number | null;
  channelId: number | null;
  /** epoch ms of the recording's t=0 */
  baseMs: number | null;
  src: string | null;
  label: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  error: string | null;
  timelineMounted: number;
}

type L = () => void;

class Playback {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<L>();
  state: PlaybackState = { recordingId: null, channelId: null, baseMs: null, src: null, label: null, playing: false, currentTime: 0, duration: 0, rate: 1, error: null, timelineMounted: 0 };

  subscribe = (fn: L) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(p: Partial<PlaybackState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private el(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('timeupdate', () => this.set({ currentTime: a.currentTime }));
    a.addEventListener('durationchange', () => this.set({ duration: Number.isFinite(a.duration) ? a.duration : 0 }));
    a.addEventListener('play', () => this.set({ playing: true, error: null }));
    a.addEventListener('pause', () => this.set({ playing: false }));
    a.addEventListener('ended', () => this.set({ playing: false }));
    a.addEventListener('error', () => this.set({ playing: false, error: 'Recording could not be played' }));
    this.audio = a;
    return a;
  }

  /** Load a recording and seek; plays when autoplay=true (call from a user gesture). */
  async open(opts: { recordingId: number; channelId: number; baseMs: number; offsetS: number; label?: string; autoplay?: boolean }) {
    const a = this.el();
    const src = `${API}/recordings/${opts.recordingId}/audio`;
    if (this.state.src !== src) {
      a.src = src;
      this.set({ src, recordingId: opts.recordingId, channelId: opts.channelId, baseMs: opts.baseMs, currentTime: 0, duration: 0 });
    }
    this.set({ label: opts.label ?? null, error: null });
    a.playbackRate = this.state.rate;
    const seek = () => {
      try {
        a.currentTime = Math.max(0, opts.offsetS);
      } catch {
        /* not seekable yet */
      }
    };
    if (a.readyState >= 1) seek();
    else a.addEventListener('loadedmetadata', seek, { once: true });
    if (opts.autoplay) {
      try {
        await a.play();
      } catch {
        this.set({ error: 'Playback was blocked by the browser. Press play.' });
      }
    }
  }

  toggle() {
    const a = this.audio;
    if (!a || !this.state.src) return;
    if (a.paused) void a.play().catch(() => this.set({ error: 'Playback was blocked by the browser.' }));
    else a.pause();
  }
  pause() {
    this.audio?.pause();
  }
  skip(s: number) {
    const a = this.audio;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + s));
  }
  seekTo(s: number) {
    if (this.audio) this.audio.currentTime = Math.max(0, s);
  }
  setRate(r: number) {
    this.set({ rate: r });
    if (this.audio) this.audio.playbackRate = r;
  }
  close() {
    this.audio?.pause();
    if (this.audio) this.audio.removeAttribute('src');
    this.set({ src: null, recordingId: null, channelId: null, baseMs: null, label: null, playing: false, currentTime: 0, duration: 0 });
  }
  mountTimeline(d: 1 | -1) {
    this.set({ timelineMounted: this.state.timelineMounted + d });
  }
}

export const playback = new Playback();

/** Plays short event clips (independent from recording playback). */
let clipAudio: HTMLAudioElement | null = null;
let clipListeners = new Set<() => void>();
let clipUrl: string | null = null;
export function playClip(url: string): Promise<void> {
  if (!clipAudio) {
    clipAudio = new Audio();
    clipAudio.addEventListener('ended', () => {
      clipUrl = null;
      clipListeners.forEach((f) => f());
    });
    clipAudio.addEventListener('pause', () => {
      clipUrl = null;
      clipListeners.forEach((f) => f());
    });
  }
  if (clipUrl === url && !clipAudio.paused) {
    clipAudio.pause();
    return Promise.resolve();
  }
  playback.pause();
  clipAudio.src = url;
  clipUrl = url;
  clipListeners.forEach((f) => f());
  return clipAudio.play();
}
export function currentClip() {
  return clipUrl;
}
export function onClipChange(f: () => void) {
  clipListeners.add(f);
  return () => {
    clipListeners.delete(f);
  };
}
export function _resetClipListeners() {
  clipListeners = new Set();
}
