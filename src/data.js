// ── Shared fake data for fellis.eu ──

// Deterministic color from name
export function nameToColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = ['#2D6A4F', '#40916C', '#52B788', '#1877F2', '#6C63FF', '#E07A5F', '#D4A574', '#81B29A', '#3D405B', '#F2CC8F']
  return colors[Math.abs(hash) % colors.length]
}

export function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('')
}

// Shared reaction emojis (used by posts and reels)
export const REACTIONS = [
  { emoji: '👍', label: { da: 'Synes godt om', en: 'Like' } },
  { emoji: '❤️', label: { da: 'Elsker', en: 'Love' } },
  { emoji: '😄', label: { da: 'Haha', en: 'Haha' } },
  { emoji: '😮', label: { da: 'Wow', en: 'Wow' } },
  { emoji: '😢', label: { da: 'Trist', en: 'Sad' } },
  { emoji: '😡', label: { da: 'Vred', en: 'Angry' } },
]


// Supported UI languages — add a new entry here + a matching key in PT to enable a new language
// All supported European languages (ordered: primary first, then alphabetical by label)
export const EUROPEAN_LANGUAGES = [
  { code: 'da', label: 'Dansk',          flag: '🇩🇰', country: 'Denmark' },
  { code: 'en', label: 'English',        flag: '🇬🇧', country: 'United Kingdom' },
  { code: 'bg', label: 'Български',      flag: '🇧🇬', country: 'Bulgaria' },
  { code: 'cs', label: 'Čeština',        flag: '🇨🇿', country: 'Czech Republic' },
  { code: 'de', label: 'Deutsch',        flag: '🇩🇪', country: 'Germany' },
  { code: 'el', label: 'Ελληνικά',       flag: '🇬🇷', country: 'Greece' },
  { code: 'es', label: 'Español',        flag: '🇪🇸', country: 'Spain' },
  { code: 'et', label: 'Eesti',          flag: '🇪🇪', country: 'Estonia' },
  { code: 'fi', label: 'Suomi',          flag: '🇫🇮', country: 'Finland' },
  { code: 'fr', label: 'Français',       flag: '🇫🇷', country: 'France' },
  { code: 'ga', label: 'Gaeilge',        flag: '🇮🇪', country: 'Ireland' },
  { code: 'hr', label: 'Hrvatski',       flag: '🇭🇷', country: 'Croatia' },
  { code: 'hu', label: 'Magyar',         flag: '🇭🇺', country: 'Hungary' },
  { code: 'it', label: 'Italiano',       flag: '🇮🇹', country: 'Italy' },
  { code: 'lb', label: 'Lëtzebuergesch', flag: '🇱🇺', country: 'Luxembourg' },
  { code: 'lt', label: 'Lietuvių',       flag: '🇱🇹', country: 'Lithuania' },
  { code: 'lv', label: 'Latviešu',       flag: '🇱🇻', country: 'Latvia' },
  { code: 'mt', label: 'Malti',          flag: '🇲🇹', country: 'Malta' },
  { code: 'nl', label: 'Nederlands',     flag: '🇳🇱', country: 'Netherlands' },
  { code: 'no', label: 'Norsk',          flag: '🇳🇴', country: 'Norway' },
  { code: 'pl', label: 'Polski',         flag: '🇵🇱', country: 'Poland' },
  { code: 'pt', label: 'Português',      flag: '🇵🇹', country: 'Portugal' },
  { code: 'ro', label: 'Română',         flag: '🇷🇴', country: 'Romania' },
  { code: 'sk', label: 'Slovenčina',     flag: '🇸🇰', country: 'Slovakia' },
  { code: 'sl', label: 'Slovenščina',    flag: '🇸🇮', country: 'Slovenia' },
  { code: 'sv', label: 'Svenska',        flag: '🇸🇪', country: 'Sweden' },
]

// Kept for backwards compatibility (alias)
export const SUPPORTED_LANGS = EUROPEAN_LANGUAGES

