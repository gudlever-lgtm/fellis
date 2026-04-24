-- Migration: group detail support
-- Run manually: mysql fellis < server/migrate-group-detail.sql

-- Role and status tracking on conversation participants
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS role ENUM('admin','moderator','member') DEFAULT 'member';
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS status ENUM('active','pending') DEFAULT 'active';

-- Group feed: attach posts to a group
ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_id INT DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE posts ADD INDEX IF NOT EXISTS idx_posts_group_id (group_id);

-- Reaction column on post_likes (may already exist)
ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS reaction VARCHAR(20) DEFAULT 'like';

-- Group events: link existing events to a group
ALTER TABLE events ADD COLUMN IF NOT EXISTS group_id INT DEFAULT NULL;

-- Single pinned post per group
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_post_id INT DEFAULT NULL;

-- Denormalised counters kept in sync by join/leave/remove/post triggers
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS member_count INT NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS post_count INT NOT NULL DEFAULT 0;

-- Backfill counters for existing groups
UPDATE conversations c
  SET member_count = (
    SELECT COUNT(*) FROM conversation_participants cp
    WHERE cp.conversation_id = c.id AND cp.status = 'active'
  )
WHERE c.is_group = 1;

UPDATE conversations c
  SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.group_id = c.id)
WHERE c.is_group = 1;

-- Group polls
CREATE TABLE IF NOT EXISTS group_polls (
  id          INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id    INT(11) NOT NULL,
  question    VARCHAR(500) NOT NULL,
  options     JSON NOT NULL COMMENT 'Array of {text_da, text_en}',
  ends_at     TIMESTAMP NULL DEFAULT NULL,
  created_by  INT(11) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id)   REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group poll votes (one per user per poll)
CREATE TABLE IF NOT EXISTS group_poll_votes (
  id         INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poll_id    INT(11) NOT NULL,
  user_id    INT(11) NOT NULL,
  option_idx INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gpoll_user (poll_id, user_id),
  FOREIGN KEY (poll_id)  REFERENCES group_polls(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill existing group creators to admin role where role is still NULL
UPDATE conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
SET cp.role = 'admin'
WHERE c.is_group = 1
  AND c.created_by = cp.user_id
  AND cp.role IS NULL;
