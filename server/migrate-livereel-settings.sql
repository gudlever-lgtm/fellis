-- migrate-livereel-settings.sql
-- Adds livestream + live-reel support to an existing fellis.eu installation.
-- Safe to re-run (uses IF NOT EXISTS / INSERT IGNORE / ADD COLUMN IF NOT EXISTS).

-- 1. Ensure admin_settings table exists (created by initAdminSettings but may
--    not yet exist when running migrations stand-alone before first server start)
CREATE TABLE IF NOT EXISTS admin_settings (
  key_name  VARCHAR(100) NOT NULL PRIMARY KEY,
  key_value TEXT         DEFAULT NULL,
  updated_at TIMESTAMP   NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Seed default streaming limits (INSERT IGNORE = no-op if already present)
INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('reel_max_duration_seconds',      '600');
INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES ('streaming_max_duration_seconds', '3600');

-- 3. Add new columns to reels (ADD COLUMN IF NOT EXISTS = idempotent on MariaDB 10.3+)
ALTER TABLE reels
  ADD COLUMN IF NOT EXISTS source   ENUM('upload','live') NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS title_da VARCHAR(500)          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS title_en VARCHAR(500)          DEFAULT NULL;

-- 4. Create livestreams table to track live recordings
CREATE TABLE IF NOT EXISTS livestreams (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  started_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TIMESTAMP    NULL     DEFAULT NULL,
  recording_path VARCHAR(500) DEFAULT NULL,
  reel_file_url  VARCHAR(500) DEFAULT NULL,
  status        ENUM('live','ended','archived') NOT NULL DEFAULT 'live',
  INDEX idx_ls_user_id   (user_id),
  INDEX idx_ls_started_at (started_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
