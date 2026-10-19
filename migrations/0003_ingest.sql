-- Phase 3: inbound mail.

-- Bodies over the byte caps (or mail larger than the parse window) are cut; the UI can say so.
ALTER TABLE messages ADD COLUMN is_truncated INTEGER NOT NULL DEFAULT 0;
-- SMTP envelope sender. The From header is unauthenticated display data; keep both so the UI
-- can flag mismatches later.
ALTER TABLE messages ADD COLUMN envelope_from TEXT;
-- Attachment metadata as JSON on the message row: one D1 write instead of three per attachment
-- (the `attachments` table stays for stored content once R2 is enabled).
ALTER TABLE messages ADD COLUMN attachments_json TEXT;

-- Service-wide daily ingest budget (UTC day). WITHOUT ROWID keeps each bump to one row write.
CREATE TABLE ingest_counters (
  day       TEXT PRIMARY KEY,
  messages  INTEGER NOT NULL DEFAULT 0,
  bytes     INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Free-plan D1 allows ~100k row writes/day and 500 MB storage; a stored message costs ~7 writes.
-- These defaults keep inbound mail to about a third of the write budget and bound daily growth,
-- so a flood can delay mail but never take down login, registration or mailbox management.
INSERT INTO settings (key, value, updated_at) VALUES
  ('max_messages_per_mailbox_per_hour', '60', 0),
  ('max_messages_per_user_per_hour', '120', 0),
  ('max_messages_per_day', '5000', 0),
  ('max_ingest_bytes_per_day', '52428800', 0);
