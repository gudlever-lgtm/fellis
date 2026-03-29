-- Migration: business profile fields
-- Adds optional business-only columns to the users table.
-- Run: mysql -u root fellis_eu < server/migrate-business-profile.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS business_category     VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_website      VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_hours        VARCHAR(200) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_description_da TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_description_en TEXT        DEFAULT NULL;
