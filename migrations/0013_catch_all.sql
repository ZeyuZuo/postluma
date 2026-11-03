-- Catch-all (personal mode, docs/MODES_DESIGN.md): the first mail to an unknown address on a
-- catch-all domain creates that address for the administrator who switched catch-all on.
-- NULL = catch-all off.
ALTER TABLE domains ADD COLUMN catch_all_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Created by catch-all rather than by hand: shown as such, rate-limited per address, and kept out of
-- the manual daily creation cap.
ALTER TABLE mailboxes ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0 CHECK (auto_created IN (0, 1));

-- Same row as the daily ingest budget, so these bumps cost no extra row writes: addresses created
-- today (CATCH_ALL_MAX_PER_DAY) and mail stored into auto-created addresses today (at most half of
-- INGEST_MAX_MESSAGES_PER_DAY / INGEST_MAX_MB_PER_DAY).
ALTER TABLE ingest_counters ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_counters ADD COLUMN catch_all_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_counters ADD COLUMN catch_all_bytes INTEGER NOT NULL DEFAULT 0;
