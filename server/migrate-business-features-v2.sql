-- Business Features V2 Migration
-- Adds schema for: leads inbox, services catalog, B2B partnerships,
-- announcements, CVR verification, and analytics event log

-- user_leads: direct contact form submissions to business-mode users
CREATE TABLE IF NOT EXISTS user_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_user_id INT NOT NULL,
  sender_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NOT NULL,
  topic VARCHAR(200) DEFAULT NULL,
  message TEXT DEFAULT NULL,
  status ENUM('new','responded','archived') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ul_business (business_user_id),
  INDEX idx_ul_sender (sender_id),
  FOREIGN KEY (business_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- business_services: product/services catalog on business profiles
CREATE TABLE IF NOT EXISTS business_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name_da VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL,
  description_da TEXT DEFAULT NULL,
  description_en TEXT DEFAULT NULL,
  price_from DECIMAL(10,2) DEFAULT NULL,
  price_to DECIMAL(10,2) DEFAULT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bs_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- business_partnerships: B2B partner connections between business accounts
CREATE TABLE IF NOT EXISTS business_partnerships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  partner_id INT NOT NULL,
  status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bp_pair (requester_id, partner_id),
  INDEX idx_bp_requester (requester_id),
  INDEX idx_bp_partner (partner_id),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- business_announcements: broadcast messages from businesses to their followers
CREATE TABLE IF NOT EXISTS business_announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  author_id INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  cta_url VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ba_author (author_id),
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CVR number and verification status on user accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS cvr_number VARCHAR(20) DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0;
