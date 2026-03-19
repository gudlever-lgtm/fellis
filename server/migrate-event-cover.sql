-- Add cover_url column to events table
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_url VARCHAR(500) DEFAULT NULL;
