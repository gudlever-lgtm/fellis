-- Migration: extend conversations table with group-specific columns
-- Run manually: mysql fellis < server/migrate-groups-extended.sql

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS slug VARCHAR(200) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type ENUM('public','private','hidden') NOT NULL DEFAULT 'public';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags JSON DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS cover_url VARCHAR(500) DEFAULT NULL;

-- Backfill type from is_public for existing groups
UPDATE conversations SET type = IF(is_public = 1, 'public', 'private') WHERE is_group = 1 AND type = 'public';

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_slug ON conversations (slug);
