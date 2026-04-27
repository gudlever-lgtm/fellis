-- Migration: moderation_log table for AI-powered content moderation results
-- Run manually: mysql -u root -p fellis_eu < server/migrate-moderation-log.sql

CREATE TABLE IF NOT EXISTS moderation_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  content_type VARCHAR(50)     NOT NULL,
  content_id   BIGINT UNSIGNED DEFAULT NULL,
  result       ENUM('safe','flagged','blocked') NOT NULL,
  reason       TEXT            DEFAULT NULL,
  confidence   ENUM('low','medium','high') NOT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_content (content_type, content_id),
  INDEX idx_result  (result),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
