-- Marketplace categories — replaces hardcoded MARKETPLACE_CATEGORIES in src/Platform.jsx
-- Adds support for optional subcategories (parent_id = self-FK).
-- Also adds marketplace_listings.subcategory column.
-- Run: mysql -u root fellis_eu < server/migrate-marketplace-categories.sql

CREATE TABLE IF NOT EXISTS marketplace_categories (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  parent_id   VARCHAR(64)  DEFAULT NULL,
  da          VARCHAR(128) NOT NULL,
  en          VARCHAR(128) NOT NULL,
  icon        VARCHAR(8)   NOT NULL DEFAULT '📦',
  sort_order  INT          NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_parent_id (parent_id),
  INDEX idx_active_sort (active, sort_order),
  CONSTRAINT fk_mcat_parent FOREIGN KEY (parent_id) REFERENCES marketplace_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed top-level categories (matches former MARKETPLACE_CATEGORIES array)
INSERT IGNORE INTO marketplace_categories (id, parent_id, da, en, icon, sort_order) VALUES
  ('electronics', NULL, 'Elektronik',           'Electronics',          '🖥️', 10),
  ('furniture',   NULL, 'Møbler & Indretning',  'Furniture & Decor',    '🪑', 20),
  ('clothing',    NULL, 'Tøj & Mode',           'Clothing & Fashion',   '👕', 30),
  ('sports',      NULL, 'Sport & Fritid',       'Sports & Outdoors',    '⚽', 40),
  ('books',       NULL, 'Bøger & Medier',       'Books & Media',        '📚', 50),
  ('garden',      NULL, 'Have & Udendørs',      'Garden & Outdoor',     '🌱', 60),
  ('vehicles',    NULL, 'Biler & Transport',    'Vehicles & Transport', '🚗', 70),
  ('other',       NULL, 'Andet',                'Other',                '📦', 900);

-- Seed subcategories
INSERT IGNORE INTO marketplace_categories (id, parent_id, da, en, icon, sort_order) VALUES
  ('electronics-phones',     'electronics', 'Mobiltelefoner',        'Mobile Phones',       '📱', 11),
  ('electronics-computers',  'electronics', 'Computere & Tablets',   'Computers & Tablets', '💻', 12),
  ('electronics-audio',      'electronics', 'Lyd & Hovedtelefoner',  'Audio & Headphones',  '🎧', 13),
  ('electronics-tv',         'electronics', 'TV & Skærme',           'TV & Monitors',       '📺', 14),
  ('electronics-gaming',     'electronics', 'Gaming & Konsoller',    'Gaming & Consoles',   '🎮', 15),
  ('electronics-cameras',    'electronics', 'Kameraer & Foto',       'Cameras & Photo',     '📷', 16),
  ('electronics-smarthome',  'electronics', 'Smart hjem',            'Smart Home',          '🏠', 17),

  ('furniture-sofa',         'furniture',   'Sofa & Lænestole',      'Sofas & Armchairs',   '🛋️', 21),
  ('furniture-tables',       'furniture',   'Borde & Spisestuer',    'Tables & Dining',     '🍽️', 22),
  ('furniture-beds',         'furniture',   'Senge & Soveværelse',   'Beds & Bedroom',      '🛏️', 23),
  ('furniture-storage',      'furniture',   'Opbevaring & Reoler',   'Storage & Shelving',  '🗄️', 24),
  ('furniture-lamps',        'furniture',   'Lamper & Belysning',    'Lamps & Lighting',    '💡', 25),
  ('furniture-decor',        'furniture',   'Pynt & Indretning',     'Decor & Accents',     '🖼️', 26),

  ('clothing-womens',        'clothing',    'Dametøj',               'Womens Clothing',     '👗', 31),
  ('clothing-mens',          'clothing',    'Herretøj',              'Mens Clothing',       '👔', 32),
  ('clothing-kids',          'clothing',    'Børnetøj',              'Kids Clothing',       '👶', 33),
  ('clothing-shoes',         'clothing',    'Sko',                   'Shoes',               '👟', 34),
  ('clothing-bags',          'clothing',    'Tasker & Accessories',  'Bags & Accessories',  '👜', 35),
  ('clothing-jewelry',       'clothing',    'Smykker & Ure',         'Jewelry & Watches',   '💍', 36),

  ('sports-bicycles',        'sports',      'Cykler',                'Bicycles',            '🚲', 41),
  ('sports-fitness',         'sports',      'Fitness & Træning',     'Fitness & Training',  '🏋️', 42),
  ('sports-outdoor',         'sports',      'Outdoor & Camping',     'Outdoor & Camping',   '⛺', 43),
  ('sports-water',           'sports',      'Vandsport',             'Water Sports',        '🏄', 44),
  ('sports-winter',          'sports',      'Vintersport',           'Winter Sports',       '⛷️', 45),
  ('sports-team',            'sports',      'Holdsport',             'Team Sports',         '⚽', 46),

  ('books-fiction',          'books',       'Skønlitteratur',        'Fiction',             '📖', 51),
  ('books-nonfiction',       'books',       'Faglitteratur',         'Non-fiction',         '📘', 52),
  ('books-textbooks',        'books',       'Studiebøger',           'Textbooks',           '🎓', 53),
  ('books-comics',           'books',       'Tegneserier & Manga',   'Comics & Manga',      '💬', 54),
  ('books-music',            'books',       'Musik & Vinyl',         'Music & Vinyl',       '🎵', 55),
  ('books-movies',           'books',       'Film & Serier',         'Movies & Series',     '🎬', 56),

  ('garden-plants',          'garden',      'Planter & Blomster',    'Plants & Flowers',    '🌸', 61),
  ('garden-tools',           'garden',      'Haveværktøj',           'Garden Tools',        '🧰', 62),
  ('garden-furniture',       'garden',      'Havemøbler',            'Garden Furniture',    '🪑', 63),
  ('garden-grills',          'garden',      'Grill & Udekøkken',     'Grills & Outdoor Kitchen', '🔥', 64),
  ('garden-playground',      'garden',      'Legeplads & Børn ude',  'Playground & Outdoor Kids', '🛝', 65),

  ('vehicles-cars',          'vehicles',    'Biler',                 'Cars',                '🚗', 71),
  ('vehicles-motorcycles',   'vehicles',    'Motorcykler & Scootere','Motorcycles & Scooters', '🏍️', 72),
  ('vehicles-bicycles',      'vehicles',    'Cykler',                'Bicycles',            '🚲', 73),
  ('vehicles-parts',         'vehicles',    'Reservedele',           'Parts & Accessories', '🔧', 74),
  ('vehicles-boats',         'vehicles',    'Både & Vandfartøjer',   'Boats & Watercraft',  '⛵', 75),
  ('vehicles-trailers',      'vehicles',    'Trailere & Campingvogne','Trailers & Caravans','🚐', 76);

-- Add subcategory column to listings (nullable — existing rows stay without subcategory)
-- MariaDB/MySQL requires IF NOT EXISTS-safe pattern via INFORMATION_SCHEMA
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'marketplace_listings'
     AND COLUMN_NAME = 'subcategory') = 0,
  'ALTER TABLE marketplace_listings ADD COLUMN subcategory VARCHAR(64) DEFAULT NULL AFTER category, ADD INDEX idx_subcategory (subcategory)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
