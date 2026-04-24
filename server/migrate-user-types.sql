-- Migration: migrate-user-types.sql
-- 1. Alter users.mode to ENUM('private','network','business') DEFAULT 'private'
--    Map: privat/personal/private → private | business → network | NULL → private
-- 2. Create company_profiles table (per-user company profile for business-mode users)
-- 3. Create company_members table (links company_user_id to member_user_id via users)
-- 4. Create user_features table (feature flags / subscriptions per user)

-- ── 1. Migrate users.mode ─────────────────────────────────────────────────────

-- Ensure column exists (no-op if already present via ensureRuntimeColumns)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'privat';

-- Normalise NULL → 'private' before applying type constraint
UPDATE users SET mode = 'private' WHERE mode IS NULL;

-- Map Danish 'privat' and legacy 'personal' to new canonical 'private'
UPDATE users SET mode = 'private' WHERE mode IN ('privat', 'personal');

-- Map existing 'business' (personal-business hybrid) to 'network'
UPDATE users SET mode = 'network' WHERE mode = 'business';

-- Apply new enum type; any unmapped stray value coerces to DEFAULT 'private'
ALTER TABLE users MODIFY COLUMN mode ENUM('private','network','business') NOT NULL DEFAULT 'private';

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
