-- Mollie payment integration migration
-- Run against the fellis_eu database

CREATE TABLE IF NOT EXISTS subscriptions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  mollie_payment_id VARCHAR(64) DEFAULT NULL,
  plan         VARCHAR(32) NOT NULL DEFAULT 'adfree',
  status       VARCHAR(32) NOT NULL DEFAULT 'open',
  expires_at   DATETIME DEFAULT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_id (user_id),
  KEY idx_mollie_payment_id (mollie_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add Mollie columns to existing subscriptions table (if it already exists)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS mollie_payment_id VARCHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan VARCHAR(32) NOT NULL DEFAULT 'adfree',
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS expires_at DATETIME DEFAULT NULL;
