-- Migration: add nav_order column to users table
-- Stores JSON with user's custom navigation layout: { main: [...], more: [...] }
-- NULL means use platform defaults
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nav_order JSON NULL;
