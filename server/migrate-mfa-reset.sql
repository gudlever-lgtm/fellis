-- Migration: Add password reset tokens + SMS MFA support to users table
-- Run against fellis_eu database: mysql -u root fellis_eu < server/migrate-mfa-reset.sql

-- Password reset: store hashed token + expiry directly on users row
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token      VARCHAR(64)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reset_token_expires DATETIME  DEFAULT NULL;

-- SMS MFA: hashed one-time code, expiry, and enabled flag
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_code         VARCHAR(64)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mfa_code_expires DATETIME     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mfa_enabled      TINYINT(1)   NOT NULL DEFAULT 0;

-- Index for fast token lookups during reset
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);
