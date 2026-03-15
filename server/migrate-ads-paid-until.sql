-- Track payment expiry per ad so paused ads can be reactivated without repayment
ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS paid_until DATETIME DEFAULT NULL;
