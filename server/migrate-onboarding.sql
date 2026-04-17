-- Add onboarding_dismissed column to users table
-- Tracks whether a user has dismissed the new-user onboarding checklist.
-- The checklist is shown once: when account age < 7 days and this flag is 0.

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_dismissed TINYINT(1) NOT NULL DEFAULT 0;
