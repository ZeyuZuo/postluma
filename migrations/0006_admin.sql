-- Phase 5: admin panel.
-- Daily deletion budget: deleting a message costs ~6 D1 row writes (row + indexes), and the Free
-- plan's 100k writes/day are shared by login, ingest and everything else. Retention cleanup,
-- user purges and manual cleanups all draw from MAX_DELETES_PER_DAY, tracked per UTC day here.
ALTER TABLE ingest_counters ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

-- Admin user list: newest first and the pending-count badge without full scans + sorts.
CREATE INDEX idx_users_created ON users(created_at, id);
CREATE INDEX idx_users_status ON users(status);
