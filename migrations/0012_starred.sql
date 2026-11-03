-- Starred mail (personal mode, docs/MODES_DESIGN.md): kept when retention or a manual cleanup
-- deletes old mail; capped per user by MAX_STARRED_MESSAGES.
ALTER TABLE messages ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1));

-- The "Starred" filter. Only starred rows enter this index, so ordinary deliveries pay no extra write.
CREATE INDEX idx_messages_user_starred ON messages(user_id, received_at) WHERE is_starred = 1;
