-- Migration: Add media + avatar columns
-- Run this on your existing fellis_eu database
-- MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

ALTER TABLE posts ADD COLUMN media JSON DEFAULT NULL AFTER likes;
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) DEFAULT NULL AFTER photo_count;
ALTER TABLE users ADD COLUMN facebook_id VARCHAR(100) DEFAULT NULL UNIQUE AFTER password_hash;
ALTER TABLE users ADD COLUMN fb_access_token TEXT DEFAULT NULL AFTER facebook_id;
