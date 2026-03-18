-- Track payment details directly on the ad record
ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS paid_at DATETIME DEFAULT NULL;
