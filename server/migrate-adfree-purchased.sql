-- Ad-Free Purchased Periods Migration
-- Tracks subscription-based (paid) ad-free periods separately from earned badge days

-- Purchased ad-free periods (from Mollie subscription payments)
CREATE TABLE IF NOT EXISTS adfree_purchased_periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  subscription_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_dates (user_id, start_date, end_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);
