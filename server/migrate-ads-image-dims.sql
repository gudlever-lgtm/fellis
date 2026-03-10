-- Migration: add image display dimensions to ads table
-- Run once: mysql -u root fellis_eu < server/migrate-ads-image-dims.sql

ALTER TABLE ads
  ADD COLUMN image_display_width  TINYINT UNSIGNED DEFAULT NULL COMMENT 'Image display width as % of container (20-100)',
  ADD COLUMN image_display_height SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Image display height in pixels (40-400)';
