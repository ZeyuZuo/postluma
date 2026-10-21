-- Phase 8.2: SPF / DKIM / DMARC as Cloudflare Email Routing saw them, from the topmost
-- ARC-Authentication-Results header (worker/lib/sender-auth.ts). Written in the same INSERT as the
-- message, so no extra row writes. Null when SENDER_AUTH_HINTS is off or nothing trustworthy was found.
ALTER TABLE messages ADD COLUMN auth_results TEXT;
