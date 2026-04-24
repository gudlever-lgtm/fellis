-- Drop legacy standalone-groups tables
-- These were created by migrate-groups.sql and migrate-groups-posts.sql (now removed).
-- The active implementation uses conversations (is_group=1) instead.
-- Run manually if those migrations were ever applied: mysql fellis_eu < server/migrate-drop-legacy-groups.sql

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS group_moderation_log;
DROP TABLE IF EXISTS group_event_rsvp;
DROP TABLE IF EXISTS group_events;
DROP TABLE IF EXISTS group_invitations;
DROP TABLE IF EXISTS group_post_reactions;
DROP TABLE IF EXISTS group_posts;
DROP TABLE IF EXISTS group_join_requests;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS `groups`;

SET FOREIGN_KEY_CHECKS = 1;

-- Remove the unused visibility column added by migrate-groups-posts.sql (if present)
ALTER TABLE conversations DROP COLUMN IF EXISTS visibility;
