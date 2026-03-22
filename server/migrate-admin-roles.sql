-- Migration: Create proper admin roles system (replace hardcoded user ID 1)
-- Date: 2026-03-22

-- Admin roles table
CREATE TABLE IF NOT EXISTS admin_roles (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL COMMENT 'super_admin, admin, moderator',
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  granted_by INT(11) DEFAULT NULL COMMENT 'User ID who granted this role',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_role (role),
  KEY idx_granted_at (granted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initial seed: Grant super_admin to original admin (user ID 1)
-- Note: Run this after migration: INSERT INTO admin_roles (user_id, role) VALUES (1, 'super_admin');

-- Role definitions:
-- super_admin: Full platform control, user suspension, settings
-- admin: Administrative functions, moderation, settings changes
-- moderator: Content moderation only (already tracked in users.is_moderator)

-- Index for fast permission checks
CREATE INDEX IF NOT EXISTS idx_user_id_role ON admin_roles(user_id, role);

-- Cleanup: Drop is_moderator column from users (replaced by admin_roles) — optional, do after migrating moderators
-- ALTER TABLE users DROP COLUMN IF EXISTS is_moderator;

-- Verification queries:
-- SELECT u.id, u.name, ar.role FROM users u LEFT JOIN admin_roles ar ON u.id = ar.user_id WHERE ar.role IS NOT NULL;
-- SELECT role, COUNT(*) FROM admin_roles GROUP BY role;
