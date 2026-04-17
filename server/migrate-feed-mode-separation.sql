-- Migration: Add user_mode column to posts for feed separation between 'privat' and 'business'
--
-- This enables filtering the feed by the author's account mode at post-creation time,
-- so privat users and business users can see mode-specific feeds via GET /api/feed?mode=...

-- 1. Add the column (IF NOT EXISTS is stripped for MySQL 8 compat; error 1060 is silently skipped)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_mode ENUM('privat', 'business') NOT NULL DEFAULT 'privat';

-- 2. Backfill: set user_mode from the author's current mode in users table
UPDATE posts p JOIN users u ON p.author_id = u.id SET p.user_mode = u.mode;

-- 3. Composite index to speed up mode-filtered feed queries (user_mode + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_posts_user_mode ON posts (user_mode, created_at);
