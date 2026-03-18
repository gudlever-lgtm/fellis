-- Migration: stories and post_hashtags tables
-- Run manually: mysql -u root fellis_eu < server/migrate-stories-hashtags.sql

-- Stories (24-hour expiry, Common mode feature)
CREATE TABLE IF NOT EXISTS stories (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL,
  content_text TEXT NOT NULL,
  bg_color VARCHAR(7) NOT NULL DEFAULT '#2D6A4F',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP() + INTERVAL 24 HOUR),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hashtags extracted from post text (max 10 per post)
CREATE TABLE IF NOT EXISTS post_hashtags (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT(11) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  INDEX idx_tag (tag),
  INDEX idx_created (created_at),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
