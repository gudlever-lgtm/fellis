-- Migration: business discovery layer
-- Creates business_follows table and adds follower_count + community_score to users.
-- Run: mysql -u root fellis_eu < server/migrate-business-discovery.sql

CREATE TABLE IF NOT EXISTS business_follows (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  follower_id  INT NOT NULL,
  business_id  INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bf_follower  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bf_business  FOREIGN KEY (business_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY  unique_follow (follower_id, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS follower_count   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS community_score  INT DEFAULT 0;
