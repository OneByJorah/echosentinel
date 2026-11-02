// Types mirror docs/API.md (v1). Keep in sync with the backend.

export type Role = 'admin' | 'operator' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  disabled?: boolean;
}

export interface Meta {
  name: string;
  version: string;
  demo_mode: boolean;
  setup_required: boolean;
}

export type ChannelState = 'online' | 'connecting' | 'offline' | 'error' | 'disabled' | 'unconfigured';
export type Transport = 'tcp' | 'udp' | 'auto';

export interface Channel {
  id: number;
  slot: number;
  name: string;
  enabled: boolean;
  url_redacted: string | null;
  transport: Transport;
  record: boolean;
  transcribe: boolean;
  classify: boolean;
  state: ChannelState;
  state_reason: string | null;
  codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  latency_ms: number | null;
  last_packet_at: string | null;
  last_seen_at: string | null;
  online_since: string | null;
  retry_at: string | null;
  retry_attempt: number;
  recording: boolean;
  events_today: number;
  demo: boolean;
}

export interface ChannelTestResult {
  ok: boolean;
  codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface ChannelDiagnostics {
  ffmpeg_running: boolean;
  restarts: number;
  last_error: string | null;
  bytes_in: number;
  uptime_s: number;
  status_log: { state: ChannelState; reason: string | null; at: string }[];
}

export type SegmentKind = 'speech' | 'noise' | 'unintelligible';

export interface Segment {
  id: number;
  channel_id: number;
  start: string;
  end: string;
  text: string;
  kind: SegmentKind;
  final: boolean;
  language: string | null;
  confidence: number | null;
  speaker: string | null;
  recording_id: number | null;
  offset_s: number | null;
  demo: boolean;
}

export const EVENT_CATEGORIES = [
  'speech',
  'barking',
  'alarm_siren',
  'glass_break',
  'gunshot_like',
  'distress',
  'vehicle',
  'knock',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventStatus = 'new' | 'acknowledged' | 'dismissed' | 'bookmarked';

export interface AudioEvent {
  id: number;
  channel_id: number;
  at: string;
  category: EventCategory;
  label: string;
  score: number;
  model: string;
  status: EventStatus;
  note: string | null;
  recording_id: number | null;
  offset_s: number | null;
  clip_url: string | null;
  demo: boolean;
}

export interface Page<T> {
  items: T[];
  next_before_id: number | null;
}

export interface EventStats {
  unreviewed: number;
  today: number;
  by_category: Record<string, number>;
}

export interface Recording {
  id: number;
  channel_id: number;
  start: string;
  end: string | null;
  duration_s: number | null;
  bytes: number;
  status: 'writing' | 'complete' | 'damaged';
  url: string;
}

export interface Timeline {
  start: string;
  end: string;
  bucket_s: number;
  coverage: { start: string; end: string; recording_id: number }[];
  gaps: { start: string; end: string; reason: string | null }[];
  offline: { start: string; end: string }[];
  speech: { start: string; end: string; segment_id: number }[];
  events: AudioEvent[];
  peaks: number[];
}

export interface Analytics {
  range: string;
  uptime: { channel_id: number; uptime_pct: number; outages: number }[];
  events_by_category: Record<string, number>;
  events_by_hour: { hour: string; count: number }[];
  speech_minutes_by_channel: Record<string, number>;
  recording_coverage_pct: Record<string, number>;
  stt_latency_ms: { p50: number; p95: number } | null;
  classifier_latency_ms: { p50: number; p95: number } | null;
  error_count: number;
}

export interface Metrics {
  cpu_pct: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  disk_path: string;
  gpu: null | { name: string; util_pct: number; mem_used_bytes: number; mem_total_bytes: number };
  load_avg: number[];
  at: string;
}

export type ServiceState =
  | 'ready'
  | 'loading'
  | 'not_installed'
  | 'not_configured'
  | 'disabled'
  | 'error'
  | 'running'
  | 'unreachable'
  | 'active'
  | 'degraded'
  | 'stopped'
  | 'unavailable';

export interface EngineStatus {
  state: ServiceState;
  engine?: string;
  model?: string;
  device?: string;
  detail?: string | null;
  queue?: number;
  latency_ms_p50?: number | null;
}

export interface PipelineStatus {
  stt: EngineStatus;
  classifier: EngineStatus;
  vad: { state: ServiceState; engine?: string };
  ollama: { state: ServiceState; url_host?: string; model?: string; models?: string[]; detail?: string | null };
  recorder: { state: ServiceState; detail?: string | null; free_bytes?: number; min_free_bytes?: number };
  streams: { online: number; total: number };
  diarization: { state: ServiceState };
}

export interface AuditEntry {
  id: number;
  at: string;
  username: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  detail: string | null;
}

export interface Threshold {
  threshold: number;
  cooldown_s: number;
  enabled: boolean;
}

export interface Settings {
  retention_days: number;
  max_storage_gb: number;
  min_free_gb: number;
  segment_minutes: number;
  transcript_retention_days: number;
  thresholds: Record<string, Threshold>;
  stt_language: string;
  redact_notifications: boolean;
  ollama: { enabled: boolean; url: string; model: string; timeout_s: number };
}

export interface TelegramConfig {
  enabled: boolean;
  chat_id: string;
  bot_token?: string;
  token_set: boolean;
  include_transcript: boolean;
  quiet_hours: { start: string; end: string } | null;
}

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  categories: string[];
  channel_ids: number[];
  min_score: number;
  cooldown_s: number;
  actions: ('telegram' | 'webhook')[];
}

export interface Webhook {
  id: number;
  name: string;
  url_redacted: string;
  enabled: boolean;
}

export interface Summary {
  id: number;
  created_at: string;
  start: string;
  end: string;
  channel_id: number | null;
  model: string;
  text: string;
  citations: { kind: 'segment' | 'event'; id: number; at: string }[];
  ai_generated: boolean;
}

export interface LevelsMsg {
  type: 'levels';
  channel_id: number;
  t_ms: number;
  peaks: number[];
  rms: number;
}

export interface NotificationMsg {
  id: string | number;
  level: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  at: string;
}

export type LiveMessage =
  | { type: 'hello'; version: string; demo_mode: boolean }
  | { type: 'channels'; channels: Channel[] }
  | LevelsMsg
  | ({ type: 'transcript' } & Segment)
  | ({ type: 'event' } & AudioEvent)
  | ({ type: 'pipeline' } & PipelineStatus)
  | ({ type: 'metrics' } & Metrics)
  | ({ type: 'notification' } & NotificationMsg)
  | { type: 'pong' };
