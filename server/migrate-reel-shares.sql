-- Add shares_count to reels table
ALTER TABLE reels ADD COLUMN IF NOT EXISTS shares_count INT NOT NULL DEFAULT 0;
