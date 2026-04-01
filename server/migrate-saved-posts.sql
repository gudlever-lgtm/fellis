CREATE TABLE IF NOT EXISTS saved_posts (
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  KEY idx_saved_posts_user (user_id),
  KEY idx_saved_posts_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