// UI language options — languages with at least partial translations.
// Missing keys fall back to English via getTranslations().
const TRANSLATED_LANGS = ['da', 'en', 'de', 'fr', 'es', 'it', 'nl', 'sv', 'no', 'pl', 'pt']
export const UI_LANGS = EUROPEAN_LANGUAGES.filter(l => TRANSLATED_LANGS.includes(l.code))

// Map IP country codes to language codes
export const IP_COUNTRY_LANG_MAP = {
  'DK': 'da',
  'DE': 'de', 'AT': 'de', 'LI': 'de',
  'FR': 'fr', 'MC': 'fr',
  'ES': 'es',
  'IT': 'it', 'SM': 'it', 'VA': 'it',
  'NL': 'nl', 'BE': 'nl',
  'SE': 'sv',
  'NO': 'no',
  'FI': 'fi',
  'PL': 'pl',
  'PT': 'pt',
  'RO': 'ro',
  'HU': 'hu',
  'CZ': 'cs',
  'SK': 'sk',
  'HR': 'hr',
  'BG': 'bg',
  'GR': 'el', 'CY': 'el',
  'LT': 'lt',
  'LV': 'lv',
  'EE': 'et',
  'SI': 'sl',
  'MT': 'en',
  'IE': 'en',
  'LU': 'lb',
  'GB': 'en', 'US': 'en', 'CA': 'en', 'AU': 'en', 'NZ': 'en',
}

// Detect language from IP geolocation (async, used on first visit only)
export async function detectLangFromIP() {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const data = await res.json()
    const mapped = IP_COUNTRY_LANG_MAP[data.country_code]
    if (mapped && UI_LANGS.some(l => l.code === mapped)) return mapped
    return null
  } catch {
    return null
  }
}

// Auto-detect best language from browser preferences or IP
export function detectLang() {
  const stored = localStorage.getItem('fellis_lang')
  if (stored && UI_LANGS.some(l => l.code === stored)) return stored
  // Try browser language preferences
  for (const pref of (navigator.languages || [])) {
    const code = pref.split('-')[0].toLowerCase()
    if (UI_LANGS.some(l => l.code === code)) return code
  }
  return 'da'
}

export { PT, getTranslations } from './i18n/index.js'


