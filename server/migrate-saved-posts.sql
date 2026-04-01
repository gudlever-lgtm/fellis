CREATE TABLE IF NOT EXISTS saved_posts (
  user_id  INT NOT NULL,
  post_id  INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  KEY idx_saved_posts_user (user_id),
  CONSTRAINT fk_saved_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_posts_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
