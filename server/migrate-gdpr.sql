-- GDPR Compliance Migration for fellis.eu
-- Run this against your existing database to add compliance tables and columns.
-- Compatible with MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

-- ══════════════════════════════════════════════════════════════
-- 1. CONSENT TRACKING TABLE (GDPR Art. 6 & 7)
--    Records explicit user consent before any Facebook data import.
--    Consent must be freely given, specific, informed, and unambiguous.
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS gdpr_consent (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL,
  consent_type VARCHAR(50) NOT NULL,           -- 'facebook_import', 'data_processing', etc.
  consent_given TINYINT(1) NOT NULL DEFAULT 0, -- 1 = given, 0 = withdrawn
  ip_address VARCHAR(45) DEFAULT NULL,         -- IPv4 or IPv6 for audit trail
  user_agent TEXT DEFAULT NULL,                -- Browser for audit trail
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  withdrawn_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_consent_user (user_id, consent_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ══════════════════════════════════════════════════════════════
-- 2. AUDIT LOG TABLE (GDPR Art. 30 — Records of processing activities)
--    Logs all Facebook data operations for accountability.
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) DEFAULT NULL,
  action VARCHAR(100) NOT NULL,     -- 'fb_import_start', 'fb_import_complete', 'data_delete', etc.
  details TEXT DEFAULT NULL,        -- JSON with specifics
  ip_address VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ══════════════════════════════════════════════════════════════
-- 3. DATA SOURCE TRACKING (GDPR Art. 5 — data minimization & purpose limitation)
--    Track which posts/data originated from Facebook vs. created natively.
-- ══════════════════════════════════════════════════════════════
ALTER TABLE posts ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'native'
  COMMENT 'Data origin: native, facebook_post, facebook_photo';

ALTER TABLE friendships ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'native'
  COMMENT 'Data origin: native, facebook';

-- ══════════════════════════════════════════════════════════════
-- 4. FACEBOOK TOKEN ENCRYPTION MARKER
--    We will encrypt tokens in the application layer.
--    Increase column size to accommodate encrypted data.
-- ══════════════════════════════════════════════════════════════
ALTER TABLE users MODIFY COLUMN fb_access_token TEXT DEFAULT NULL
  COMMENT 'AES-256-GCM encrypted Facebook access token';

-- ══════════════════════════════════════════════════════════════
-- 5. DATA RETENTION — add expiry tracking
-- ══════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS fb_token_expires_at TIMESTAMP NULL DEFAULT NULL
  COMMENT 'When the Facebook token should be purged (GDPR data retention)';

ALTER TABLE users ADD COLUMN IF NOT EXISTS fb_data_imported_at TIMESTAMP NULL DEFAULT NULL
  COMMENT 'When Facebook data was last imported';

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_deletion_requested_at TIMESTAMP NULL DEFAULT NULL
  COMMENT 'GDPR Art. 17 — right to erasure request timestamp';
