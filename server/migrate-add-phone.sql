-- Migration: Add phone number column to users table (required for SMS MFA)
-- Run against fellis_eu database: mysql -u root fellis_eu < server/migrate-add-phone.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) DEFAULT NULL AFTER invite_token;
