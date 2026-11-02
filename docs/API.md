# EchoSentinel API contract (v1)

Base path: `/api/v1`. All JSON. Timestamps are ISO-8601 UTC strings (`2026-11-02T06:12:00.123Z`) unless named `*_ms` (epoch milliseconds) — the live WebSocket uses epoch ms for compactness.

## Auth & session

* Session cookie `es_session` (HttpOnly, SameSite=Strict, Secure when behind HTTPS).
* CSRF: every non-GET request must send header `X-CSRF-Token` equal to the value of the readable cookie `es_csrf`. The frontend reads `document.cookie` for `es_csrf`.
* Roles: `viewer` (read + listen), `operator` (+ review events, reconnect, export, summaries), `admin` (+ channel config, users, settings, automation).
* 401 → frontend shows login. 403 → show "insufficient role" toast.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` | `User` (sets cookies). 429 when rate-limited |
| POST | `/auth/logout` | – | `{ok:true}` |
| GET | `/auth/me` | – | `User` |
| POST | `/auth/password` | `{current_password, new_password}` | `{ok:true}` |

`User = {id, username, role: 'admin'|'operator'|'viewer', created_at, last_login_at|null}`

## Meta

`GET /meta` (no auth) → `{name:"EchoSentinel", version, demo_mode: bool, setup_required: bool}`.
`setup_required` true when no users exist → UI shows instructions to run `echosentinel create-user` (no web bootstrap).

## Channels

`Channel`:
```json
{
  "id": 1, "slot": 1, "name": "Main Audio", "enabled": true,
  "url_redacted": "rtsp://***@192.168.1.20:554/stream1",   // never contains credentials
  "transport": "tcp" | "udp" | "auto",
  "record": true, "transcribe": true, "classify": true,
  "state": "online" | "connecting" | "offline" | "error" | "disabled" | "unconfigured",
  "state_reason": "Connection refused" | null,
  "codec": "aac" | null, "sample_rate": 16000 | null, "channels": 1 | null,
  "latency_ms": 180 | null,             // probe/connect latency
  "last_packet_at": "...Z" | null, "last_seen_at": "...Z" | null, "online_since": "...Z" | null,
  "retry_at": "...Z" | null,            // next reconnect attempt (offline/error)
  "retry_attempt": 3,
  "recording": true,                    // currently writing segments
  "events_today": 4,
  "demo": false
}
```
Always exactly the configured slots (default 4, `ES_CHANNEL_SLOTS`). Slots without a URL have `state: "unconfigured"`.

| Method | Path | Notes | Role |
|---|---|---|---|
| GET | `/channels` | `Channel[]` ordered by slot | viewer |
| GET | `/channels/{id}` | `Channel` | viewer |
| PUT | `/channels/{id}` | `{name?, url?, transport?, enabled?, record?, transcribe?, classify?}` — `url` write-only; omit to keep | admin |
| POST | `/channels/{id}/reconnect` | forces immediate retry → `Channel` | operator |
| POST | `/channels/test` | `{url, transport}` or `{channel_id}` → `{ok, codec, sample_rate, channels, latency_ms, error|null}` | admin |
| GET | `/channels/{id}/diagnostics` | `{ffmpeg_running, restarts, last_error, bytes_in, uptime_s, status_log: [{state, reason, at}]}` | operator |

## Live WebSocket — `GET /ws/live` (cookie auth)

Server → client messages (`{"type": ..., ...}`):
* `hello` `{version, demo_mode}`
* `channels` `{channels: Channel[]}` — full snapshot, on connect and whenever any state changes
* `levels` `{channel_id, t_ms, peaks: number[], rms: number}` — ~10 msgs/s per online channel; `peaks` are 0..1 absolute sample peaks for consecutive 20 ms windows (5 per message). Real decoded audio only.
* `transcript` `Segment` (see below), may be sent again with same id when finalised
* `event` `Event`
* `pipeline` `PipelineStatus`
* `metrics` `Metrics` every 5 s
* `notification` `{id, level:'info'|'warning'|'error', title, body, at}`

Client → server: `{"type":"ping"}` (server replies `pong`).

## Live audio — `GET /ws/audio/{channel_id}` (cookie auth, viewer)

Binary frames: raw PCM **signed 16-bit little-endian, mono, 16000 Hz**, ~100 ms per frame. First message is a JSON text frame `{"format":"s16le","sample_rate":16000,"channels":1}`. Closes with code 4404 if channel offline. Audit-logged.

## Transcripts

`Segment`:
```json
{"id": 12, "channel_id": 1, "start": "...Z", "end": "...Z",
 "text": "Keep an eye on the front.", "kind": "speech" | "noise" | "unintelligible",
 "final": true, "language": "en" | null, "confidence": 0.82 | null,
 "speaker": null,   // only when diarization validated – currently always null
 "recording_id": 5 | null, "offset_s": 132.4 | null,   // position inside recording file for click-to-play
 "demo": false}
```
| GET | `/transcripts` | query: `q, channel_id, start, end, kind, limit(=100), before_id` → `{items: Segment[], next_before_id}` (newest first) | viewer |
| GET | `/transcripts/export` | same filters + `format=txt|json|csv` → file download | operator |
| DELETE | `/transcripts` | `{start, end, channel_id?}` → `{deleted}` | admin |

## Events

`Event`:
```json
{"id": 4, "channel_id": 1, "at": "...Z", "category": "barking",
 "label": "Dog", "score": 0.71, "model": "yamnet-tflite-1",
 "status": "new" | "acknowledged" | "dismissed" | "bookmarked",
 "note": null, "recording_id": 5 | null, "offset_s": 40.2 | null,
 "clip_url": "/api/v1/events/4/clip" | null, "demo": false}
