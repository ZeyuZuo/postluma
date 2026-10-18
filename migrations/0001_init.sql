-- PostLuma initial schema. Timestamps are Unix epoch milliseconds.
-- D1 enforces foreign keys, so ON DELETE CASCADE is the data-cleanup path for users and mailboxes.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,                       -- "pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>"
  role           TEXT NOT NULL DEFAULT 'user'    CHECK (role IN ('user', 'admin')),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'banned')),
  mailbox_quota  INTEGER,                             -- NULL = settings.default_mailbox_quota
  locale         TEXT,                                -- UI language preference, e.g. 'zh-CN', 'en'
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);

-- Session id is SHA-256 of the cookie token; the raw token is never stored.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Receiving domains, managed by admins. Each one must also have an Email Routing
-- catch-all rule pointing at this Worker. Disabled domains accept no new mailboxes.
CREATE TABLE domains (
  id          TEXT PRIMARY KEY,
  domain      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- Mailboxes have exactly two states and are never deleted; 'disabled' rejects new mail but keeps
-- history visible, and can be re-enabled. Only 'active' mailboxes count toward the quota.
CREATE TABLE mailboxes (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain_id         TEXT NOT NULL REFERENCES domains(id),
  address           TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- lowercase "local@domain"
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_received_at  INTEGER
);
CREATE INDEX idx_mailboxes_user ON mailboxes(user_id, status, created_at DESC);

-- Mailboxes are never deleted individually; this table keeps the addresses of deleted
-- user accounts reserved forever. Mailbox creation must check both `mailboxes` and this table.
CREATE TABLE retired_addresses (
  address     TEXT PRIMARY KEY COLLATE NOCASE,
  retired_at  INTEGER NOT NULL
);

CREATE TABLE messages (
  id                 TEXT PRIMARY KEY,
  mailbox_id         TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- denormalized ownership filter
  message_id_header  TEXT,
  from_address       TEXT NOT NULL,
  from_name          TEXT,
  to_address         TEXT NOT NULL,
  subject            TEXT,
  snippet            TEXT,
  text_body          TEXT,
  html_body          TEXT,            -- stored raw; sanitized at render time
  verification_code  TEXT,
  size               INTEGER NOT NULL,
  has_attachments    INTEGER NOT NULL DEFAULT 0,
  raw_r2_key         TEXT,            -- set only when R2 is enabled
  is_read            INTEGER NOT NULL DEFAULT 0,
  received_at        INTEGER NOT NULL
);
CREATE INDEX idx_messages_user_received ON messages(user_id, received_at DESC);
CREATE INDEX idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);
CREATE INDEX idx_messages_received ON messages(received_at);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename      TEXT,
  content_type  TEXT,
  size          INTEGER NOT NULL,
  content_id    TEXT,
  r2_key        TEXT
);
CREATE INDEX idx_attachments_message ON attachments(message_id);

-- Admin and security-relevant actions (approve/ban/quota/settings/login failures).
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT,                   -- JSON
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
INSERT INTO settings (key, value, updated_at) VALUES
  ('default_mailbox_quota', '10', 0),
  ('retention_days', '0', 0),           -- 0 = keep forever
  ('registration_open', 'true', 0);
