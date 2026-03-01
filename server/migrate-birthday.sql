-- Migration: Add birthday column to users table
-- Run: mysql -u root fellis_eu < server/migrate-birthday.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE DEFAULT NULL;
