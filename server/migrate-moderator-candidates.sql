-- Moderator candidate tracking
-- Run against existing installations:
--   mysql -u root fellis_eu < server/migrate-moderator-candidates.sql
--
-- NOTE: There is NO user-facing way to apply for moderator status.
-- Candidates are identified and tracked exclusively by admins (invite-only).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS moderator_candidate TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderator_candidate_note TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS moderator_candidate_at DATETIME DEFAULT NULL;
