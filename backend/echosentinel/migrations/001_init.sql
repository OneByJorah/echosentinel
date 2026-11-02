-- EchoSentinel schema v1
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT
);

CREATE TABLE channels (
    id INTEGER PRIMARY KEY,
    slot INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    url_enc TEXT,             -- Fernet-encrypted RTSP URL (may contain credentials)
    url_redacted TEXT,
    transport TEXT NOT NULL DEFAULT 'tcp',
    enabled INTEGER NOT NULL DEFAULT 1,
    record INTEGER NOT NULL DEFAULT 1,
    transcribe INTEGER NOT NULL DEFAULT 1,
    classify INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE channel_status_log (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    at TEXT NOT NULL
);
CREATE INDEX idx_status_log ON channel_status_log(channel_id, at);

CREATE TABLE recordings (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    path TEXT NOT NULL UNIQUE,  -- relative to recordings root
    start TEXT NOT NULL,
    end TEXT,
    duration_s REAL,
    bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'writing',
    peaks BLOB                  -- 1 byte per second, 0..255 peak level
);
CREATE INDEX idx_rec_channel_start ON recordings(channel_id, start);

CREATE TABLE segments (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    text TEXT NOT NULL,
    kind TEXT NOT NULL,
    final INTEGER NOT NULL DEFAULT 1,
    language TEXT,
    confidence REAL,
    speaker TEXT,
    stt_latency_ms INTEGER,
    demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_seg_channel_start ON segments(channel_id, start);
CREATE VIRTUAL TABLE segments_fts USING fts5(text, content='segments', content_rowid='id');
CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER segments_au AFTER UPDATE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    category TEXT NOT NULL,
    label TEXT NOT NULL,
    score REAL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT,
    latency_ms INTEGER,
    demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_events_at ON events(at);
CREATE INDEX idx_events_channel ON events(channel_id, at);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value_enc TEXT NOT NULL
);

CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    categories TEXT NOT NULL,   -- JSON array
    channel_ids TEXT NOT NULL,  -- JSON array
    min_score REAL NOT NULL DEFAULT 0.5,
    cooldown_s INTEGER NOT NULL DEFAULT 300,
    actions TEXT NOT NULL       -- JSON array
);

CREATE TABLE webhooks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url_enc TEXT NOT NULL,
    url_redacted TEXT NOT NULL,
    secret_enc TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE summaries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    channel_id INTEGER,
    model TEXT NOT NULL,
    text TEXT NOT NULL,
    citations TEXT NOT NULL     -- JSON
);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    detail TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
