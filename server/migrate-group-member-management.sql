-- Group member management: admin mute per participant
-- Run: mysql -u root fellis_eu < server/migrate-group-member-management.sql

ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS admin_muted_until DATETIME DEFAULT NULL;
