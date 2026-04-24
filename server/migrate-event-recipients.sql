ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recipients ENUM('all','family','close_friends') NOT NULL DEFAULT 'all';
