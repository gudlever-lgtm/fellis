-- ── Viral Growth System Migration ──
-- fellis.eu — run against fellis_eu database
-- Compatible with MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

-- ── 1. Extend users table ──
-- Public profile flag (0 = private, 1 = public/shareable without login)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_public TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reputation_score INT(11) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_count INT(11) NOT NULL DEFAULT 0;

-- ── 2. Extend invitations table ──
-- Track invite source for analytics
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS invite_source ENUM('link','email','facebook','other') DEFAULT 'link',
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100) DEFAULT NULL;

-- ── 3. Extend posts table ──
-- Public share token and visibility flag
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) DEFAULT NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS is_public TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count INT(11) NOT NULL DEFAULT 0;

-- ── 4. referrals table ──
-- Detailed record of each successful referral conversion
CREATE TABLE IF NOT EXISTS referrals (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  referrer_id INT(11) NOT NULL,
  referred_id INT(11) NOT NULL,
  invitation_id INT(11) DEFAULT NULL,
  invite_source ENUM('link','email','facebook','other') DEFAULT 'link',
  utm_source VARCHAR(100) DEFAULT NULL,
  utm_campaign VARCHAR(100) DEFAULT NULL,
  converted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_referral (referrer_id, referred_id),
  FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ── 5. rewards table ──
-- Catalog of available rewards/badges
CREATE TABLE IF NOT EXISTS rewards (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL UNIQUE,
  title_da VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) NOT NULL,
  description_da TEXT NOT NULL,
  description_en TEXT NOT NULL,
  icon VARCHAR(10) NOT NULL DEFAULT '🏆',
  threshold INT(11) NOT NULL DEFAULT 1,
  reward_points INT(11) NOT NULL DEFAULT 10
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ── 6. user_badges table ──
-- Badges earned by each user
CREATE TABLE IF NOT EXISTS user_badges (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL,
  reward_type VARCHAR(50) NOT NULL,
  earned_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_user_badge (user_id, reward_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ── 7. share_events table ──
-- Track every external share for analytics
CREATE TABLE IF NOT EXISTS share_events (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) DEFAULT NULL,
  share_type ENUM('post','profile','invite') NOT NULL DEFAULT 'invite',
  target_id INT(11) DEFAULT NULL,
  platform VARCHAR(50) DEFAULT NULL,
  utm_campaign VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ── 8. Seed reward catalog ──
INSERT IGNORE INTO rewards (type, title_da, title_en, description_da, description_en, icon, threshold, reward_points) VALUES
('first_invite',    'Første invitation',     'First Invite',       'Du har inviteret din første ven til fellis.eu',       'You invited your first friend to fellis.eu',        '🌱', 1,  10),
('five_invites',    'Social ambassadør',     'Social Ambassador',  'Du har fået 5 venner til at tilmelde sig fellis.eu',  '5 friends joined fellis.eu through your invite',   '🌟', 5,  50),
('ten_invites',     'Fellis-mester',         'Fellis Master',      'Du har fået 10 venner til at tilmelde sig fellis.eu', '10 friends joined fellis.eu through your invite',  '🏆', 10, 100),
('twenty_invites',  'Vækst-champion',        'Growth Champion',    'Utroligt — 20 venner har tilmeldt sig via dig!',      'Incredible — 20 friends joined via your invite!',  '🚀', 20, 250),
('fifty_invites',   'Fellis-legende',        'Fellis Legend',      'Du er en legende — 50 tilmeldinger via dig!',        'You are a legend — 50 sign-ups via your invite!',  '👑', 50, 1000);
