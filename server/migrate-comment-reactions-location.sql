-- Add reaction column to comment_likes (for emoji reactions on comments)
ALTER TABLE comment_likes
  ADD COLUMN IF NOT EXISTS reaction VARCHAR(8) DEFAULT '❤️';

-- Add location columns to posts (OpenStreetMap/Nominatim)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS place_name VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geo_lat DECIMAL(10,7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geo_lng DECIMAL(10,7) DEFAULT NULL;
