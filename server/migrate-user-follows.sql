-- Adds user_follows table for asymmetric user-to-user follows (standard or business accounts).
-- Separate from business_follows (business directory) and company_follows (company pages).

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INT NOT NULL,
  followee_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  KEY idx_user_follows_follower (follower_id),
  KEY idx_user_follows_followee (followee_id),
  CONSTRAINT fk_uf_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_uf_followee FOREIGN KEY (followee_id) REFERENCES users (id) ON DELETE CASCADE
);
