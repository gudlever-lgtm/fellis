-- Migration: Add media column to posts table
-- Run this on your existing fellis_eu database to enable image/video uploads
-- MariaDB 11.8+ / MySQL 8+

USE fellis_eu;

ALTER TABLE posts ADD COLUMN media JSON DEFAULT NULL AFTER likes;
