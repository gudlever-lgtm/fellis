-- ── DeepL translation cache migration ──
-- Adds cache_key (SHA-256 of text:sourceLang:targetLang) and original_text columns.
-- Safe to run on both fresh installs and existing databases.
-- Run manually: mysql -u root fellis_eu < server/migrate-translation-cache.sql

USE fellis_eu;

CREATE TABLE IF NOT EXISTS translation_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cache_key CHAR(64) NOT NULL UNIQUE,
  source_lang CHAR(2) NOT NULL,
  target_lang CHAR(2) NOT NULL,
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cache_key (cache_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrade path for existing installations: add new columns and relax the old hash column
ALTER TABLE translation_cache
  ADD COLUMN IF NOT EXISTS cache_key CHAR(64) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS original_text TEXT NULL AFTER target_lang,
  MODIFY COLUMN IF EXISTS original_text_hash CHAR(64) NULL DEFAULT NULL;

-- Backfill cache_key from original_text_hash for pre-existing rows
UPDATE translation_cache
  SET cache_key = original_text_hash
  WHERE cache_key IS NULL AND original_text_hash IS NOT NULL;

-- Ensure unique index on cache_key
ALTER TABLE translation_cache
  ADD UNIQUE KEY IF NOT EXISTS idx_cache_key (cache_key);
