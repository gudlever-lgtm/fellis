-- migrate-mediamtx.sql
-- Adds stream_key column to users for RTMP stream authentication.
-- The stream_key is the RTMP path name: rtmp://<host>/live/<stream_key>

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stream_key VARCHAR(64) NULL UNIQUE;