// Interest categories (bilingual) used in ProfilePage and feed algorithm
export const INTEREST_CATEGORIES = [
  // Musik & Lyd
  { id: 'musik',           da: 'Musik',                    en: 'Music',                   icon: '🎵' },
  { id: 'koncerter',       da: 'Koncerter & Livemusik',    en: 'Concerts & Live Music',   icon: '🎸' },
  { id: 'podcasts',        da: 'Podcasts',                 en: 'Podcasts',                icon: '🎙️' },
  { id: 'opera',           da: 'Opera & Klassisk musik',   en: 'Opera & Classical Music', icon: '🎻' },
  { id: 'dans',            da: 'Dans',                     en: 'Dance',                   icon: '💃' },
  // Film & Underholdning
  { id: 'film',            da: 'Film & TV',                en: 'Film & TV',               icon: '🎬' },
  { id: 'anime',           da: 'Anime & Manga',            en: 'Anime & Manga',           icon: '🎌' },
  { id: 'tegneserier',     da: 'Tegneserier',              en: 'Comics',                  icon: '💬' },
  { id: 'stand-up',        da: 'Stand-up komik',           en: 'Stand-up Comedy',         icon: '🎤' },
  { id: 'festivals',       da: 'Festivaler & Events',      en: 'Festivals & Events',      icon: '🎪' },
  { id: 'braetspil',       da: 'Brætspil',                en: 'Board Games',             icon: '🎲' },
  // Gaming
  { id: 'gaming',          da: 'Gaming',                   en: 'Gaming',                  icon: '🎮' },
  { id: 'e-sport',         da: 'E-sport',                  en: 'E-sports',                icon: '🏆' },
  // Sport & Fitness
  { id: 'sport',           da: 'Sport',                    en: 'Sports',                  icon: '⚽' },
  { id: 'fodbold',         da: 'Fodbold',                  en: 'Football',                icon: '⚽' },
  { id: 'basketball',      da: 'Basketball',               en: 'Basketball',              icon: '🏀' },
  { id: 'tennis',          da: 'Tennis',                   en: 'Tennis',                  icon: '🎾' },
  { id: 'golf',            da: 'Golf',                     en: 'Golf',                    icon: '⛳' },
  { id: 'cykling',         da: 'Cykling',                  en: 'Cycling',                 icon: '🚴' },
  { id: 'loeb',            da: 'Løb',                     en: 'Running',                 icon: '🏃' },
  { id: 'svoemning',       da: 'Svømning',                en: 'Swimming',                icon: '🏊' },
  { id: 'fitness',         da: 'Fitness & Træning',        en: 'Fitness & Training',      icon: '🏋️' },
  { id: 'yoga',            da: 'Yoga',                     en: 'Yoga',                    icon: '🧘' },
  { id: 'kampsport',       da: 'Kampsport',                en: 'Martial Arts',            icon: '🥋' },
  { id: 'ski',             da: 'Ski & Wintersport',        en: 'Skiing & Winter Sports',  icon: '⛷️' },
  { id: 'surfing',         da: 'Surfing',                  en: 'Surfing',                 icon: '🏄' },
  { id: 'klatring',        da: 'Klatring',                 en: 'Climbing',                icon: '🧗' },
  { id: 'vandring',        da: 'Vandring',                 en: 'Hiking',                  icon: '🥾' },
  // Natur & Friluftsliv
  { id: 'natur',           da: 'Natur',                    en: 'Nature',                  icon: '🌿' },
  { id: 'friluftsliv',     da: 'Friluftsliv',              en: 'Outdoor Life',            icon: '🏕️' },
  { id: 'camping',         da: 'Camping',                  en: 'Camping',                 icon: '⛺' },
  { id: 'fiskeri',         da: 'Fiskeri',                  en: 'Fishing',                 icon: '🎣' },
  { id: 'jagt',            da: 'Jagt',                     en: 'Hunting',                 icon: '🦌' },
  { id: 'hunde',           da: 'Hunde',                    en: 'Dogs',                    icon: '🐕' },
  { id: 'katte',           da: 'Katte',                    en: 'Cats',                    icon: '🐈' },
  { id: 'kaeledyr',        da: 'Kæledyr',                 en: 'Pets',                    icon: '🐾' },
  // Mad & Drikke
  { id: 'mad',             da: 'Mad',                      en: 'Food',                    icon: '🍕' },
  { id: 'madlavning',      da: 'Madlavning',               en: 'Cooking',                 icon: '👨‍🍳' },
  { id: 'bagvaerk',        da: 'Bagværk & Kage',          en: 'Baking & Cake',           icon: '🍰' },
  { id: 'grillmad',        da: 'Grillmad & BBQ',           en: 'BBQ & Grilling',          icon: '🔥' },
  { id: 'vegansk',         da: 'Vegansk & Plantebaseret',  en: 'Vegan & Plant-based',     icon: '🥗' },
  { id: 'vin',             da: 'Vin',                      en: 'Wine',                    icon: '🍷' },
  { id: 'ol',              da: 'Øl & Craft beer',         en: 'Beer & Craft Beer',       icon: '🍺' },
  { id: 'kaffe',           da: 'Kaffe',                    en: 'Coffee',                  icon: '☕' },
  // Rejser
  { id: 'rejser',          da: 'Rejser',                   en: 'Travel',                  icon: '✈️' },
  // Teknologi
  { id: 'teknologi',       da: 'Teknologi',                en: 'Technology',              icon: '💻' },
  { id: 'ai',              da: 'Kunstig intelligens',      en: 'Artificial Intelligence', icon: '🤖' },
  { id: 'programmering',   da: 'Programmering',            en: 'Programming',             icon: '👨‍💻' },
  { id: 'cybersikkerhed',  da: 'Cybersikkerhed',           en: 'Cybersecurity',           icon: '🔐' },
  { id: 'blockchain',      da: 'Blockchain',               en: 'Blockchain',              icon: '⛓️' },
  { id: 'robotik',         da: 'Robotik',                  en: 'Robotics',                icon: '🦾' },
  { id: 'gadgets',         da: 'Gadgets',                  en: 'Gadgets',                 icon: '📱' },
  { id: 'rum',             da: 'Rumfart & Astronomi',      en: 'Space & Astronomy',       icon: '🌌' },
  // Videnskab & Uddannelse
  { id: 'videnskab',       da: 'Videnskab',                en: 'Science',                 icon: '🔬' },
  { id: 'uddannelse',      da: 'Uddannelse',               en: 'Education',               icon: '🎓' },
  { id: 'matematik',       da: 'Matematik',                en: 'Mathematics',             icon: '🔢' },
  { id: 'historie',        da: 'Historie',                 en: 'History',                 icon: '🏺' },
  { id: 'psykologi',       da: 'Psykologi',                en: 'Psychology',              icon: '🧠' },
  { id: 'filosofi',        da: 'Filosofi',                 en: 'Philosophy',              icon: '🤔' },
  { id: 'sprog',           da: 'Sprog & Lingvistik',       en: 'Languages & Linguistics', icon: '🗣️' },
  { id: 'jura',            da: 'Jura',                     en: 'Law',                     icon: '⚖️' },
  // Kunst & Kreativitet
  { id: 'kunst',           da: 'Kunst',                    en: 'Art',                     icon: '🎨' },
  { id: 'fotografering',   da: 'Fotografering',            en: 'Photography',             icon: '📷' },
  { id: 'video',           da: 'Video & Film',             en: 'Video & Filmmaking',      icon: '🎥' },
  { id: 'design',          da: 'Design',                   en: 'Design',                  icon: '🖌️' },
  { id: 'arkitektur',      da: 'Arkitektur',               en: 'Architecture',            icon: '🏛️' },
  { id: 'skrivning',       da: 'Skrivning & Forfatterskab',en: 'Writing & Authorship',    icon: '✍️' },
  { id: 'animation',       da: 'Animation',                en: 'Animation',               icon: '🎞️' },
  { id: 'haandvaerk',      da: 'Håndværk & Kreativitet',  en: 'Crafts & Creativity',     icon: '🧵' },
  { id: 'teater',          da: 'Teater & Scenekunst',      en: 'Theatre & Performing Arts',icon: '🎭' },
  { id: 'kunstmuseer',     da: 'Kunstmuseer & Gallerier',  en: 'Art Museums & Galleries', icon: '🖼️' },
  // Bolig & Have
  { id: 'bolig',           da: 'Bolig & Ejendom',          en: 'Housing & Property',      icon: '🏠' },
  { id: 'have',            da: 'Have & Planter',           en: 'Garden & Plants',         icon: '🌱' },
  { id: 'indretning',      da: 'Indretning',               en: 'Interior Design',         icon: '🛋️' },
  { id: 'baeredygtighed',  da: 'Bæredygtighed',           en: 'Sustainability',           icon: '♻️' },
  { id: 'diy',             da: 'Gør-det-selv',             en: 'DIY',                     icon: '🔨' },
  // Erhverv & Karriere
  { id: 'erhverv',         da: 'Erhverv & Business',       en: 'Business',                icon: '💼' },
  { id: 'ivaerksaetter',   da: 'Iværksætter',             en: 'Entrepreneurship',        icon: '🚀' },
  { id: 'ledelse',         da: 'Ledelse & Management',     en: 'Leadership & Management', icon: '👔' },
  { id: 'marketing',       da: 'Marketing',                en: 'Marketing',               icon: '📣' },
  { id: 'salg',            da: 'Salg',                     en: 'Sales',                   icon: '🤝' },
  { id: 'hr',              da: 'HR & Personale',           en: 'HR & People',             icon: '👥' },
  { id: 'startup',         da: 'Startup',                  en: 'Startup',                 icon: '💡' },
  { id: 'ejendomme',       da: 'Ejendomme',                en: 'Real Estate',             icon: '🏢' },
  // Økonomi & Finans
  { id: 'okonomi',         da: 'Økonomi',                 en: 'Finance',                 icon: '💰' },
  { id: 'investering',     da: 'Investering',              en: 'Investing',               icon: '📈' },
  { id: 'kryptovaluta',    da: 'Kryptovaluta',             en: 'Cryptocurrency',          icon: '🪙' },
  { id: 'personlig-okonomi',da: 'Personlig økonomi',       en: 'Personal Finance',        icon: '💳' },
  // Sundhed & Velvære
  { id: 'sundhed',         da: 'Sundhed',                  en: 'Health',                  icon: '💪' },
  { id: 'mental-sundhed',  da: 'Mental sundhed',           en: 'Mental Health',           icon: '🧘' },
  { id: 'kost',            da: 'Kost & Ernæring',          en: 'Nutrition & Diet',        icon: '🥑' },
  { id: 'meditation',      da: 'Meditation & Mindfulness', en: 'Meditation & Mindfulness',icon: '🕯️' },
  { id: 'alternativ-medicin',da: 'Naturmedicin',           en: 'Alternative Medicine',    icon: '🌿' },
  // Familie & Relationer
  { id: 'familie',         da: 'Familie',                  en: 'Family',                  icon: '👨‍👩‍👧‍👦' },
  { id: 'boern',           da: 'Børn & Forældre',         en: 'Children & Parenting',    icon: '👶' },
  { id: 'dating',          da: 'Dating & Kærlighed',      en: 'Dating & Love',           icon: '❤️' },
  { id: 'minimalisme',     da: 'Minimalisme',              en: 'Minimalism',              icon: '✨' },
  { id: 'hygge',           da: 'Hygge',                    en: 'Hygge',                   icon: '🕯️' },
  // Transport
  { id: 'biler',           da: 'Biler',                    en: 'Cars',                    icon: '🚗' },
  { id: 'elbiler',         da: 'Elbiler',                  en: 'Electric Cars',           icon: '⚡' },
  { id: 'motorcykler',     da: 'Motorcykler',              en: 'Motorcycles',             icon: '🏍️' },
  { id: 'tog',             da: 'Tog & Jernbane',           en: 'Trains & Railways',       icon: '🚂' },
  // Samfund & Kultur
  { id: 'nyheder',         da: 'Nyheder',                  en: 'News',                    icon: '📰' },
  { id: 'politik',         da: 'Politik',                  en: 'Politics',                icon: '🏛️' },
  { id: 'frivillighed',    da: 'Frivillighed',             en: 'Volunteering',            icon: '🫶' },
  { id: 'aktivisme',       da: 'Aktivisme',                en: 'Activism',                icon: '✊' },
  { id: 'lokalsamfund',    da: 'Lokalsamfund',             en: 'Local Community',         icon: '🏘️' },
  { id: 'religion',        da: 'Religion & Spiritualitet', en: 'Religion & Spirituality', icon: '🙏' },
  { id: 'dansk-kultur',    da: 'Dansk kultur',             en: 'Danish Culture',          icon: '🇩🇰' },
  { id: 'nordisk-kultur',  da: 'Nordisk kultur',           en: 'Nordic Culture',          icon: '🌍' },
  // Mode & Livsstil
  { id: 'mode',            da: 'Mode',                     en: 'Fashion',                 icon: '👗' },
  { id: 'humor',           da: 'Humor',                    en: 'Humor',                   icon: '😄' },
  { id: 'boger',           da: 'Bøger',                   en: 'Books',                   icon: '📚' },
]

