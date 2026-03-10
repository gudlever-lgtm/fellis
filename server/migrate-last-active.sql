-- Add last_active column to users table for real-time online status tracking
-- Run: mysql -u root fellis_eu < server/migrate-last-active.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP NULL DEFAULT NULL;
