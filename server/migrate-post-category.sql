-- Migration: Add categories column to posts table (JSON array of category ids)
-- Run this against your database if posts table already exists:
ALTER TABLE posts ADD COLUMN categories JSON DEFAULT NULL AFTER media;

-- If you previously ran the old version of this migration (category VARCHAR(50)):
-- ALTER TABLE posts DROP COLUMN category;
-- ALTER TABLE posts ADD COLUMN categories JSON DEFAULT NULL AFTER media;
