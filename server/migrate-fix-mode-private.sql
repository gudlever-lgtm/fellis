-- Migration: migrate-fix-mode-private.sql
-- Repairs damage from the earlier incorrect migrate-user-types.sql which:
--   • mapped 'privat' → 'private' (wrong — platform standard is 'privat')
--   • enforced ENUM('private','network','business') incompatible with platform code
--
-- This migration is idempotent and safe to run even if the old migration was not applied.

-- Step 1: If column is ENUM, widen back to VARCHAR so we can store 'privat'
ALTER TABLE users MODIFY COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'privat';

-- Step 2: Normalise any legacy 'private' (English spelling) → 'privat'
UPDATE users SET mode = 'privat' WHERE mode = 'private';

-- Step 3: Normalise any remaining NULL or empty values → 'privat'
UPDATE users SET mode = 'privat' WHERE mode IS NULL OR mode = '';
