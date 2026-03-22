-- Ad-Free Badge Rewards System Migration
-- Maps badges to ad-free days and tracks user's earned/assigned days

-- Badge → Days mapping
CREATE TABLE IF NOT EXISTS adfree_badge_mappings (
  badge_id VARCHAR(100) PRIMARY KEY,
  days_earned INT NOT NULL
);

-- User's banked ad-free days
CREATE TABLE IF NOT EXISTS adfree_days_bank (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  days_banked INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_bank (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Assigned ad-free date ranges
CREATE TABLE IF NOT EXISTS adfree_day_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_used INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_dates (user_id, start_date, end_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Extend users table with ad-free tracking (if columns don't exist)
ALTER TABLE users ADD COLUMN IF NOT EXISTS adfree_active_until DATETIME DEFAULT NULL;

-- Populate badge mappings
-- Tier 1 = 1 day
INSERT IGNORE INTO adfree_badge_mappings (badge_id, days_earned) VALUES
  ('t1_first_steps', 1),
  ('t1_say_hello', 1),
  ('t1_welcomed', 1),
  ('t1_profile_complete', 1),
  ('t1_early_bird', 1),
  ('t1_connected', 1),
  ('t1_follower', 1),
  ('t1_curious', 1),
  ('t1_sharer', 1),
  ('t1_comeback', 1),
  ('t1_reel_debut', 1),
  ('t1_reel_liked', 1);

-- Tier 2 = 3 days
INSERT IGNORE INTO adfree_badge_mappings (badge_id, days_earned) VALUES
  ('t2_regular', 3),
  ('t2_conversationalist', 3),
  ('t2_popular', 3),
  ('t2_social_butterfly', 3),
  ('t2_influencer', 3),
  ('t2_explorer', 3),
  ('t2_dedicated', 3),
  ('t2_appreciated', 3),
  ('t2_networker', 3),
  ('t2_contributor', 3),
  ('t2_reel_creator', 3),
  ('t2_reel_popular', 3),
  ('t2_reel_viewed', 3),
  ('t2_collector', 3);

-- Tier 3 = 7 days
INSERT IGNORE INTO adfree_badge_mappings (badge_id, days_earned) VALUES
  ('t3_veteran', 7),
  ('t3_prolific', 7),
  ('t3_voice', 7),
  ('t3_beloved', 7),
  ('t3_trendsetter', 7),
  ('t3_mentor', 7),
  ('t3_streak_master', 7),
  ('t3_viral', 7),
  ('t3_community_pillar', 7),
  ('t3_legend', 7),
  ('t3_reel_producer', 7),
  ('t3_reel_sensation', 7),
  ('t3_reel_viral', 7),
  ('t3_completionist', 7);
