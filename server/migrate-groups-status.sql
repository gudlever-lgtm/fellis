-- Migration: group approval status
-- Run manually: mysql fellis < server/migrate-groups-status.sql

-- Add group_status column to conversations so new groups can require admin approval
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_status ENUM('active','pending','rejected') DEFAULT 'active';

-- Mark all existing groups as active
UPDATE conversations SET group_status = 'active' WHERE is_group = 1 AND group_status IS NULL;
