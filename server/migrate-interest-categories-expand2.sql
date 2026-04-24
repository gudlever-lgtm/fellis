-- Interest categories — second expansion batch (~40 new entries)
-- Run: cd server && npm run migrate

INSERT IGNORE INTO interest_categories (id, da, en, icon, sort_order) VALUES

-- ── Sport & Bevægelse (manglede) ─────────────────────────────────────────────
('volleyball',       'Volleyball',             'Volleyball',             '🏐', 300),
('ishockey',         'Ishockey',               'Ice Hockey',             '🏒', 301),
('skoejteloeb',      'Skøjteløb',             'Ice Skating',            '⛸️',302),
('springgymnastik',  'Springgymnastik',        'Gymnastics',             '🤸', 303),
('mountainbike',     'Mountainbike & MTB',     'Mountain Biking',        '🚵', 304),
('skateboard',       'Skateboard & Longboard', 'Skateboarding',          '🛹', 305),
('dykning',          'Dykning & Snorkling',    'Diving & Snorkelling',   '🤿', 306),
('bueskydning',      'Bueskydning',            'Archery',                '🏹', 307),
('maraton',          'Maraton & Ultraløb',    'Marathon & Ultra Running','🏅', 308),
('boksning',         'Boksning & Kickboxing',  'Boxing & Kickboxing',    '🥊', 309),
('kitesurfing',      'Kitesurfing & Windsurfing','Kitesurfing',          '🪁', 310),
('styrkeloeft',      'Styrkeløft & Powerlifting','Powerlifting',         '🏋️',311),

-- ── Dansk kultur (manglede) ───────────────────────────────────────────────────
('sommerhus',        'Sommerhuskultur',        'Summer Cottage Life',    '🏡', 320),
('spejdere',         'Spejdere & FDF',         'Scouts',                 '⚜️', 321),
('viser-folkemusik', 'Viser & Folkemusik',     'Danish Folk Music',      '🪗', 322),

-- ── Natur & Miljø (manglede) ─────────────────────────────────────────────────
('havmiljoe',        'Havmiljø & Marin biologi','Marine Biology & Ocean', '🌊', 330),
('permakultur',      'Permakultur & Selvforsyning','Permaculture',        '🌾', 331),
('bylandbrug',       'Bylandbrug & Byhøns',   'Urban Farming',          '🐓', 332),
('insekter',         'Insekter & Entomologi',  'Insects & Entomology',   '🦋', 333),

-- ── Mad & Drikke (manglede) ───────────────────────────────────────────────────
('asiatisk-mad',     'Japansk & Asiatisk mad', 'Japanese & Asian Food',  '🍣', 340),
('krydret-mad',      'Krydret mad & Chili',    'Spicy Food & Chili',     '🌶️',341),
('ost-charcuteri',   'Ost & Charcuteri',       'Cheese & Charcuterie',   '🧀', 342),
('cocktails',        'Cocktails & Mixologi',   'Cocktails & Mixology',   '🍸', 343),
('streetfood',       'Street food',            'Street Food',            '🌮', 344),
('surdeig',          'Surdej & Brødbagning',   'Sourdough & Bread',      '🍞', 345),
('te',               'Te & Tekultur',          'Tea & Tea Culture',      '🫖', 346),

-- ── Teknologi (manglede) ─────────────────────────────────────────────────────
('smarthome',        'Smarthome & Hjemmeautomation','Smart Home',        '🏠', 350),
('open-source',      'Open source & Linux',    'Open Source & Linux',    '🐧', 351),
('radioamatoer',     'Radioamatør',           'Amateur Radio (Ham)',     '📡', 352),

-- ── Videnskab (manglede) ──────────────────────────────────────────────────────
('kemi',             'Kemi & Laboratorium',    'Chemistry & Lab',        '⚗️', 360),
('biologi-genetik',  'Biologi & Genetik',      'Biology & Genetics',     '🧬', 361),
('geologi',          'Geologi & Mineralogi',   'Geology & Minerals',     '🌋', 362),

-- ── Livsstil (manglede) ───────────────────────────────────────────────────────
('astrologi',        'Astrologi & Horoskoper', 'Astrology',              '🌛', 370),
('biohacking',       'Biohacking & Optimering','Biohacking',             '🔬', 371),
('zero-waste',       'Zero waste & Genbrug',   'Zero Waste',             '♻️', 372),
('koldtvand',        'Koldtvandssimning & Kuldeeksponering','Cold Water Immersion','🥶',373),

-- ── Erhverv & Karriere (manglede) ─────────────────────────────────────────────
('e-learning',       'E-learning & Onlinekurser','E-Learning',           '🎓', 380),
('content-creation', 'Content creation & Blogging','Content Creation',   '✍️', 381),
('freelancing',      'Freelancing & Remote work','Freelancing',          '💻', 382),

-- ── Kunst & Kreativitet (manglede) ────────────────────────────────────────────
('traearbejde',      'Træarbejde & Snedkerkunst','Woodworking',          '🪵', 390),
('poesi',            'Poesi & Spoken word',    'Poetry & Spoken Word',   '📖', 391),

-- ── Underholdning (manglede) ──────────────────────────────────────────────────
('vr',               'VR & Mixed Reality',     'VR & Mixed Reality',     '🥽', 400),
('live-sport',       'Live sport & Stadion',   'Live Sports & Stadiums', '🏟️',401),
('cirkus',           'Cirkus & Gadesport',     'Circus & Street Arts',   '🎪', 402);
