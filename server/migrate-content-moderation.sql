-- Content moderation columns for all content tables
-- Run manually: mysql fellis_eu < server/migrate-content-moderation.sql

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_posts_mod_status (mod_status);

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_comments_mod_status (mod_status);

ALTER TABLE reels
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_reels_mod_status (mod_status);

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_stories_mod_status (mod_status);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_events_mod_status (mod_status);

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_marketplace_listings_mod_status (mod_status);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_jobs_mod_status (mod_status);

ALTER TABLE company_posts
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_company_posts_mod_status (mod_status);

-- conversations is used for groups (is_group = 1)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS mod_status ENUM('active','flagged','removed') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS mod_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_by INT NULL,
  ADD COLUMN IF NOT EXISTS mod_reviewed_at DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_conversations_mod_status (mod_status);
