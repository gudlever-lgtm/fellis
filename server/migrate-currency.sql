-- Migration: Add EUR currency support
-- Run against fellis_eu database: mysql -u root fellis_eu < server/migrate-currency.sql

-- marketplace_listings: add structured EUR price column and currency flag
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS currency    VARCHAR(3)    NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS price_eur   DECIMAL(10,2) DEFAULT NULL;

-- Backfill price_eur from existing varchar price column (numeric values only)
UPDATE marketplace_listings
   SET price_eur = CASE
     WHEN price REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(price AS DECIMAL(10,2))
     ELSE NULL
   END
 WHERE price_eur IS NULL;

-- Update admin_ad_settings default currency to EUR (for new rows)
ALTER TABLE admin_ad_settings
  MODIFY COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'EUR';

-- Set existing admin_ad_settings rows to EUR if still DKK
UPDATE admin_ad_settings SET currency = 'EUR' WHERE currency = 'DKK';
