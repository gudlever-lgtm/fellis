-- Migration: Facebook OAuth columns and webhook lookup index
-- Adds fb_user_id to users table for Facebook deauthorize/data-deletion webhook lookups.
-- Safe to run on existing installs — uses IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fb_user_id VARCHAR(100) DEFAULT NULL AFTER facebook_id;

-- Index for deauthorize/delete webhook lookups by Facebook user ID
CREATE INDEX IF NOT EXISTS idx_users_fb_user_id ON users (fb_user_id);
