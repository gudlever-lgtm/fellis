-- Add media support to comments table
-- MySQL 8.x: use run-migrations.js instead (ADD COLUMN IF NOT EXISTS is MariaDB-only)
-- MariaDB 10.3+:
ALTER TABLE comments ADD COLUMN IF NOT EXISTS media JSON DEFAULT NULL;
