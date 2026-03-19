-- Migration: Google & LinkedIn OAuth columns
-- Adds google_id and linkedin_id to users table for OAuth sign-in and account linking.
-- Safe to run on existing installs — uses IF NOT EXISTS.
-- Run: mysql -u root fellis_eu < server/migrate-google-linkedin-oauth.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(100) DEFAULT NULL AFTER facebook_id,
  ADD COLUMN IF NOT EXISTS linkedin_id VARCHAR(100) DEFAULT NULL AFTER google_id;

-- Unique indexes prevent two accounts from linking the same provider account
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id   ON users (google_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_linkedin_id ON users (linkedin_id);
