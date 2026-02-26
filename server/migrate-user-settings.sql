-- Migration: add privacy settings columns to users table
-- Run against fellis_eu database

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_visibility ENUM('all','friends') NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS friend_requests_from ENUM('all','fof') NOT NULL DEFAULT 'all';
