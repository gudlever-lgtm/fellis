-- Migration: add flagged column to posts and comments for AI moderation
-- Run manually: mysql -u root -p fellis_eu < server/migrate-flagged-column.sql

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS flagged TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS flagged TINYINT(1) NOT NULL DEFAULT 0;
