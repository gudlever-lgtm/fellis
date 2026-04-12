-- Expanded interest categories — adds ~35 new entries across all groups
-- Run: cd server && npm run migrate

-- Sport (fits in the 55-59 gap between vandring=54 and natur=60)
INSERT IGNORE INTO interest_categories (id, da, en, icon, sort_order) VALUES
('haandbold',        'Håndbold',               'Handball',               '🥅',  55),
('sejlsport',        'Sejlsport',              'Sailing',                '⛵',  56),
('ridning',          'Ridning & Hestesport',   'Horse Riding',           '🏇',  57),
('padel',            'Padel & Bordtennis',     'Padel & Table Tennis',   '🏓',  58),
('kajak',            'Kajak & Roning',         'Kayaking & Rowing',      '🚣',  59),

-- Natur & Friluftsliv (extends the 60-67 group)
('svampejagt',       'Svampejagt',             'Mushroom Foraging',      '🍄',  68),
('fuglekiggeri',     'Fuglekiggeri',           'Birdwatching',           '🪺',  69),
('biavl',            'Biavl',                  'Beekeeping',             '🐝',  70),
('botanik',          'Botanik & Vilde planter','Botany & Wild Plants',   '🌸',  71),
('akvarium',         'Akvarier & Terrarium',   'Aquariums & Terrariums', '🐟',  72),

-- Mad & Drikke (extends the 70-77 group)
('fermentering',     'Fermentering & Syltning','Fermentation & Preserving','🫙', 78),
('hjemmebrygning',   'Hjemmebrygning',         'Homebrewing',            '🍻',  79),

-- Musik & Lyd (extends the 10-14 group)
('musikinstrumenter','Spille instrument',       'Playing Instruments',    '🎹', 200),
('musikproduktion',  'Musikproduktion & DJ',   'Music Production & DJing','🎚️',201),
('sang-kor',         'Sang & Kor',             'Singing & Choir',        '🎤', 202),
('sangskrivning',    'Sangskrivning',          'Songwriting',            '🖊️',203),

-- Film & Underholdning (extends the 20-25 group)
('streaming',        'Streaming & Serier',     'Streaming & TV Series',  '📺', 210),
('rollespil',        'Rollespil & D&D',        'Tabletop RPG & D&D',     '🎲', 211),
('kortspil-samlekort','Samlekort & Kortspil',  'Trading Card Games',     '🃏', 212),
('puslespil',        'Puslespil & Logik',      'Puzzles & Logic',        '🧩', 213),
('cosplay',          'Cosplay',                'Cosplay',                '🎭', 214),
('mobilspil',        'Mobilspil',              'Mobile Gaming',          '📱', 215),

-- Kunst & Kreativitet (extends the 110-119 group)
('keramik',          'Keramik & Pottemager',   'Ceramics & Pottery',     '🏺', 220),
('strik-haekling',   'Strik & Hækling',       'Knitting & Crochet',     '🧶', 221),
('syning',           'Syning & Broderi',       'Sewing & Embroidery',    '🪡', 222),
('kalligrafi',       'Kalligrafi',             'Calligraphy',            '✒️', 223),

-- Teknologi (extends the 90-97 group)
('tredjepart-print', '3D-print & Fablab',      '3D Printing & Fablab',   '🖨️',230),
('data-science',     'Data science & Analyse', 'Data Science & Analytics','📊',231),
('droner',           'Droner & FPV',           'Drones & FPV',           '🚁', 232),

-- Sundhed & Livsstil
('wellness',         'Wellness & Spa',         'Wellness & Spa',         '💆', 240),
('makeup-skoenhed',  'Makeup & Skønhed',      'Makeup & Beauty',        '💄', 241),
('aabenvandsimning', 'Åbenvandssimning',      'Open Water Swimming',    '🌊', 242),
('slow-living',      'Slow living',            'Slow Living',            '🍃', 243),

-- Samfund & Kultur (extends the 180-187 group)
('lgbtq',            'LGBTQ+',                 'LGBTQ+',                 '🌈', 250),
('kulturarv',        'Kulturarv & Museer',     'Cultural Heritage',      '🏛️',251),
('kongehuset',       'Kongehuset',             'The Royal Family',       '👑', 252),
('geopolitik',       'Geopolitik',             'Geopolitics',            '🗺️',253);
