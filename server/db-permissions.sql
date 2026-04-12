-- db-permissions.sql — Minimum required MySQL/MariaDB permissions for fellis.eu
--
-- REVIEW BEFORE RUNNING. Execute as a privileged DB user (root or admin).
-- Replace 'your_secure_password_here' with a strong, randomly generated password.
--
-- Purpose: enforce least-privilege by granting only the operations the application
-- actually needs. The DB user never needs CREATE TABLE, DROP, ALTER, or GRANT.
-- Schema changes are applied from migration scripts run by a separate admin user.
--
-- Usage:
--   mysql -u root -p < server/db-permissions.sql

-- 1. Create the application user (idempotent — safe to re-run)
CREATE USER IF NOT EXISTS 'fellis_db_user'@'localhost'
  IDENTIFIED BY 'your_secure_password_here';

-- 2. Revoke everything first for a clean slate
REVOKE ALL PRIVILEGES, GRANT OPTION
  FROM 'fellis_db_user'@'localhost';

-- 3. Grant only what the application needs: read + write on its own database
--    No CREATE, DROP, ALTER, INDEX, REFERENCES, GRANT, or FILE.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON fellis_eu.*
  TO 'fellis_db_user'@'localhost';

-- 4. Flush privilege cache
FLUSH PRIVILEGES;

-- Verification (run manually to confirm):
--   SHOW GRANTS FOR 'fellis_db_user'@'localhost';
--
-- Expected output should show only:
--   GRANT USAGE ON *.*
--   GRANT SELECT, INSERT, UPDATE, DELETE ON `fellis_eu`.*
