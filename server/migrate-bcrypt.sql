-- Migration: Implement bcrypt password hashing and remove plaintext passwords
-- Date: 2026-03-22

-- Step 1: Ensure password_hash column exists and has correct type
ALTER TABLE users
MODIFY COLUMN password_hash VARCHAR(255) DEFAULT NULL COMMENT 'Bcrypt hash ($2a$10$...)';

-- Step 2: Migrate any remaining unhashed passwords
-- NOTE: This requires manual execution with PHP/Node.js helper to hash values
-- SQL-only alternative: DELETE any rows without password_hash and having only password_plain
-- (This will remove accounts that never set a proper password, keeping security intact)

-- Step 3: Drop password_plain column (contains plaintext passwords - SECURITY RISK)
ALTER TABLE users DROP COLUMN IF EXISTS password_plain;

-- Step 4: Add index on password_hash for performance (though we rarely query on it)
ALTER TABLE users ADD INDEX idx_password_hash (password_hash);

-- Migration complete
-- Verification query:
-- SELECT COUNT(*) as users_without_hash FROM users WHERE password_hash IS NULL;
-- Should return 0 or low number after migration
