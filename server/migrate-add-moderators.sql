-- Migration: Add moderator system
-- Run manually: mysql -u root fellis_eu < server/migrate-add-moderators.sql

-- 1. Add moderator flag to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_moderator TINYINT(1) NOT NULL DEFAULT 0;

-- 2. Moderator requests table
CREATE TABLE IF NOT EXISTS moderator_requests (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  reason TEXT DEFAULT NULL,
  status ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  reviewed_by INT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Extend moderation_actions audit log
ALTER TABLE moderation_actions
  MODIFY COLUMN action_type ENUM(
    'warn','suspend','ban','unban','remove_content','dismiss_report',
    'grant_moderator','revoke_moderator','approve_mod_request','deny_mod_request'
  ) NOT NULL;
