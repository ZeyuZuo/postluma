-- Defaults and operational limits now come from `wrangler.jsonc#vars` (worker/lib/config.ts).
-- The settings table only holds values an admin has explicitly overridden at runtime
-- (registration_open, default_mailbox_quota, retention_days) plus internal flags.
-- No admin UI existed yet, so every row deleted here still held its seeded default.
DELETE FROM settings WHERE key IN (
  'default_mailbox_quota',
  'retention_days',
  'registration_open',
  'max_total_mailboxes',
  'max_daily_mailbox_creations',
  'max_messages_per_mailbox_per_hour',
  'max_messages_per_user_per_hour',
  'max_messages_per_day',
  'max_ingest_bytes_per_day'
);
