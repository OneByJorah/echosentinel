# Security & privacy

EchoSentinel records people. Treat it like any other surveillance system: check local recording-consent, workplace and privacy law before you point it at a microphone, post notices where required, and keep retention as short as your purpose allows.

## Threat model & controls

| Threat | Control |
|---|---|
| Internet exposure | Binds `127.0.0.1` by default. Docker publishes on loopback only. Intended access is through an authenticated HTTPS reverse proxy (see `deploy/caddy`) on your LAN or tailnet. Ollama, RTSP and the database are never proxied. |
| Credential leakage (RTSP, Telegram) | Stored encrypted (Fernet, key = `ES_SECRET_KEY`). Write-only in the API; responses contain `rtsp://***@host/path`. FFmpeg stderr and probe errors are passed through a redactor. Without a secret key, the server refuses to store secrets. Tests assert that passwords never appear in channel, diagnostics or audit responses. |
| Session theft / CSRF | Random 256-bit session token, stored hashed, `HttpOnly` + `SameSite=Strict` (+ `Secure` with `ES_SECURE_COOKIES=true`). Double-submit CSRF token required on every non-GET request. Sessions expire (`ES_SESSION_HOURS`) and are revoked on password change/disable. |
| Brute force | Per-IP and per-IP+username login rate limits; constant-cost failure path (dummy hash). Failed logins are audited. |
| Cross-site WebSocket hijacking | WebSocket `Origin` must match `Host`; cookie auth required. |
| Privilege misuse | Roles: `viewer` (watch/listen), `operator` (review, export, reconnect, summaries), `admin` (configuration, users, automation). Every listen, export, review, config and user change is written to the audit log. |
| SSRF via RTSP URL | `rtsp://`/`rtsps://` only; host must resolve into `ES_RTSP_ALLOWED_NETWORKS` (LAN ranges by default); link-local/metadata/multicast always blocked. FFmpeg/ffprobe run with `-protocol_whitelist rtsp,rtsps,rtp,srtp,tcp,udp,tls,crypto`. |
| SSRF via webhooks | `https://` only, no embedded credentials, private/reserved addresses blocked unless allowlisted (`ES_WEBHOOK_ALLOW`), re-validated at send time (DNS rebinding), redirects not followed. Payloads are HMAC-SHA256 signed when a secret is set. |
| Command injection | No shell anywhere; all subprocesses use argv lists. URLs with whitespace/quotes/control characters are rejected. |
| Path traversal | Recordings are served by database id; paths are resolved and must sit inside the recordings root and match the EchoSentinel filename pattern. |
| XSS | React escapes all text; no `dangerouslySetInnerHTML`. Strict CSP (`script-src 'self'`, `frame-ancestors 'none'`). |
| CSV/formula injection | Exported cells starting with `= + - @` are prefixed with `'`. |
| Prompt injection via speech | Transcripts are wrapped as untrusted `<evidence>`, angle brackets neutralised, output length bounded, and citations to unknown evidence ids are removed. Summaries are always labelled AI-generated and link back to source segments/events. |
| Over-collection | Retention for recordings (days + storage quota) and transcripts/events; admin range deletion; notifications contain no transcript text by default (`redact_notifications`). Bookmarked events are exempt from automatic purge so evidence isn't lost. |

## Operational guidance

* **Secret key:** generate with `echosentinel gen-secret`; store it with your backups (Passbolt or similar). Rotating it requires re-entering stream URLs and the Telegram token.
* **Env file permissions:** `/etc/echosentinel/echosentinel.env` is `0640 root:echosentinel`.
* **Service account:** runs as the unprivileged `echosentinel` user with systemd sandboxing (`ProtectSystem=strict`, empty capability set, `NoNewPrivileges`).
* **Camera credentials:** create a read-only RTSP user on each camera for EchoSentinel.
* **Dependency checks:** CI runs `pip-audit` and `npm audit`.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
