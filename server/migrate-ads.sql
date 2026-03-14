-- migrate-ads.sql
-- Extends existing `ads` table with zone/mode fields for platform-managed display ads.
-- Creates `ad_stats` table for GDPR-safe per-event tracking.
-- Run against fellis_eu database: mysql -u root fellis_eu < server/migrate-ads.sql

USE fellis_eu;

-- Add zone and mode columns to the existing ads table (idempotent with IF NOT EXISTS in MariaDB)
ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS zone ENUM('display','native','sticky') NOT NULL DEFAULT 'display',
  ADD COLUMN IF NOT EXISTS mode ENUM('all','common','business') NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS link_url VARCHAR(500) DEFAULT NULL;

-- Per-event ad stats table: GDPR-safe — only stores hashed IPs, no personal data beyond optional user_id
CREATE TABLE IF NOT EXISTS ad_stats (
  id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ad_id      INT NOT NULL,
  event      ENUM('impression','click') NOT NULL,
  user_id    INT DEFAULT NULL,
  ip_hash    VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  INDEX idx_ad_event (ad_id, event),
  FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
