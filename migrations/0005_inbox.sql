-- Phase 4: inbox reads.
-- "Recent codes" on the home page: a partial index keeps that query to a handful of rows instead of
-- walking the user's whole history. Only mail with a detected code pays the extra index write.
-- (Unread counts use idx_messages_mailbox_unread from 0002; no per-user unread index is needed.)
CREATE INDEX idx_messages_user_code ON messages(user_id, received_at) WHERE verification_code IS NOT NULL;
