-- Original messages are kept in R2 (messages.raw_r2_key, present since 0001) when the MAIL_BUCKET
-- binding exists. Daily R2 growth is budgeted like D1 growth (RAW_MAIL_MAX_MB_PER_DAY).
ALTER TABLE ingest_counters ADD COLUMN raw_bytes INTEGER NOT NULL DEFAULT 0;

-- Never used: attachment metadata lives in messages.attachments_json, and attachment content is read
-- from the original message in R2 by the client.
DROP TABLE attachments;
