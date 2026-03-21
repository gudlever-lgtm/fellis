-- Interest categories table — replaces hardcoded frontend list
-- Run: mysql -u root fellis_eu < server/migrate-interest-categories.sql

CREATE TABLE IF NOT EXISTS interest_categories (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  da          VARCHAR(128) NOT NULL,
  en          VARCHAR(128) NOT NULL,
  icon        VARCHAR(8)   NOT NULL DEFAULT '⭐',
  sort_order  INT          NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO interest_categories (id, da, en, icon, sort_order) VALUES
-- Musik & Lyd
('musik',          'Musik',                  'Music',                  '🎵',  10),
('koncerter',      'Koncerter & Livemusik',  'Concerts & Live Music',  '🎸',  11),
('podcasts',       'Podcasts',               'Podcasts',               '🎙️', 12),
('opera',          'Opera & Klassisk musik', 'Opera & Classical Music','🎻',  13),
('dans',           'Dans',                   'Dance',                  '💃',  14),

-- Film & Underholdning
('film',           'Film & TV',              'Film & TV',              '🎬',  20),
('anime',          'Anime & Manga',          'Anime & Manga',          '🎌',  21),
('tegneserier',    'Tegneserier',            'Comics',                 '💬',  22),
('stand-up',       'Stand-up komik',         'Stand-up Comedy',        '🎤',  23),
('festivals',      'Festivaler & Events',    'Festivals & Events',     '🎪',  24),
('braetspil',      'Brætspil',              'Board Games',            '🎲',  25),

-- Gaming
('gaming',         'Gaming',                 'Gaming',                 '🎮',  30),
('e-sport',        'E-sport',                'E-sports',               '🏆',  31),

-- Sport & Fitness
('sport',          'Sport',                  'Sports',                 '⚽',  40),
('fodbold',        'Fodbold',                'Football',               '⚽',  41),
('basketball',     'Basketball',             'Basketball',             '🏀',  42),
('tennis',         'Tennis',                 'Tennis',                 '🎾',  43),
('golf',           'Golf',                   'Golf',                   '⛳',  44),
('cykling',        'Cykling',                'Cycling',                '🚴',  45),
('loeb',           'Løb',                   'Running',                '🏃',  46),
('svoemning',      'Svømning',              'Swimming',               '🏊',  47),
('fitness',        'Fitness & Træning',      'Fitness & Training',     '🏋️', 48),
('yoga',           'Yoga',                   'Yoga',                   '🧘',  49),
('kampsport',      'Kampsport',              'Martial Arts',           '🥋',  50),
('ski',            'Ski & Wintersport',      'Skiing & Winter Sports', '⛷️', 51),
('surfing',        'Surfing',                'Surfing',                '🏄',  52),
('klatring',       'Klatring',               'Climbing',               '🧗',  53),
('vandring',       'Vandring',               'Hiking',                 '🥾',  54),

-- Natur & Friluftsliv
('natur',          'Natur',                  'Nature',                 '🌿',  60),
('friluftsliv',    'Friluftsliv',            'Outdoor Life',           '🏕️', 61),
('camping',        'Camping',                'Camping',                '⛺',  62),
('fiskeri',        'Fiskeri',                'Fishing',                '🎣',  63),
('jagt',           'Jagt',                   'Hunting',                '🦌',  64),
('hunde',          'Hunde',                  'Dogs',                   '🐕',  65),
('katte',          'Katte',                  'Cats',                   '🐈',  66),
('kaeledyr',       'Kæledyr',               'Pets',                   '🐾',  67),

-- Mad & Drikke
('mad',            'Mad',                    'Food',                   '🍕',  70),
('madlavning',     'Madlavning',             'Cooking',                '👨‍🍳',71),
('bagvaerk',       'Bagværk & Kage',        'Baking & Cake',          '🍰',  72),
('grillmad',       'Grillmad & BBQ',         'BBQ & Grilling',         '🔥',  73),
('vegansk',        'Vegansk & Plantebaseret','Vegan & Plant-based',    '🥗',  74),
('vin',            'Vin',                    'Wine',                   '🍷',  75),
('ol',             'Øl & Craft beer',       'Beer & Craft Beer',      '🍺',  76),
('kaffe',          'Kaffe',                  'Coffee',                 '☕',  77),

-- Rejser
('rejser',         'Rejser',                 'Travel',                 '✈️', 80),

-- Teknologi
('teknologi',      'Teknologi',              'Technology',             '💻',  90),
('ai',             'Kunstig intelligens',    'Artificial Intelligence','🤖',  91),
('programmering',  'Programmering',          'Programming',            '👨‍💻',92),
('cybersikkerhed', 'Cybersikkerhed',         'Cybersecurity',          '🔐',  93),
('blockchain',     'Blockchain',             'Blockchain',             '⛓️', 94),
('robotik',        'Robotik',                'Robotics',               '🦾',  95),
('gadgets',        'Gadgets',                'Gadgets',                '📱',  96),
('rum',            'Rumfart & Astronomi',    'Space & Astronomy',      '🌌',  97),

-- Videnskab & Uddannelse
('videnskab',      'Videnskab',              'Science',                '🔬', 100),
('uddannelse',     'Uddannelse',             'Education',              '🎓', 101),
('matematik',      'Matematik',              'Mathematics',            '🔢', 102),
('historie',       'Historie',               'History',                '🏺', 103),
('psykologi',      'Psykologi',              'Psychology',             '🧠', 104),
('filosofi',       'Filosofi',               'Philosophy',             '🤔', 105),
('sprog',          'Sprog & Lingvistik',     'Languages & Linguistics','🗣️',106),
('jura',           'Jura',                   'Law',                    '⚖️',107),

-- Kunst & Kreativitet
('kunst',          'Kunst',                  'Art',                    '🎨', 110),
('fotografering',  'Fotografering',          'Photography',            '📷', 111),
('video',          'Video & Film',           'Video & Filmmaking',     '🎥', 112),
('design',         'Design',                 'Design',                 '🖌️',113),
('arkitektur',     'Arkitektur',             'Architecture',           '🏛️',114),
('skrivning',      'Skrivning & Forfatterskab','Writing & Authorship', '✍️', 115),
('animation',      'Animation',              'Animation',              '🎞️',116),
('haandvaerk',     'Håndværk & Kreativitet', 'Crafts & Creativity',   '🧵', 117),
('teater',         'Teater & Scenekunst',    'Theatre & Performing Arts','🎭',118),
('kunstmuseer',    'Kunstmuseer & Gallerier','Art Museums & Galleries','🖼️',119),

-- Bolig & Have
('bolig',          'Bolig & Ejendom',        'Housing & Property',     '🏠', 120),
('have',           'Have & Planter',         'Garden & Plants',        '🌱', 121),
('indretning',     'Indretning & Boligindretning','Interior Design',   '🛋️',122),
('baeredygtighed', 'Bæredygtighed',         'Sustainability',         '♻️',123),
('diy',            'Gør-det-selv',           'DIY',                    '🔨', 124),

-- Erhverv & Karriere
('erhverv',        'Erhverv & Business',     'Business',               '💼', 130),
('ivaerksaetter',  'Iværksætter',           'Entrepreneurship',       '🚀', 131),
('ledelse',        'Ledelse & Management',   'Leadership & Management','👔', 132),
('marketing',      'Marketing',              'Marketing',              '📣', 133),
('salg',           'Salg',                   'Sales',                  '🤝', 134),
('hr',             'HR & Personale',         'HR & People',            '👥', 135),
('startup',        'Startup',                'Startup',                '💡', 136),
('ejendomme',      'Ejendomme',              'Real Estate',            '🏢', 137),

-- Økonomi & Finans
('okonomi',        'Økonomi',               'Finance',                '💰', 140),
('investering',    'Investering',            'Investing',              '📈', 141),
('kryptovaluta',   'Kryptovaluta',           'Cryptocurrency',         '🪙', 142),
('personlig-okonomi','Personlig økonomi',    'Personal Finance',       '💳', 143),

-- Sundhed & Velvære
('sundhed',        'Sundhed',                'Health',                 '💪', 150),
('mental-sundhed', 'Mental sundhed',         'Mental Health',          '🧘', 151),
('kost',           'Kost & Ernæring',        'Nutrition & Diet',       '🥑', 152),
('meditation',     'Meditation & Mindfulness','Meditation & Mindfulness','🕯️',153),
('alternativ-medicin','Naturmedicin',        'Alternative Medicine',   '🌿', 154),

-- Familie & Relationer
('familie',        'Familie',                'Family',                 '👨‍👩‍👧‍👦',160),
('boern',          'Børn & Forældre',       'Children & Parenting',   '👶', 161),
('dating',         'Dating & Kærlighed',    'Dating & Love',          '❤️', 162),
('minimalisme',    'Minimalisme',            'Minimalism',             '✨', 163),
('hygge',          'Hygge',                  'Hygge',                  '🕯️',164),

-- Transport
('biler',          'Biler',                  'Cars',                   '🚗', 170),
('elbiler',        'Elbiler',                'Electric Cars',          '⚡', 171),
('motorcykler',    'Motorcykler',            'Motorcycles',            '🏍️',172),
('tog',            'Tog & Jernbane',         'Trains & Railways',      '🚂', 173),

-- Samfund & Kultur
('nyheder',        'Nyheder',                'News',                   '📰', 180),
('politik',        'Politik',                'Politics',               '🏛️',181),
('frivillighed',   'Frivillighed',           'Volunteering',           '🫶', 182),
('aktivisme',      'Aktivisme',              'Activism',               '✊', 183),
('lokalsamfund',   'Lokalsamfund',           'Local Community',        '🏘️',184),
('religion',       'Religion & Spiritualitet','Religion & Spirituality','🙏',185),
('dansk-kultur',   'Dansk kultur',           'Danish Culture',         '🇩🇰',186),
('nordisk-kultur', 'Nordisk kultur',         'Nordic Culture',         '🌍', 187),

-- Mode & Livsstil
('mode',           'Mode',                   'Fashion',                '👗', 190),
('humor',          'Humor',                  'Humor',                  '😄', 191),
('boger',          'Bøger',                 'Books',                  '📚', 192);
