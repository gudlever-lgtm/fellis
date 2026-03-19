-- Add category and notes to keyword_filters
-- Run: mysql -u root fellis_eu < server/migrate-keyword-category.sql

ALTER TABLE keyword_filters
  ADD COLUMN IF NOT EXISTS category ENUM(
    'profanity', 'hate_speech', 'sexual', 'violence', 'drugs', 'harassment', 'spam', 'other'
  ) NOT NULL DEFAULT 'other' AFTER action,
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL AFTER category;
