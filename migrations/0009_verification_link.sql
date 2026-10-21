-- Phase 8.1: verification ("magic") links, detected at delivery like codes (worker/lib/magic-link.ts).
ALTER TABLE messages ADD COLUMN verification_link TEXT;

-- The "codes" filter now means "mail you have to act on": a code or a link. Replacing the partial
-- index (not adding one) keeps ingest at the same row writes; only such mail pays the index write.
DROP INDEX idx_messages_user_code;
CREATE INDEX idx_messages_user_verify ON messages(user_id, received_at)
  WHERE verification_code IS NOT NULL OR verification_link IS NOT NULL;
