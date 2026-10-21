-- Phase 9: sending (off by default; docs/SENDING_PLAN.md). Three switches, all off:
-- the service-wide one (SENDING_ENABLED var / settings.sending_enabled), per domain and per user.
ALTER TABLE domains ADD COLUMN can_send INTEGER NOT NULL DEFAULT 0 CHECK (can_send IN (0, 1));
ALTER TABLE users ADD COLUMN can_send INTEGER NOT NULL DEFAULT 0 CHECK (can_send IN (0, 1));
-- Messages per rolling 24 h; NULL = SEND_MAX_PER_USER_PER_DAY.
ALTER TABLE users ADD COLUMN send_quota INTEGER CHECK (send_quota IS NULL OR send_quota >= 0);

-- Sent mail, tenant-scoped like `messages` (admins never see it). Plain text only in v1.
-- Quotas count rows here over the last 24 h (index-bounded and capped at the quota, so no counter
-- table and no extra row writes); `counted = 0` refunds a send the provider rejected outright.
CREATE TABLE sent_messages (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id       TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  from_address     TEXT NOT NULL,
  to_addresses     TEXT NOT NULL,                     -- JSON array of lowercase addresses
  subject          TEXT NOT NULL,
  text_body        TEXT NOT NULL,
  reply_to_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,  -- the received message answered
  status           TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  error            TEXT,                              -- stable error code when failed
  counted          INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0, 1)),
  provider         TEXT,
  provider_id      TEXT,
  idempotency_key  TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_sent_user_created ON sent_messages(user_id, created_at);
CREATE INDEX idx_sent_created ON sent_messages(created_at);
