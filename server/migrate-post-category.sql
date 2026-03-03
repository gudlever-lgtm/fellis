-- Migration: Add category column to posts table
-- Run this against your database if posts table already exists:
ALTER TABLE posts ADD COLUMN category VARCHAR(50) DEFAULT NULL AFTER media;
