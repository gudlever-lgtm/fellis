-- Add birth_year column to users table for age verification (minimum age 13)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year SMALLINT NOT NULL DEFAULT 0;
