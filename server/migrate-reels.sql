-- migrate-reels.sql
-- Tilføjer Reels-tabeller til eksisterende fellis.eu installationer.
-- Kør én gang mod din database:
--   mysql -u root fellis_eu < server/migrate-reels.sql

CREATE TABLE IF NOT EXISTS reels (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_url VARCHAR(500) NOT NULL,
  caption TEXT DEFAULT NULL,
  views_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  INDEX idx_reel_user_id (user_id),
  INDEX idx_reel_created_at (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reel_likes (
  reel_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (reel_id, user_id),
  FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reel_comments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reel_id INT NOT NULL,
  user_id INT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
