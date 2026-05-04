-- Add admin_reply column to platform_feedback for communicating back to users
ALTER TABLE platform_feedback
  ADD COLUMN admin_reply TEXT DEFAULT NULL AFTER admin_note,
  ADD COLUMN admin_reply_at DATETIME DEFAULT NULL AFTER admin_reply;
