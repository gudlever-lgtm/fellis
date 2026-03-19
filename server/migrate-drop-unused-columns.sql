-- migrate-drop-unused-columns.sql
-- Fjerner Stripe-relaterede og ubrugte kolonner fra users-tabellen.
-- Kør manuelt mod databasen: mysql -u root fellis_eu < migrate-drop-unused-columns.sql
--
-- Forudsætning: serveren er opdateret til en version der ikke refererer disse kolonner.

ALTER TABLE users
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS ads_free_sub_id;
