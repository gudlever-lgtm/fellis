-- Add post_context column to posts table for feed separation
-- Contexts: social (default), professional (network feed), business (business feed)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS post_context ENUM('social', 'professional', 'business') DEFAULT 'social';

-- Back-fill any rows that got NULL instead of the DEFAULT
UPDATE posts SET post_context = 'social' WHERE post_context IS NULL;
