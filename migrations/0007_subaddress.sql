-- Opt-in subaddressing, per mailbox: with accept_subaddress = 1, mail to "local+anything@domain" is
-- delivered to "local@domain". Safe across tenants because '+' can never appear in a created local
-- part (LOCAL_PART_PATTERN), so a tagged recipient can only ever resolve to its base address.
ALTER TABLE mailboxes ADD COLUMN accept_subaddress INTEGER NOT NULL DEFAULT 0 CHECK (accept_subaddress IN (0, 1));
