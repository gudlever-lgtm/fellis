-- Group admin features: frozen flag + categories table

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_frozen TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS group_categories (
  id        INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  slug      VARCHAR(100) NOT NULL UNIQUE,
  name_da   VARCHAR(200) NOT NULL,
  name_en   VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 99
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO group_categories (slug, name_da, name_en, sort_order) VALUES
  ('interest',     'Interesse',    'Interest',      1),
  ('local',        'Lokal',        'Local',         2),
  ('professional', 'Professionel', 'Professional',  3),
  ('event',        'Begivenhed',   'Event',         4),
  ('other',        'Andet',        'Other',         5);

INSERT IGNORE INTO admin_settings (key_name, key_value) VALUES
  ('group_require_approval', '0'),
  ('group_max_per_user',     '10'),
  ('group_max_members',      '1000');
