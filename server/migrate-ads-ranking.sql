-- Migration: Ad ranking + frequency caps + feed engagement weight
-- Wires interest_scores into ad selection (via application-layer ranking)
-- Adds per-user daily/weekly frequency caps for ad delivery
-- Adds a feed_weight_engagement knob used by the ranked feed path (?ranked=1)
-- Safe to re-run (uses ADD COLUMN IF NOT EXISTS / INSERT IGNORE).

ALTER TABLE admin_ad_settings
  ADD COLUMN IF NOT EXISTS ad_daily_cap_per_user  INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ad_weekly_cap_per_user INT NOT NULL DEFAULT 20;

-- Used by the per-user daily/weekly cap subqueries in ad serving
CREATE INDEX IF NOT EXISTS idx_ai_user_created
  ON ad_impressions (user_id, created_at);

-- Engagement weight — read by getFeedWeights() in the ranked feed path
INSERT IGNORE INTO admin_settings (key_name, key_value)
VALUES ('feed_weight_engagement', '10');
