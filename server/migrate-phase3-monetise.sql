-- Phase 3 Monetisation Layer Migration
-- Run: mysql -u root fellis_eu < server/migrate-phase3-monetise.sql

-- ── ads table: budget, CPM, spend tracking, boosting, targeting ──────────────
ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS budget           DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS spent            DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpm_rate         DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS boosted_post_id  INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_interests JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reach            INT NOT NULL DEFAULT 0;

-- FK for boosted post (soft — uses SET NULL so boost survives post deletion)
-- NOTE: ADD CONSTRAINT IF NOT EXISTS is not supported for FKs in MariaDB;
--       use a stored procedure to add idempotently.
DROP PROCEDURE IF EXISTS _add_fk_ads_boosted_post;
DELIMITER //
CREATE PROCEDURE _add_fk_ads_boosted_post()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ads'
      AND CONSTRAINT_NAME = 'fk_ads_boosted_post'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE ads
      ADD CONSTRAINT fk_ads_boosted_post
        FOREIGN KEY (boosted_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END //
DELIMITER ;
CALL _add_fk_ads_boosted_post();
DROP PROCEDURE IF EXISTS _add_fk_ads_boosted_post;

-- ── ad_impressions: per-user per-ad per-hour dedup, CPM spend tracking ───────
CREATE TABLE IF NOT EXISTS ad_impressions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ad_id       INT NOT NULL,
  user_id     INT NOT NULL,
  hour_bucket DATETIME NOT NULL COMMENT 'Truncated to the hour (YYYY-MM-DD HH:00:00)',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_ad   FOREIGN KEY (ad_id)  REFERENCES ads(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ai_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_impression (ad_id, user_id, hour_bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── admin_ad_settings: post boost pricing ────────────────────────────────────
ALTER TABLE admin_ad_settings
  ADD COLUMN IF NOT EXISTS post_boost_price DECIMAL(10,2) NOT NULL DEFAULT 19.00,
  ADD COLUMN IF NOT EXISTS post_boost_days  INT NOT NULL DEFAULT 7;
