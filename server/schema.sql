-- fellis.eu MariaDB Database Schema
-- Compatible with MariaDB 11.8+ / MySQL 8+

CREATE DATABASE IF NOT EXISTS fellis_eu CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
USE fellis_eu;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  handle VARCHAR(50) NOT NULL UNIQUE,
  initials VARCHAR(5) NOT NULL,
  bio_da TEXT DEFAULT NULL,
  bio_en TEXT DEFAULT NULL,
  location VARCHAR(100) DEFAULT NULL,
  join_date VARCHAR(10) DEFAULT NULL,
  photo_count INT(11) DEFAULT 0,
  avatar_url VARCHAR(500) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL UNIQUE,
  password_hash VARCHAR(255) DEFAULT NULL,
  password_plain VARCHAR(255) DEFAULT NULL,
  facebook_id VARCHAR(100) DEFAULT NULL UNIQUE,
  fb_access_token TEXT DEFAULT NULL,
  invite_token VARCHAR(64) DEFAULT NULL UNIQUE,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Friendships (bidirectional)
CREATE TABLE IF NOT EXISTS friendships (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL,
  friend_id INT(11) NOT NULL,
  is_online TINYINT(1) DEFAULT 0,
  mutual_count INT(11) DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_friendship (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Posts (with optional media attachments)
CREATE TABLE IF NOT EXISTS posts (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  author_id INT(11) NOT NULL,
  text_da TEXT NOT NULL,
  text_en TEXT NOT NULL,
  time_da VARCHAR(50) DEFAULT NULL,
  time_en VARCHAR(50) DEFAULT NULL,
  likes INT(11) DEFAULT 0,
  media JSON DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  edited_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Migration for existing installations (run this if posts table already exists):
-- ALTER TABLE posts ADD COLUMN media JSON DEFAULT NULL AFTER likes;

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT(11) NOT NULL,
  author_id INT(11) NOT NULL,
  text_da TEXT NOT NULL,
  text_en TEXT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Post likes (track who liked what)
CREATE TABLE IF NOT EXISTS post_likes (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE KEY unique_like (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sender_id INT(11) NOT NULL,
  receiver_id INT(11) NOT NULL,
  text_da TEXT NOT NULL,
  text_en TEXT NOT NULL,
  time VARCHAR(20) DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Invitations (invite links to bring friends to fellis.eu)
CREATE TABLE IF NOT EXISTS invitations (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inviter_id INT(11) NOT NULL,
  invite_token VARCHAR(64) NOT NULL UNIQUE,
  invitee_name VARCHAR(100) DEFAULT NULL,
  status ENUM('pending', 'accepted') DEFAULT 'pending',
  accepted_by INT(11) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Sessions for auth
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id INT(11) NOT NULL,
  lang VARCHAR(5) DEFAULT 'da',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP(),
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
