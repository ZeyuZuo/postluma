-- Abuse limits for mailbox creation. Disabled mailboxes don't count toward the active quota, so
-- without these a create→disable loop could reserve unlimited never-reusable addresses.
INSERT INTO settings (key, value, updated_at) VALUES
  ('max_total_mailboxes', '100', 0),          -- active + disabled, per user
  ('max_daily_mailbox_creations', '30', 0);   -- per user, rolling 24 hours

-- Stored addresses and domains must be lowercase: the email handler matches the lowercased
-- recipient exactly. Enforced in the database so no future write path can break it.
-- COLLATE BINARY is required: both columns are NOCASE, which would make the comparison case-blind.
CREATE TRIGGER mailboxes_address_lowercase_insert BEFORE INSERT ON mailboxes
WHEN NEW.address COLLATE BINARY <> lower(NEW.address)
BEGIN SELECT RAISE(ABORT, 'mailboxes.address must be lowercase'); END;

CREATE TRIGGER mailboxes_address_lowercase_update BEFORE UPDATE OF address ON mailboxes
WHEN NEW.address COLLATE BINARY <> lower(NEW.address)
BEGIN SELECT RAISE(ABORT, 'mailboxes.address must be lowercase'); END;

CREATE TRIGGER domains_lowercase_insert BEFORE INSERT ON domains
WHEN NEW.domain COLLATE BINARY <> lower(NEW.domain)
BEGIN SELECT RAISE(ABORT, 'domains.domain must be lowercase'); END;

CREATE TRIGGER domains_lowercase_update BEFORE UPDATE OF domain ON domains
WHEN NEW.domain COLLATE BINARY <> lower(NEW.domain)
BEGIN SELECT RAISE(ABORT, 'domains.domain must be lowercase'); END;

-- Unread counts per mailbox (list view) without scanning read messages.
CREATE INDEX idx_messages_mailbox_unread ON messages(mailbox_id) WHERE is_read = 0;
