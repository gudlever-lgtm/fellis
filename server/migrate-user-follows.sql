-- Adds user_follows table for asymmetric user-to-user follows (standard or business accounts).
-- Separate from business_follows (business directory) and company_follows (company pages).
-- No named foreign key constraints to avoid potential name conflicts on re-run.

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INT NOT NULL,
  followee_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  KEY idx_user_follows_follower (follower_id),
  KEY idx_user_follows_followee (followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
