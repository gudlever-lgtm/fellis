-- Migration: migrate-user-types.sql
-- 1. Ensure users.mode column exists as VARCHAR(20) with platform-standard values
--    Valid modes: 'privat' (personal), 'network', 'business'
--    Normalise any legacy 'private' (English) or 'personal' → 'privat'
-- 2. Create company_profiles table (per-user company profile for business-mode users)
-- 3. Create company_members table (links company_user_id to member_user_id via users)
-- 4. Create user_features table (feature flags / subscriptions per user)

-- ── 1. Migrate users.mode ─────────────────────────────────────────────────────

-- Ensure column exists (no-op if already present via ensureRuntimeColumns)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'privat';

-- Normalise NULL → 'privat'
UPDATE users SET mode = 'privat' WHERE mode IS NULL OR mode = '';

-- Normalise English 'private' and legacy 'personal' to platform-standard 'privat'
UPDATE users SET mode = 'privat' WHERE mode IN ('private', 'personal');

-- Ensure column is VARCHAR(20) with correct default (idempotent)
ALTER TABLE users MODIFY COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'privat';

-- ── 2. company_profiles ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_profiles (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  user_id     INT NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  cvr         VARCHAR(20) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  category    VARCHAR(100) DEFAULT NULL,
  logo_url    VARCHAR(500) DEFAULT NULL,
  website     VARCHAR(500) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. company_members (user-centric: company_user_id → member_user_id) ───────

CREATE TABLE IF NOT EXISTS company_members (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  company_user_id INT NOT NULL,
  member_user_id  INT NOT NULL,
  role            ENUM('admin','editor','viewer') DEFAULT 'editor',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cm_pair (company_user_id, member_user_id),
  FOREIGN KEY (company_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (member_user_id)  REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. user_features ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_features (
  id                      INT PRIMARY KEY AUTO_INCREMENT,
  user_id                 INT NOT NULL,
  feature                 VARCHAR(100) NOT NULL,
  active                  TINYINT(1) DEFAULT 1,
  expires_at              TIMESTAMP NULL DEFAULT NULL,
  mollie_subscription_id  VARCHAR(255) DEFAULT NULL,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uf_user_feature (user_id, feature),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
