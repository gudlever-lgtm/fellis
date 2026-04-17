-- Migration: Add mobilepay column to users table
-- Stores the user's default MobilePay number so marketplace listings can prefill it.
-- Safe to re-run — IF NOT EXISTS stripped for MySQL 8 compatibility by migrate.js.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mobilepay VARCHAR(20) DEFAULT NULL;
