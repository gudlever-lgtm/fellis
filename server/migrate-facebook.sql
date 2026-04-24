-- Migration: Facebook data import columns + webhook lookup index
-- Adds all columns needed by server/routes/facebook.js.
-- Safe to re-run on existing installs — uses IF NOT EXISTS throughout.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fb_user_id      VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fb_access_token TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fb_connected    TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fb_connected_at TIMESTAMP    NULL DEFAULT NULL;

-- Index for deauthorize/delete webhook lookups by Facebook user ID
CREATE INDEX IF NOT EXISTS idx_users_fb_user_id ON users (fb_user_id);
