-- Migration: Add invite system to fellis.eu
-- Run this on existing installations to add invite support

-- Add invite_token column to users (personal shareable invite link)
ALTER TABLE users ADD COLUMN invite_token VARCHAR(64) DEFAULT NULL UNIQUE AFTER fb_access_token;

-- Create invitations table (track individual invites sent)
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
