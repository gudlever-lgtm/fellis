-- CV Profile migration: work experience, education, language proficiency
-- Run: mysql -u root fellis_eu < server/migrate-cv-profile.sql

CREATE TABLE IF NOT EXISTS work_experience (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company VARCHAR(200) NOT NULL,
  title VARCHAR(200) NOT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_we_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS education (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  institution VARCHAR(200) NOT NULL,
  degree VARCHAR(200) DEFAULT NULL,
  field VARCHAR(200) DEFAULT NULL,
  start_year SMALLINT DEFAULT NULL,
  end_year SMALLINT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ed_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_languages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  language VARCHAR(100) NOT NULL,
  proficiency ENUM('basic','conversational','professional','fluent','native') NOT NULL DEFAULT 'conversational',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_language (user_id, language),
  INDEX idx_ul_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add application letter URL column to job_applications (idempotent)
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS application_letter_url VARCHAR(500) DEFAULT NULL;
