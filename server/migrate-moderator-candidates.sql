-- Moderator system (invite-only — no user-facing applications)
-- Run against existing installations:
--   mysql -u root fellis_eu < server/migrate-moderator-candidates.sql
--
-- Admins directly grant/revoke moderator status.
-- Internally admins can track potential candidates with notes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_moderator TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderator_candidate TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderator_candidate_note TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS moderator_candidate_at DATETIME DEFAULT NULL;
