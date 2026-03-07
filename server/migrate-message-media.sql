-- Add media column to messages table (for image/video attachments in conversations)
ALTER TABLE messages ADD COLUMN media JSON DEFAULT NULL AFTER text_en;
