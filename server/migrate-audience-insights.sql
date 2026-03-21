-- Audience Insights: adds industry, seniority, job_title, company to users
-- and source_post_id to profile_views for "posts driving visits" analytics.
--
-- Run: mysql -u root fellis_eu < server/migrate-audience-insights.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS industry  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seniority VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS company   VARCHAR(100) DEFAULT NULL;

ALTER TABLE profile_views
  ADD COLUMN IF NOT EXISTS source_post_id INT DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_pv_source_post (source_post_id);
