// Single live store fed by /ws/live. Components subscribe with useSyncExternalStore.
import { wsUrl } from './api';
import type { AudioEvent, Channel, LiveMessage, Metrics, NotificationMsg, PipelineStatus, Segment } from './types';

export type ConnState = 'connecting' | 'open' | 'closed';

export interface LiveState {
  conn: ConnState;
  version: string | null;
  channels: Channel[] | null;
  metrics: Metrics | null;
  pipeline: PipelineStatus | null;
  transcripts: Segment[]; // oldest → newest, capped
  events: AudioEvent[]; // newest first, capped
  notifications: (NotificationMsg & { read: boolean })[];
  lastLevelAt: Record<number, number>;
}

const MAX_TRANSCRIPTS = 400;
const MAX_EVENTS = 100;
const LEVEL_HISTORY = 600; // peaks kept per channel (~12 s at 20 ms windows)

/** Ring buffer of recent peaks per channel – kept outside React state for 60fps canvas drawing. */
export class PeakRing {
  readonly data = new Float32Array(LEVEL_HISTORY);
  head = 0; // next write index
  count = 0;
  rms = 0;
  updatedAt = 0;
  push(peaks: number[], rms: number) {
    for (const p of peaks) {
      this.data[this.head] = Math.max(0, Math.min(1, p));
      this.head = (this.head + 1) % LEVEL_HISTORY;
      this.count = Math.min(LEVEL_HISTORY, this.count + 1);
    }
    this.rms = rms;
    this.updatedAt = performance.now();
  }
  /** Return the latest n values oldest→newest (padding with 0 when not enough). */
  latest(n: number): Float32Array {
    const out = new Float32Array(n);
    const take = Math.min(n, this.count);
    for (let i = 0; i < take; i++) {
      const idx = (this.head - take + i + LEVEL_HISTORY) % LEVEL_HISTORY;
      out[n - take + i] = this.data[idx];
    }
    return out;
  }
}

type Listener = () => void;

class LiveStore {
  private state: LiveState = {
    conn: 'closed',
    version: null,
    channels: null,
    metrics: null,
    pipeline: null,
    transcripts: [],
    events: [],
    notifications: [],
    lastLevelAt: {},
  };
  readonly peaks = new Map<number, PeakRing>();
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  private eventListeners = new Set<(e: AudioEvent) => void>();

  getState = () => this.state;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  onEvent(fn: (e: AudioEvent) => void) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  ring(channelId: number): PeakRing {
    let r = this.peaks.get(channelId);
    if (!r) {
      r = new PeakRing();
      this.peaks.set(channelId, r);
    }
    return r;
  }

  connect() {
    this.wanted = true;
    if (this.ws && this.ws.readyState <= 1) return;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000);
    this.ws = null;
    this.set({ conn: 'closed' });
  }

  private open() {
    this.set({ conn: 'connecting' });
    const ws = new WebSocket(wsUrl('/ws/live'));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ conn: 'open' });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        this.handle(JSON.parse(ev.data) as LiveMessage);
      } catch {
        /* malformed frame – ignore */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.set({ conn: 'closed' });
      if (!this.wanted) return;
      // Exponential backoff with jitter, capped at 30 s.
      const base = Math.min(30000, 1000 * 2 ** this.retry);
      const delay = base / 2 + Math.random() * (base / 2);
      this.retry++;
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  handle(msg: LiveMessage) {
    switch (msg.type) {
      case 'hello':
        this.set({ version: msg.version });
        break;
      case 'channels':
        this.set({ channels: [...msg.channels].sort((a, b) => a.slot - b.slot) });
        break;
      case 'levels': {
        this.ring(msg.channel_id).push(msg.peaks, msg.rms);
        // Do not notify React on every level frame; canvases poll the ring.
        this.state.lastLevelAt[msg.channel_id] = msg.t_ms;
        break;
      }
      case 'transcript': {
        const { type: _t, ...seg } = msg;
        void _t;
        const list = this.state.transcripts.slice();
        const idx = list.findIndex((s) => s.id === seg.id);
        if (idx >= 0) list[idx] = seg;
        else list.push(seg);
        this.set({ transcripts: list.slice(-MAX_TRANSCRIPTS) });
        break;
      }
      case 'event': {
        const { type: _t, ...ev } = msg;
        void _t;
        const list = this.state.events.filter((e) => e.id !== ev.id);
        list.unshift(ev);
        this.set({ events: list.slice(0, MAX_EVENTS) });
        this.eventListeners.forEach((f) => f(ev));
        break;
      }
      case 'pipeline': {
        const { type: _t, ...p } = msg;
        void _t;
        this.set({ pipeline: p });
        break;
      }
      case 'metrics': {
        const { type: _t, ...m } = msg;
        void _t;
        this.set({ metrics: m });
        break;
      }
      case 'notification': {
        const { type: _t, ...n } = msg;
        void _t;
        this.set({ notifications: [{ ...n, read: false }, ...this.state.notifications].slice(0, 50) });
        break;
      }
      default:
        break;
    }
  }

  /** Seed lists from REST on first load so panels aren't empty before live traffic. */
  seedTranscripts(items: Segment[]) {
    const known = new Set(this.state.transcripts.map((s) => s.id));
    const merged = [...items.filter((s) => !known.has(s.id)), ...this.state.transcripts].sort((a, b) => a.start.localeCompare(b.start));
    this.set({ transcripts: merged.slice(-MAX_TRANSCRIPTS) });
  }

  seedEvents(items: AudioEvent[]) {
    const known = new Set(this.state.events.map((e) => e.id));
    const merged = [...this.state.events, ...items.filter((e) => !known.has(e.id))].sort((a, b) => b.at.localeCompare(a.at));
    this.set({ events: merged.slice(0, MAX_EVENTS) });
  }

  patchEvent(ev: AudioEvent) {
    this.set({ events: this.state.events.map((e) => (e.id === ev.id ? ev : e)) });
  }

  patchChannel(ch: Channel) {
    if (!this.state.channels) return;
    this.set({ channels: this.state.channels.map((c) => (c.id === ch.id ? ch : c)) });
  }

  markNotificationsRead() {
    this.set({ notifications: this.state.notifications.map((n) => ({ ...n, read: true })) });
  }

  clearNotifications() {
    this.set({ notifications: [] });
  }
}

export const live = new LiveStore();
