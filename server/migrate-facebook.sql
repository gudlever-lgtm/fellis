-- Add Facebook data import columns to users table
-- Stores encrypted access token, Facebook user ID, and connection state.
-- The fb_access_token column is encrypted at rest (AES-256-GCM) before storage.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fb_user_id VARCHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fb_access_token TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fb_connected TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fb_connected_at TIMESTAMP NULL DEFAULT NULL;

-- Index for deauthorize/delete webhook lookups by Facebook user ID
CREATE INDEX IF NOT EXISTS idx_users_fb_user_id ON users (fb_user_id);
