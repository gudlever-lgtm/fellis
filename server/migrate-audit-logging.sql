-- Migration: Add audit logging table for security compliance
-- Date: 2026-03-22

-- Audit log table for tracking security-relevant events
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT(11) DEFAULT NULL,
  action VARCHAR(100) NOT NULL COMMENT 'login, logout, password_change, mfa_enable, mfa_disable, file_upload, etc',
  resource_type VARCHAR(50) DEFAULT NULL COMMENT 'user, post, listing, admin_settings, etc',
  resource_id INT(11) DEFAULT NULL,
  old_value JSON DEFAULT NULL,
  new_value JSON DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IPv4 or IPv6',
  user_agent TEXT DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'success' COMMENT 'success, failure, partial',
  details JSON DEFAULT NULL COMMENT 'Additional metadata',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_id (user_id),
  KEY idx_action (action),
  KEY idx_created_at (created_at),
  KEY idx_resource (resource_type, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retention policy: Keep audit logs for 90 days (configurable)
-- This is enforced by a periodic cleanup job in the application

-- Verification queries:
-- SELECT COUNT(*) FROM audit_logs;
-- SELECT DISTINCT action FROM audit_logs ORDER BY action;
-- SELECT action, COUNT(*) FROM audit_logs GROUP BY action ORDER BY COUNT(*) DESC;
