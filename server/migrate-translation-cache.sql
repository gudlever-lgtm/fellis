-- Migration: translation_cache table for DeepL translation results
-- Columns: source_hash CHAR(64), target_lang CHAR(5), translated_text TEXT, created_at TIMESTAMP
-- Safe to run on both fresh installs and existing databases.
-- Run manually: mysql -u root fellis_eu < server/migrate-translation-cache.sql

USE fellis_eu;

CREATE TABLE IF NOT EXISTS translation_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_hash CHAR(64) NULL,
  target_lang CHAR(5) NOT NULL,
  translated_text TEXT NOT NULL,
  detected_source_lang CHAR(5) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrade path for existing installations: add new columns if missing
ALTER TABLE translation_cache
  ADD COLUMN IF NOT EXISTS source_hash CHAR(64) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS detected_source_lang CHAR(5) NULL AFTER translated_text;

-- Composite unique index for source_hash + target_lang lookups
ALTER TABLE translation_cache
  ADD UNIQUE KEY IF NOT EXISTS idx_source_hash_lang (source_hash, target_lang);
