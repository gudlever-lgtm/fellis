-- Migration: group creation moderation (Mistral AI hybrid approach)
-- Run manually: cd server && npm run migrate
-- or: mysql fellis_eu < server/migrate-group-moderation.sql

-- Extend group_status ENUM to support AI-flagged and removed states
ALTER TABLE conversations
  MODIFY COLUMN group_status ENUM('active','pending','rejected','flagged','removed') DEFAULT 'active';

-- Add moderation metadata columns
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_moderation_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS group_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS group_reviewed_at DATETIME NULL;

-- Index for fast admin queue queries on flagged groups
ALTER TABLE conversations
  ADD INDEX IF NOT EXISTS idx_conversations_group_status (group_status);
