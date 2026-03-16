-- Migration: Create / repair notifications and notification_preferences tables
-- Run: mysql -u root fellis_eu < server/migrate-notifications.sql

CREATE TABLE IF NOT EXISTS notifications (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) NOT NULL,
  type VARCHAR(50) NOT NULL,
  message_da TEXT NOT NULL,
  message_en TEXT NOT NULL,
  link VARCHAR(500) DEFAULT NULL,
  read_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  INDEX idx_user_created (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT(11) NOT NULL,
  type VARCHAR(50) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fix: if table was created with old 'message' column instead of message_da/message_en
-- Rename message → message_da
SET @has_message = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'message');
SET @has_message_da = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'message_da');
SET @has_message_en = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'message_en');

SET @sql1 = IF(@has_message > 0 AND @has_message_da = 0,
  'ALTER TABLE notifications CHANGE message message_da TEXT NOT NULL', 'SELECT 1');
PREPARE s FROM @sql1; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql2 = IF(@has_message = 0 AND @has_message_da = 0,
  'ALTER TABLE notifications ADD COLUMN message_da TEXT NOT NULL AFTER type', 'SELECT 1');
PREPARE s FROM @sql2; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql3 = IF(@has_message_en = 0,
  'ALTER TABLE notifications ADD COLUMN message_en TEXT NOT NULL AFTER message_da', 'SELECT 1');
PREPARE s FROM @sql3; EXECUTE s; DEALLOCATE PREPARE s;
