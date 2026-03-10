-- Post views tracking for real insights data
-- Run: mysql -u root fellis_eu < server/migrate-post-views.sql

CREATE TABLE IF NOT EXISTS post_views (
  post_id INT NOT NULL,
  viewer_id INT NOT NULL,
  view_count INT NOT NULL DEFAULT 1,
  first_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  last_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (post_id, viewer_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Add last_active column to users if not already present (used by heartbeat)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP NULL DEFAULT NULL;