```
Categories: `speech, barking, alarm_siren, glass_break, gunshot_like, distress, vehicle, knock, other`.

| GET | `/events` | `category, channel_id, status, start, end, limit, before_id` → `{items, next_before_id}` | viewer |
| PATCH | `/events/{id}` | `{status?, note?}` | operator |
| GET | `/events/{id}/clip` | audio/mpeg clip (±5 s) | operator |
| GET | `/events/stats` | `{unreviewed, today, by_category: {cat: n}}` | viewer |

## Recordings & timeline

`Recording = {id, channel_id, start, end|null, duration_s|null, bytes, status:'writing'|'complete'|'damaged', url:"/api/v1/recordings/5/audio"}`

| GET | `/recordings` | `channel_id, start, end` → `Recording[]` | viewer |
| GET | `/recordings/{id}/audio` | audio/mpeg, supports HTTP Range | viewer |
| GET | `/timeline` | `channel_id, start, end, buckets(=300)` → `{start, end, bucket_s, coverage: [{start,end,recording_id}], gaps:[{start,end,reason}], offline:[{start,end}], speech:[{start,end,segment_id}], events: Event[], peaks: number[] /* len=buckets, 0..1, from recorded audio index */}` | viewer |
| POST | `/exports/clip` | `{channel_id, start, end}` (max 15 min) → audio/mpeg download + `X-EchoSentinel-Meta` header JSON | operator |

## Analytics

`GET /analytics?range=24h|7d|30d` → 
```json
{"range":"24h",
 "uptime": [{"channel_id":1, "uptime_pct": 99.1, "outages": 2}],
 "events_by_category": {"barking": 4},
 "events_by_hour": [{"hour":"...Z", "count": 3}],
 "speech_minutes_by_channel": {"1": 12.5},
 "recording_coverage_pct": {"1": 98.0},
 "stt_latency_ms": {"p50": 900, "p95": 2100} | null,
 "classifier_latency_ms": {"p50": 40, "p95": 90} | null,
 "error_count": 3}
```

## System

`Metrics = {cpu_pct, ram_used_bytes, ram_total_bytes, disk_used_bytes, disk_total_bytes, disk_path, gpu: null | {name, util_pct, mem_used_bytes, mem_total_bytes}, load_avg:[1,5,15], at}`

`PipelineStatus`:
```json
{"stt": {"state": "ready"|"loading"|"not_installed"|"disabled"|"error", "engine":"faster-whisper", "model":"base.en", "device":"cpu", "detail": null, "queue": 0, "latency_ms_p50": 900|null},
 "classifier": {"state": ..., "engine":"yamnet-tflite", "model":"...", "detail": null, "queue": 0, "latency_ms_p50": 40|null},
 "vad": {"state": ..., "engine": "silero"|"energy"},
 "ollama": {"state": "running"|"unreachable"|"disabled", "url_host":"127.0.0.1:11434", "model":"llama3.2", "models":["llama3.2"], "detail": null},
 "recorder": {"state":"active"|"degraded"|"stopped", "detail": null, "free_bytes": 1, "min_free_bytes": 1},
 "streams": {"online": 1, "total": 4},
 "diarization": {"state": "unavailable"}}
```
| GET | `/system/metrics` | `Metrics` | viewer |
| GET | `/system/pipeline` | `PipelineStatus` | viewer |
| GET | `/system/audit` | `limit, before_id` → `{items:[{id, at, username, action, target, ip, detail}]}` | admin |
| GET | `/users` · POST `/users` `{username,password,role}` · PATCH `/users/{id}` `{role?, password?, disabled?}` | admin |
| GET/PUT | `/settings` | `Settings` | GET viewer, PUT admin |

`Settings`:
```json
{"retention_days": 30, "max_storage_gb": 200, "min_free_gb": 5, "segment_minutes": 60,
 "transcript_retention_days": 30,
 "thresholds": {"barking": {"threshold":0.5, "cooldown_s":30, "enabled":true}, "...": {}},
 "stt_language": "auto" | "en",
 "redact_notifications": true,
 "ollama": {"enabled": true, "url": "http://127.0.0.1:11434", "model": "llama3.2", "timeout_s": 60}}
```

## Automation

| GET/PUT | `/automation/telegram` | `{enabled, chat_id, bot_token?(write-only), token_set: bool, include_transcript: false, quiet_hours: {start:"22:00", end:"07:00"} | null}` | admin |
| POST | `/automation/telegram/test` | → `{ok, error|null}` | admin |
| GET | `/automation/rules` · POST · PUT `/{id}` · DELETE `/{id}` | `Rule = {id, name, enabled, categories: string[], channel_ids: number[] /*empty = all*/, min_score, cooldown_s, actions: ('telegram'|'webhook')[]}` | admin |
| GET | `/automation/webhooks` · POST · DELETE `/{id}` | `{id, name, url_redacted, enabled}`; POST `{name, url, secret?}`; https only, private/loopback blocked unless allowlisted | admin |
| POST | `/summaries` | `{channel_id?, start, end}` → `Summary` (calls Ollama) | operator |
| GET | `/summaries` | → `Summary[]` | viewer |

`Summary = {id, created_at, start, end, channel_id|null, model, text, citations: [{kind:'segment'|'event', id, at}], ai_generated: true}`

## Health

`GET /healthz` (no auth) → `{status:"ok"}`; `GET /readyz` → `{status, checks:{db, recordings_dir}}`; `GET /metrics` Prometheus text (loopback only or admin).
