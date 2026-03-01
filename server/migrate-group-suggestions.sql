-- Migration: Public group support for dynamic group suggestions
-- Run this against the database for existing installations

ALTER TABLE conversations ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN category VARCHAR(100) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN description_da TEXT DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN description_en TEXT DEFAULT NULL;
