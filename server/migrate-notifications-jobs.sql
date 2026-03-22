-- Job Sharing & Notifications
-- Add time support to reminders + shared jobs tracking

ALTER TABLE calendar_reminders ADD COLUMN IF NOT EXISTS time TIME DEFAULT NULL;
ALTER TABLE calendar_reminders ADD COLUMN IF NOT EXISTS shown_notification BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS shared_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL,
  shared_by_user_id INT NOT NULL,
  shared_with_user_id INT NOT NULL,
  shared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_share (job_id, shared_by_user_id, shared_with_user_id),
  INDEX idx_recipient (shared_with_user_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
);
