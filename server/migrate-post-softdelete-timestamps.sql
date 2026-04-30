-- Migration: soft delete + timestamps for posts
-- Run manually: mysql fellis_eu < server/migrate-post-softdelete-timestamps.sql

-- edited_at: set by PATCH /api/feed/:id on every edit
-- deleted_at: set by DELETE /api/feed/:id (soft delete); NULL = active post

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS edited_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL;

-- Index so the feed query (WHERE deleted_at IS NULL) stays fast
ALTER TABLE posts ADD INDEX IF NOT EXISTS idx_posts_deleted_at (deleted_at);
