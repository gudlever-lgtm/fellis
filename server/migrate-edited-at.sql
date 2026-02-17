-- Add edited_at column to posts table (for tracking edited posts)
-- Run: mysql -u root fellis_eu < migrate-edited-at.sql

ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP NULL DEFAULT NULL AFTER created_at;
