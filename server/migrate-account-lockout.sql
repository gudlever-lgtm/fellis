-- Migration: Add account lockout for brute force protection
-- Date: 2026-03-22

-- Add lockout columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT(11) DEFAULT 0 COMMENT 'Count of failed login attempts';
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL COMMENT 'Account locked until this timestamp (brute force protection)';

-- Configuration constants (in application code):
-- MAX_LOGIN_ATTEMPTS = 5
-- LOCKOUT_DURATION_MINUTES = 15

-- Verification queries:
-- SELECT id, name, failed_login_attempts, locked_until FROM users WHERE locked_until > NOW();
-- SELECT id, name FROM users WHERE failed_login_attempts > 0;
