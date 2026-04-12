-- Migration: Add gender column to users table
-- Used by Facebook data import and profile editor.
-- Safe to re-run — IF NOT EXISTS stripped for MySQL 8 compatibility by migrate.js.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(50) DEFAULT NULL;
