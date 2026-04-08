CREATE TABLE IF NOT EXISTS blog_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  title_da VARCHAR(500) NOT NULL DEFAULT '',
  title_en VARCHAR(500) NOT NULL DEFAULT '',
  summary_da TEXT,
  summary_en TEXT,
  body_da LONGTEXT,
  body_en LONGTEXT,
  cover_image VARCHAR(500),
  author_id INT,
  published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_published (published, published_at),
  INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
