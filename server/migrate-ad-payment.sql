-- Add ad_id column to subscriptions for tracking ad activation payments
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS ad_id INT DEFAULT NULL;
