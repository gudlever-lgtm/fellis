-- ── Translations Migration ──
-- fellis.eu — run against fellis_eu database
-- Compatible with MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

-- ── 1. translations_ui table ──
-- Static UI string overrides stored in DB, keyed by lang+key
CREATE TABLE IF NOT EXISTS translations_ui (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lang CHAR(2) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  UNIQUE KEY unique_lang_key (lang, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. translation_cache table ──
-- Cached AI/external translations keyed by content hash + language pair
CREATE TABLE IF NOT EXISTS translation_cache (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  original_text_hash CHAR(64) NOT NULL,
  source_lang CHAR(2) NOT NULL,
  target_lang CHAR(2) NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_translation (original_text_hash, source_lang, target_lang),
  KEY idx_hash_target (original_text_hash, target_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. user_language table ──
-- Per-user language preference, separate from user_settings for fast lookup
CREATE TABLE IF NOT EXISTS user_language (
  user_id INT(11) NOT NULL,
  preferred_lang CHAR(2) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Extend users table ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_lang CHAR(2) NOT NULL DEFAULT 'da';
