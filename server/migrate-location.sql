-- Migration: Add location fields to posts
-- Run: mysql -u root fellis_eu < server/migrate-location.sql

ALTER TABLE posts
  ADD COLUMN location_lat  DECIMAL(9,6)   NULL AFTER categories,
  ADD COLUMN location_lng  DECIMAL(9,6)   NULL AFTER location_lat,
  ADD COLUMN location_name VARCHAR(255)   NULL AFTER location_lng;
