-- Group posts, reactions, and enhanced membership
-- Run: mysql -u root fellis_eu < server/migrate-groups-posts.sql

-- Role column on conversation_participants (admin / moderator / member)
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member';

-- Cached counters and visibility on conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS member_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS post_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility ENUM('public','private','hidden') NOT NULL DEFAULT 'public';

-- Pending join requests for private groups
CREATE TABLE IF NOT EXISTS group_join_requests (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  group_id   INT NOT NULL,
  user_id    INT NOT NULL,
  status     ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_user (group_id, user_id),
  KEY idx_group_status (group_id, status)
);

-- Group-specific posts (separate from the main feed)
CREATE TABLE IF NOT EXISTS group_posts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  group_id   INT NOT NULL,
  user_id    INT NOT NULL,
  content    TEXT,
  media      JSON,
  is_pinned  TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_group_pinned_created (group_id, is_pinned, created_at)
);

-- Reactions on group posts
CREATE TABLE IF NOT EXISTS group_post_reactions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NOT NULL,
  user_id    INT NOT NULL,
  type       ENUM('like','love','insightful') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_user (post_id, user_id),
  KEY idx_post (post_id)
);
