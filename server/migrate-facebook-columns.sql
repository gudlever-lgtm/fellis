-- Add missing Facebook data-import columns to users table.
-- migrate-facebook.sql was applied with only fb_user_id; this adds the rest.
-- Safe to re-run — uses IF NOT EXISTS throughout.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fb_access_token TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fb_connected    TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fb_connected_at TIMESTAMP   NULL DEFAULT NULL;
