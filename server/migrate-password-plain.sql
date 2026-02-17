-- Add password_plain column to users table (for generating password hints)
-- Run: mysql -u root -p fellis_eu < migrate-password-plain.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255) DEFAULT NULL AFTER password_hash;
