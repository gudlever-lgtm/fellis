-- Migration: Add birthday column to users table
-- MySQL 8.x: use run-migrations.js instead (ADD COLUMN IF NOT EXISTS is MariaDB-only)
-- MariaDB 10.3+: mysql -u root fellis_eu < server/migrate-birthday.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE DEFAULT NULL;
