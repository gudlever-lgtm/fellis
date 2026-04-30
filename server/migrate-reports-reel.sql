-- Add 'reel' to the reports target_type ENUM so reels can be red-flagged.
-- Run this after migrate-reports.sql if the reports table already exists.
ALTER TABLE reports
  MODIFY COLUMN target_type
    ENUM('post', 'group', 'reel', 'comment', 'user', 'reel_comment', 'message')
    NOT NULL;
