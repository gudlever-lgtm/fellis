-- migrate-stream-key.sql
-- Adds stream_key column to users table for RTMP authentication.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stream_key VARCHAR(64) DEFAULT NULL UNIQUE;
