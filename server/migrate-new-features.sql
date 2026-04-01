-- ── New features migration ────────────────────────────────────────────────────
-- Adds tables and columns for:
-- share/repost, saved posts, polls, @mentions, nested comments,
-- message reactions, profile cover photo, hashtag follows,
-- story highlights, story reactions, recurring events,
-- marketplace wishlist + offers, job alerts, company reviews,
-- company business hours, company Q&A, profile portfolio,
-- pinned post, reel-to-feed sharing

-- ── Share/repost posts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_shares (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_post_id INT NOT NULL,
  comment TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_share (user_id, original_post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (original_post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Share count column on posts
ALTER TABLE posts ADD COLUMN share_count INT NOT NULL DEFAULT 0;

-- ── Saved posts / bookmarks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_posts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_save (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Polls ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_polls (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  ends_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS poll_options (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poll_id INT NOT NULL,
  text_da VARCHAR(255) NOT NULL,
  text_en VARCHAR(255) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (poll_id) REFERENCES post_polls(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS poll_votes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poll_id INT NOT NULL,
  option_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_vote (poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES post_polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Nested comment replies ────────────────────────────────────────────────────
ALTER TABLE comments ADD COLUMN parent_id INT DEFAULT NULL;
ALTER TABLE comments ADD FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE;

-- ── Message reactions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(20) NOT NULL DEFAULT '❤️',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_reaction (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Profile cover photo ───────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN cover_photo_url VARCHAR(500) DEFAULT NULL;

-- ── Pinned post on profile ────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN pinned_post_id INT DEFAULT NULL;

-- ── Hashtag follows ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hashtag_follows (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  hashtag VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_follow (user_id, hashtag),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Story highlights ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_highlights (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  cover_emoji VARCHAR(10) DEFAULT '⭐',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS story_highlight_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  highlight_id INT NOT NULL,
  story_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_item (highlight_id, story_id),
  FOREIGN KEY (highlight_id) REFERENCES story_highlights(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Story reactions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_reactions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  story_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(20) NOT NULL DEFAULT '❤️',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_reaction (story_id, user_id),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Recurring events ──────────────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN recurrence_type ENUM('none','daily','weekly','monthly') DEFAULT 'none';
ALTER TABLE events ADD COLUMN recurrence_end DATE DEFAULT NULL;
ALTER TABLE events ADD COLUMN recurrence_day_of_week TINYINT DEFAULT NULL;

-- ── Marketplace wishlist ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_saved (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  listing_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_saved (user_id, listing_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Marketplace price offers ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_offers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  buyer_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  message TEXT DEFAULT NULL,
  status ENUM('pending','accepted','declined','withdrawn') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Job alerts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_alerts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  query VARCHAR(200) DEFAULT NULL,
  location VARCHAR(200) DEFAULT NULL,
  job_type VARCHAR(50) DEFAULT NULL,
  frequency ENUM('daily','weekly') DEFAULT 'weekly',
  last_sent_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Company reviews ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_reviews (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(200) DEFAULT NULL,
  body TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_review (company_id, user_id),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Company business hours ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_business_hours (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  day_of_week TINYINT NOT NULL COMMENT '0=Mon,1=Tue,...,6=Sun',
  open_time TIME DEFAULT NULL,
  close_time TIME DEFAULT NULL,
  is_closed TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY unique_hours (company_id, day_of_week),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Company Q&A ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_qa (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  asker_id INT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT DEFAULT NULL,
  answered_by INT DEFAULT NULL,
  answered_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (asker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Profile portfolio ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_portfolio (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  url VARCHAR(500) DEFAULT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Reel-to-feed: track which reels have been shared ─────────────────────────
ALTER TABLE reels ADD COLUMN shared_as_post_id INT DEFAULT NULL;
