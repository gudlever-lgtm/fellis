-- Moderation system migration for fellis.eu
-- Run against existing installations: mysql -u root fellis_eu < server/migrate-moderation.sql

-- Add moderation columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status ENUM('active', 'suspended', 'banned') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS strike_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suspended_until DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_strike_at DATETIME DEFAULT NULL;

-- User blocks: hide content bidirectionally between two users
CREATE TABLE IF NOT EXISTS user_blocks (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  blocker_id INT NOT NULL,
  blocked_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_block (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Reports: users report posts, comments, or other users
CREATE TABLE IF NOT EXISTS reports (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  target_type ENUM('post', 'comment', 'user') NOT NULL,
  target_id INT NOT NULL,
  reason VARCHAR(100) NOT NULL,
  details TEXT DEFAULT NULL,
  status ENUM('pending', 'dismissed', 'actioned') NOT NULL DEFAULT 'pending',
  reviewed_by INT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Moderation audit log: every admin action is recorded here
CREATE TABLE IF NOT EXISTS moderation_actions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  target_user_id INT DEFAULT NULL,
  action_type ENUM('warn', 'suspend', 'ban', 'unban', 'remove_content', 'dismiss_report') NOT NULL,
  target_type VARCHAR(50) DEFAULT NULL,
  target_id INT DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Keyword filters: automatic flagging or blocking of posts/comments
CREATE TABLE IF NOT EXISTS keyword_filters (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(200) NOT NULL UNIQUE,
  action ENUM('flag', 'block') NOT NULL DEFAULT 'flag',
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
