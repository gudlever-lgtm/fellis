-- Migration: migrate-convert-users-to-network.sql
-- 1. Convert all existing users with mode='business' → 'network'
-- 2. Remove all group conversations and their dependent data
-- 3. Guarantee no conversations remain flagged is_group = 1

-- ── 1. Convert business users ─────────────────────────────────────────────────
UPDATE users SET mode = 'network' WHERE mode = 'business';

-- ── 2a. Non-cascade references: messages inside group conversations ────────────
DELETE FROM messages
  WHERE conversation_id IN (SELECT id FROM conversations WHERE is_group = 1);

-- ── 2b. Non-cascade references: posts that belong to a group ─────────────────
DELETE FROM posts
  WHERE group_id IN (SELECT id FROM conversations WHERE is_group = 1);

-- ── 2c. Non-cascade references: events that belong to a group ─────────────────
UPDATE events SET group_id = NULL
  WHERE group_id IN (SELECT id FROM conversations WHERE is_group = 1);

-- ── 2d. Delete group conversations (cascades to conversation_participants,
--         group_polls and group_poll_votes via ON DELETE CASCADE) ───────────────
DELETE FROM conversations WHERE is_group = 1;

-- ── 3. Safety net: clear any stale is_group flags ────────────────────────────
UPDATE conversations SET is_group = 0 WHERE is_group != 0;
