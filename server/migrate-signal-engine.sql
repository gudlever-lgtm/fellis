-- Migration: Interest Graph Signal Engine
-- Creates the two tables needed for the signal engine:
--   interest_signals  — raw behavioral signals (GDPR: auto-deleted after 90 days)
--   interest_scores   — computed per-user interest weights (persisted indefinitely)
--
-- These tables are also created automatically by initSignalEngine() on server startup,
-- but running this migration is recommended for existing installs.
--
-- Run: mysql -u root fellis_eu < server/migrate-signal-engine.sql

CREATE TABLE IF NOT EXISTS interest_signals (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  interest_slug VARCHAR(50) NOT NULL,
  signal_type   ENUM('click','dwell_short','dwell_long','like','comment','share','scroll_past','quick_close','block') NOT NULL,
  signal_value  TINYINT NOT NULL,
  context       ENUM('professional','hobby','purchase') NOT NULL DEFAULT 'hobby',
  source_type   VARCHAR(50) DEFAULT NULL,   -- 'post', 'event', 'listing', etc.
  source_id     INT DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_is_user          (user_id),
  INDEX idx_is_user_interest (user_id, interest_slug),
  INDEX idx_is_cleanup       (created_at),        -- used by GDPR 90-day delete job
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Computed scores — scoring formula applied on every signal batch:
--   new_weight = old_weight + (signal_value × context_multiplier) × (1 − saturation)
-- where saturation = old_weight / 100  (prevents exceeding 100)
-- Context multipliers: professional=1.4, hobby=1.0, purchase=1.6
-- Daily decay (server job): weight = weight × 0.995 for interests with no signal in 24h
CREATE TABLE IF NOT EXISTS interest_scores (
  user_id        INT NOT NULL,
  interest_slug  VARCHAR(50) NOT NULL,
  context        ENUM('professional','hobby','purchase') NOT NULL DEFAULT 'hobby',
  weight         FLOAT NOT NULL DEFAULT 0,          -- 0–100
  explicit_set   TINYINT(1) NOT NULL DEFAULT 0,     -- 1 = user manually adjusted
  last_signal_at TIMESTAMP DEFAULT NULL,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, interest_slug, context),
  INDEX idx_iscores_user_weight (user_id, weight),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
