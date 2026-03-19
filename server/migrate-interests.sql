-- Migration: Add user interests and family friendship flag
-- Run this against your database to enable the interests & feed algorithm feature.
-- NOTE: ADD COLUMN IF NOT EXISTS is MariaDB-only. MySQL 8.x: use run-migrations.js

-- 1. Add interests JSON column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests JSON DEFAULT NULL;

-- 2. Add is_family flag to friendships table (bidirectional — set on both rows)
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS is_family TINYINT(1) NOT NULL DEFAULT 0;
