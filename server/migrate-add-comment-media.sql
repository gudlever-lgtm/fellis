-- Add media support to comments table
ALTER TABLE comments ADD COLUMN IF NOT EXISTS media JSON DEFAULT NULL;
