-- ── Groups Migration ──
-- fellis.eu — run against fellis_eu database
-- Compatible with MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

-- ── 1. groups ──
CREATE TABLE IF NOT EXISTS `groups` (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  type ENUM('public','private','hidden') NOT NULL DEFAULT 'public',
  category VARCHAR(100) DEFAULT NULL,
  tags JSON DEFAULT NULL,
  cover_image VARCHAR(255) DEFAULT NULL,
  created_by INT(11) NOT NULL,
  status ENUM('pending','active','rejected','suspended') NOT NULL DEFAULT 'pending',
  member_count INT(11) DEFAULT 0,
  post_count INT(11) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_groups_slug (slug),
  KEY idx_groups_status (status),
  KEY idx_groups_created_by (created_by),
  KEY idx_groups_created_at (created_at),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. group_members ──
CREATE TABLE IF NOT EXISTS group_members (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  role ENUM('admin','moderator','member') NOT NULL DEFAULT 'member',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_member (group_id, user_id),
  KEY idx_group_members_group_id (group_id),
  KEY idx_group_members_user_id (user_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. group_posts ──
CREATE TABLE IF NOT EXISTS group_posts (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  content TEXT NOT NULL,
  media JSON DEFAULT NULL,
  pinned TINYINT(1) DEFAULT 0,
  status ENUM('active','removed','flagged') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_group_posts_group_id (group_id),
  KEY idx_group_posts_user_id (user_id),
  KEY idx_group_posts_status (status),
  KEY idx_group_posts_created_at (created_at),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. group_post_reactions ──
CREATE TABLE IF NOT EXISTS group_post_reactions (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  type ENUM('like','love','insightful') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reaction (post_id, user_id),
  KEY idx_group_post_reactions_post_id (post_id),
  KEY idx_group_post_reactions_user_id (user_id),
  FOREIGN KEY (post_id) REFERENCES group_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. group_invitations ──
CREATE TABLE IF NOT EXISTS group_invitations (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  invited_by INT(11) NOT NULL,
  invited_user_id INT(11) DEFAULT NULL,
  token VARCHAR(64) DEFAULT NULL,
  status ENUM('pending','accepted','declined','expired') DEFAULT 'pending',
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_invitation_token (token),
  KEY idx_group_invitations_group_id (group_id),
  KEY idx_group_invitations_invited_user_id (invited_user_id),
  KEY idx_group_invitations_status (status),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id),
  FOREIGN KEY (invited_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. group_polls ──
CREATE TABLE IF NOT EXISTS group_polls (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  created_by INT(11) NOT NULL,
  question VARCHAR(500) NOT NULL,
  options JSON NOT NULL,
  closes_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_group_polls_group_id (group_id),
  KEY idx_group_polls_created_by (created_by),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. group_poll_votes ──
CREATE TABLE IF NOT EXISTS group_poll_votes (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poll_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  option_id INT(11) NOT NULL,
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vote (poll_id, user_id),
  KEY idx_group_poll_votes_poll_id (poll_id),
  KEY idx_group_poll_votes_user_id (user_id),
  FOREIGN KEY (poll_id) REFERENCES group_polls(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. group_events ──
CREATE TABLE IF NOT EXISTS group_events (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  created_by INT(11) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255) DEFAULT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME DEFAULT NULL,
  max_attendees INT(11) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_group_events_group_id (group_id),
  KEY idx_group_events_created_by (created_by),
  KEY idx_group_events_starts_at (starts_at),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 9. group_event_rsvp ──
CREATE TABLE IF NOT EXISTS group_event_rsvp (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  status ENUM('going','maybe','notgoing') NOT NULL,
  UNIQUE KEY uq_rsvp (event_id, user_id),
  KEY idx_group_event_rsvp_event_id (event_id),
  KEY idx_group_event_rsvp_user_id (user_id),
  FOREIGN KEY (event_id) REFERENCES group_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 10. group_moderation_log ──
CREATE TABLE IF NOT EXISTS group_moderation_log (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT(11) NOT NULL,
  actor_id INT(11) NOT NULL,
  target_user_id INT(11) DEFAULT NULL,
  target_post_id INT(11) DEFAULT NULL,
  action ENUM('remove_post','warn_user','ban_user','unban_user','approve_member','reject_member','promote','demote') NOT NULL,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_group_moderation_log_group_id (group_id),
  KEY idx_group_moderation_log_actor_id (actor_id),
  KEY idx_group_moderation_log_created_at (created_at),
  FOREIGN KEY (group_id) REFERENCES `groups`(id),
  FOREIGN KEY (actor_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id),
  FOREIGN KEY (target_post_id) REFERENCES group_posts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
