CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  target_type ENUM('post', 'group') NOT NULL,
  target_id INT NOT NULL,
  reason VARCHAR(100) NOT NULL,
  details TEXT,
  status ENUM('pending', 'reviewed', 'dismissed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_report (reporter_id, target_type, target_id)
);
