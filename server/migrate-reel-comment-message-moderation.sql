-- Extend reports.target_type ENUM to include reel_comment and message
ALTER TABLE reports
  MODIFY COLUMN target_type ENUM('post', 'comment', 'user', 'reel_comment', 'message') NOT NULL;

-- Add user_id to reel_comments SELECT (already exists; ensure index for fast lookups)
ALTER TABLE reel_comments ADD INDEX IF NOT EXISTS idx_reel_comments_user (user_id);

-- Add id + sender_id to messages responses (already in table; ensure index)
ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_messages_sender (sender_id);
