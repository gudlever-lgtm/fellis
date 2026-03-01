-- Migration: Public group support for dynamic group suggestions
-- Run this against the database for existing installations

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group TINYINT(1) DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_public TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description_da TEXT DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description_en TEXT DEFAULT NULL;
