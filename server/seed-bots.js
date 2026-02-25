import crypto from 'crypto'
import pool from './db.js'

// Bot users — privat + business
const BOTS = [
  {
    name: 'Anna Bot',
    handle: '@anna.bot',
    initials: 'AB',
    email: 'anna.bot@fellis.eu',
    bio_da: 'Glad bruger af fellis.eu 🌿 Elsker at finde gode tilbud på markedspladsen!',
    bio_en: 'Happy fellis.eu user 🌿 Love finding good deals on the marketplace!',
    location: 'København, Danmark',
    mode: 'privat',
  },
  {
    name: 'Erik Bot',
    handle: '@erik.bot',
    initials: 'EB',
    email: 'erik.bot@fellis.eu',
    bio_da: 'Tech-entusiast og cykelrytter 🚴 Sælger altid lidt fra kælderen.',
    bio_en: 'Tech enthusiast and cyclist 🚴 Always selling stuff from the basement.',
    location: 'Aarhus, Danmark',
    mode: 'privat',
  },
  {
    name: 'Maria Bot',
    handle: '@maria.bot',
    initials: 'MB',
    email: 'maria.bot@fellis.eu',
    bio_da: 'Boligstylist og loppemarkeds-elsker 🏡 Følg med for daglige fund!',
    bio_en: 'Home stylist and flea market lover 🏡 Follow along for daily finds!',
    location: 'Odense, Danmark',
    mode: 'privat',
  },
  {
    name: 'NordBot ApS',
    handle: '@nordbot.aps',
    initials: 'NB',
    email: 'nordbot@fellis.eu',
    bio_da: 'Dansk tech-virksomhed. Vi bygger fremtidens løsninger 🇩🇰',
    bio_en: 'Danish tech company. Building tomorrow\'s solutions 🇩🇰',
    location: 'København, Danmark',
    mode: 'business',
  },
]

const BOT_PASSWORD_HASH = crypto.createHash('sha256').update('bot123').digest('hex')
const BOT_HANDLES = BOTS.map(b => b.handle)

// ─── varied comments for regular posts ───────────────────────────────────────
const POST_COMMENTS = [
  { text_da: 'Fantastisk opslag! 🔥', text_en: 'Amazing post! 🔥' },
  { text_da: 'Helt enig! Godt sagt 👏', text_en: 'Totally agree! Well said 👏' },
  { text_da: 'Tak for at dele, det er virkelig inspirerende 💚', text_en: 'Thanks for sharing, really inspiring 💚' },
  { text_da: 'Wow, det ser fantastisk ud! 😍', text_en: 'Wow, that looks amazing! 😍' },
  { text_da: 'Elsker det! Mere af det her 🙌', text_en: 'Love it! More of this 🙌' },
  { text_da: 'Det er præcis det jeg trængte til at se i dag ☀️', text_en: 'Exactly what I needed to see today ☀️' },
  { text_da: 'Super spændende — tak for at dele! 🎉', text_en: 'Super exciting — thanks for sharing! 🎉' },
  { text_da: 'Imponerende! Du er virkelig god til det 💪', text_en: 'Impressive! You are really good at this 💪' },
  { text_da: 'Kan kun give tommel op! 👍', text_en: 'Can only give a thumbs up! 👍' },
  { text_da: 'Det her giver så god mening. Godt tænkt 🧠', text_en: 'This makes so much sense. Well thought out 🧠' },
  { text_da: 'Jeg er helt vild med det! 😄', text_en: 'I absolutely love this! 😄' },
  { text_da: 'Hvad en dejlig opdatering ❤️', text_en: 'What a lovely update ❤️' },
]

const BOT_REACTIONS = ['👍', '❤️', '😄', '👍', '❤️', '😮', '👍', '❤️']

// ─── bot posts ────────────────────────────────────────────────────────────────
function makeBotPosts(botIds) {
  const [annaId, erikId, mariaId, nordBotId] = botIds
  return [
    {
      author_id: annaId,
      text_da: 'Hej alle! Ny på fellis.eu og elsker allerede platformen 🌿 Trygt, dansk og uden reklamer — præcis hvad jeg ledte efter!',
      text_en: 'Hi everyone! New to fellis.eu and already loving it 🌿 Safe, Danish and ad-free — exactly what I was looking for!',
      time_da: '25 minutter siden', time_en: '25 minutes ago', likes: 18,
    },
    {
      author_id: erikId,
      text_da: 'Første cykeltur i år langs kysten 🚴 45 km og benene klager, men udsigten var alt værd. Fellis-fællesskabet er med hele vejen!',
      text_en: 'First bike ride of the year along the coast 🚴 45 km and the legs are complaining, but the view was worth it. The Fellis community is with me all the way!',
      time_da: '1 time siden', time_en: '1 hour ago', likes: 11,
    },
    {
      author_id: mariaId,
      text_da: 'Har ryddet op i stuen og fundet masser af ting der fortjener et nyt hjem 🏡 Tjek mine annoncer på markedspladsen — alt skal væk!',
      text_en: 'Cleared out the living room and found lots of things that deserve a new home 🏡 Check my listings on the marketplace — everything must go!',
      time_da: '2 timer siden', time_en: '2 hours ago', likes: 29,
    },
    {
      author_id: annaId,
      text_da: 'Lige fundet en fantastisk vintage sofa på markedspladsen her på fellis.eu 🛋️ EU-data, ingen tracking og gode fund — hvad mere kan man ønske sig?',
      text_en: 'Just found an amazing vintage sofa on the marketplace here on fellis.eu 🛋️ EU data, no tracking and great finds — what more could you ask for?',
      time_da: '4 timer siden', time_en: '4 hours ago', likes: 34,
    },
    {
      author_id: nordBotId,
      text_da: '🚀 NordBot ApS søger to dygtige udviklere til vores team i København!\n\n📌 Senior React-udvikler (fuldtid)\n📌 Backend-udvikler, Node.js (fuldtid)\n\nVi bygger EU-fokuserede SaaS-løsninger med fokus på privatliv og bæredygtighed. Send CV + motivationsbrev til jobs@nordbot.eu eller skriv direkte her 💬',
      text_en: '🚀 NordBot ApS is looking for two talented developers to join our Copenhagen team!\n\n📌 Senior React Developer (full-time)\n📌 Backend Developer, Node.js (full-time)\n\nWe build EU-focused SaaS solutions with a focus on privacy and sustainability. Send CV + cover letter to jobs@nordbot.eu or message us directly here 💬',
      time_da: '3 timer siden', time_en: '3 hours ago', likes: 52,
    },
    {
      author_id: nordBotId,
      text_da: 'Spændende nyt: NordBot ApS indgår partnerskab med tre nye EU-kunder inden udgangen af Q1 📈 Vi vokser og det samme gør vores team. Følg os for opdateringer!',
      text_en: 'Exciting news: NordBot ApS is entering into partnerships with three new EU clients before the end of Q1 📈 We are growing and so is our team. Follow us for updates!',
      time_da: '1 dag siden', time_en: '1 day ago', likes: 87,
    },
    {
      author_id: nordBotId,
      text_da: '💼 Vi har netop åbnet en stilling som Marketingkoordinator!\n\n• Erfaring med B2B digital marketing\n• Flydende dansk + engelsk\n• Fuldt remote-venlig stilling\n\nLæs mere og søg på: nordbot.eu/jobs 🔗',
      text_en: '💼 We have just opened a position as Marketing Coordinator!\n\n• Experience with B2B digital marketing\n• Fluent Danish + English\n• Fully remote-friendly position\n\nRead more and apply at: nordbot.eu/jobs 🔗',
      time_da: '5 timer siden', time_en: '5 hours ago', likes: 41,
    },
    {
      author_id: erikId,
      text_da: 'Rydder ud og sælger lidt af hvert på markedspladsen — iPhone, høretelefoner og et par gamle LEGO-sæt 📦 Kig forbi!',
      text_en: 'Clearing out and selling a bit of everything on the marketplace — iPhone, headphones and a couple of old LEGO sets 📦 Come take a look!',
      time_da: '6 timer siden', time_en: '6 hours ago', likes: 15,
    },
  ]
}

// ─── marketplace listings ─────────────────────────────────────────────────────
function makeMarketplaceListings(botIds) {
  const [annaId, erikId, mariaId, nordBotId] = botIds
  return [
    {
      user_id: annaId,
      title: 'Vintage cykeltaske i læder — smuk stand',
      price: '250',
      priceNegotiable: 1,
      category: 'Sport & Fritid',
      location: 'København NV',
      description: 'Smuk vintage cykeltaske i brunt læder. Købt på loppemarket i Berlin. Lille ridse på bunden, ellers perfekt stand. Passer til de fleste cykelstyr. Afhentes i KBH NV eller kan sendes for 39 kr.',
      mobilepay: '12345',
      contact_phone: null,
      contact_email: 'anna.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: erikId,
      title: 'iPhone 13 – 128 GB, sort, pæn stand',
      price: '2800',
      priceNegotiable: 1,
      category: 'Elektronik',
      location: 'Aarhus C',
      description: 'Sælger min iPhone 13 da jeg er opgraderet. 128 GB, sort. Ingen revner i skærmen, men har et par små ridser på bagsiden. Batteri = 89%. Sælges uden cover. Medfølger: original kasse og kabel.',
      mobilepay: '67890',
      contact_phone: '12345678',
      contact_email: 'erik.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: erikId,
      title: 'LEGO Technic 42083 Bugatti Chiron – komplet',
      price: '1200',
      priceNegotiable: 0,
      category: 'Legetøj & Spil',
      location: 'Aarhus C',
      description: 'Komplet LEGO Technic Bugatti Chiron (42083). Bygget én gang og stillet til pynt. Alle dele er der, inkl. instruktionsmanual. Original kasse medfølger men har slidtage.',
      mobilepay: '67890',
      contact_phone: null,
      contact_email: 'erik.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: mariaId,
      title: 'IKEA BILLY reoler × 3 – hvid, 80 cm',
      price: '600',
      priceNegotiable: 1,
      category: 'Møbler',
      location: 'Odense C',
      description: 'Tre IKEA BILLY reoler, hvide, 80 × 202 × 28 cm. Sælges samlet eller enkeltvis (250 kr/stk). Afhentes i Odense C — kan ikke leveres. Meget pæn stand, kun 2 år gamle.',
      mobilepay: null,
      contact_phone: '87654321',
      contact_email: 'maria.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: mariaId,
      title: 'Vintage sidebord i teak – 1960\'erne',
      price: '450',
      priceNegotiable: 1,
      category: 'Møbler',
      location: 'Odense SV',
      description: 'Flot vintage sidebord i massiv teak fra 1960\'erne. Pæne ben og en skuffe. Overfladen har lidt patina som man forventer af møbler fra den tid. Mål: 50 × 50 × 55 cm. Afhentes.',
      mobilepay: null,
      contact_phone: '87654321',
      contact_email: 'maria.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: nordBotId,
      title: 'MacBook Pro 14" M2 Pro – virksomhedssalg',
      price: '12500',
      priceNegotiable: 1,
      category: 'Elektronik',
      location: 'København K',
      description: 'MacBook Pro 14" med M2 Pro chip, 16 GB RAM, 512 GB SSD. Sælges ifm. hardware-opgradering. Fabriksindstillet og klar til brug. Medfølger: original oplader og kasse. Kvittering haves. Afhentes i KBH K eller sendes forsikret.',
      mobilepay: null,
      contact_phone: '11223344',
      contact_email: 'nordbot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: nordBotId,
      title: 'Sony WH-1000XM5 høretelefoner × 4 – brugte',
      price: '3200',
      priceNegotiable: 1,
      category: 'Elektronik',
      location: 'København K',
      description: 'Fire stk. Sony WH-1000XM5 noise-cancelling høretelefoner. Sælges samlet (800 kr/stk ved samlet køb). Brugt 6–12 måneder af vores medarbejdere. Alle virker perfekt, ladekabel og pose medfølger.',
      mobilepay: null,
      contact_phone: '11223344',
      contact_email: 'nordbot@fellis.eu',
      photos: JSON.stringify([]),
    },
    {
      user_id: annaId,
      title: 'Søger: retro kaffebord i mørkt træ',
      price: 'Byd',
      priceNegotiable: 1,
      category: 'Møbler',
      location: 'København',
      description: '🔍 Leder efter et retro/vintage kaffebord i mørkt træ (teak eller valnød). Max 80 cm langt. Budget ca. 300–600 kr. Skriv gerne hvis du har noget lignende til salg!',
      mobilepay: null,
      contact_phone: null,
      contact_email: 'anna.bot@fellis.eu',
      photos: JSON.stringify([]),
    },
  ]
}

async function seedBots() {
  const conn = await pool.getConnection()
  try {
    const botIds = []

    // ── Create bot users ──────────────────────────────────────────────────────
    for (const bot of BOTS) {
      const [result] = await conn.query(
        `INSERT INTO users (name, handle, initials, email, password_hash, bio_da, bio_en, location, join_date, photo_count, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), mode = VALUES(mode)`,
        [bot.name, bot.handle, bot.initials, bot.email, BOT_PASSWORD_HASH,
          bot.bio_da, bot.bio_en, bot.location, new Date().getFullYear().toString(), bot.mode]
      )
      let botId = result.insertId
      if (!botId) {
        const [rows] = await conn.query('SELECT id FROM users WHERE handle = ?', [bot.handle])
        botId = rows[0].id
      }
      botIds.push(botId)
      console.log(`Created bot: ${bot.name} (id=${botId}, mode=${bot.mode})`)
    }

    // ── Friendships with all existing users ───────────────────────────────────
    const [allUsers] = await conn.query('SELECT id FROM users WHERE id NOT IN (?)', [botIds])
    for (const botId of botIds) {
      for (const user of allUsers) {
        await conn.query(
          'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
          [botId, user.id, Math.floor(Math.random() * 20) + 5, true]
        )
        await conn.query(
          'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
          [user.id, botId, Math.floor(Math.random() * 20) + 5, true]
        )
      }
    }
    console.log('Bots are now friends with all users')

    // ── Bot posts ─────────────────────────────────────────────────────────────
    const botPostDefs = makeBotPosts(botIds)
    const botPostIds = []
    for (const p of botPostDefs) {
      const [result] = await conn.query(
        'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes) VALUES (?, ?, ?, ?, ?, ?)',
        [p.author_id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes]
      )
      botPostIds.push(result.insertId)
    }
    console.log(`Created ${botPostDefs.length} bot posts`)

    // ── Bots like & comment on existing user posts (up to 15) ─────────────────
    const [existingPosts] = await conn.query(
      'SELECT id, author_id FROM posts WHERE author_id NOT IN (?) ORDER BY created_at DESC LIMIT 15',
      [botIds]
    )

    let commentCount = 0
    let likeCount = 0
    for (let i = 0; i < existingPosts.length; i++) {
      const post = existingPosts[i]
      // Rotate bots — 1-2 bots comment per post, not all 4 every time
      const commentingBots = botIds.filter((_, idx) => (i + idx) % 3 !== 0).slice(0, 2)
      for (const botId of commentingBots) {
        const comment = POST_COMMENTS[(i * 3 + botId) % POST_COMMENTS.length]
        await conn.query(
          'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
          [post.id, botId, comment.text_da, comment.text_en]
        )
        commentCount++
      }
      // All bots like (IGNORE prevents duplicates)
      for (const botId of botIds) {
        const reaction = BOT_REACTIONS[Math.floor(Math.random() * BOT_REACTIONS.length)]
        try {
          await conn.query(
            'INSERT IGNORE INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)',
            [post.id, botId, reaction]
          )
        } catch {
          await conn.query(
            'INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)',
            [post.id, botId]
          )
        }
        await conn.query('UPDATE posts SET likes = likes + 1 WHERE id = ?', [post.id])
        likeCount++
      }
    }
    console.log(`Bots commented on ${commentCount} post(s), liked ${likeCount} post(s)`)

    // ── Bots also like each other's bot posts ─────────────────────────────────
    for (const postId of botPostIds) {
      for (const botId of botIds) {
        const reaction = BOT_REACTIONS[Math.floor(Math.random() * BOT_REACTIONS.length)]
        try {
          await conn.query(
            'INSERT IGNORE INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)',
            [postId, botId, reaction]
          )
        } catch {
          await conn.query(
            'INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)',
            [postId, botId]
          )
        }
      }
    }
    console.log('Bots liked each other\'s posts')

    // ── Marketplace listings ──────────────────────────────────────────────────
    const listings = makeMarketplaceListings(botIds)
    for (const l of listings) {
      await conn.query(
        `INSERT INTO marketplace_listings
           (user_id, title, price, priceNegotiable, category, location, description, mobilepay, contact_phone, contact_email, photos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.user_id, l.title, l.price, l.priceNegotiable, l.category, l.location,
          l.description, l.mobilepay, l.contact_phone, l.contact_email, l.photos]
      )
    }
    console.log(`Created ${listings.length} marketplace listings`)

    // ── Bot companies ─────────────────────────────────────────────────────────
    const [nordBotId2] = botIds.slice(3, 4) // NordBot ApS
    const [annaBotId] = botIds.slice(0, 1)

    const botCompanies = [
      {
        owner_id: nordBotId2,
        name: 'NordBot ApS',
        handle: '@nordbot-aps',
        tagline: 'Dansk tech — EU-fokuseret og privatliv-venlig',
        description: 'NordBot ApS bygger SaaS-løsninger til europæiske virksomheder med fokus på privatliv, bæredygtighed og åbne standarder. Grundlagt i 2024 og GDPR-first.',
        industry: 'Software & SaaS',
        size: '1–10',
        website: 'https://nordbot.eu',
        color: '#1877F2',
      },
      {
        owner_id: annaBotId,
        name: 'Anna Design Studio',
        handle: '@anna-design-studio',
        tagline: 'Kreativt design med et grønt hjerte 🌿',
        description: 'Freelance designstudie specialiseret i branding, illustrationer og digital grafik for små virksomheder og NGO\'er.',
        industry: 'Design & Kreativt',
        size: '1–10',
        website: 'https://anna-design.dk',
        color: '#2D6A4F',
      },
    ]

    const companyIds = []
    for (const c of botCompanies) {
      try {
        const [result] = await conn.query(
          `INSERT INTO companies (owner_id, name, handle, tagline, description, industry, size, website, color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [c.owner_id, c.name, c.handle, c.tagline, c.description, c.industry, c.size, c.website, c.color]
        )
        let companyId = result.insertId
        if (!companyId) {
          const [rows] = await conn.query('SELECT id FROM companies WHERE handle = ?', [c.handle])
          companyId = rows[0]?.id
        }
        if (companyId) {
          await conn.query(
            'INSERT IGNORE INTO company_members (company_id, user_id, role) VALUES (?, ?, ?)',
            [companyId, c.owner_id, 'owner']
          )
          companyIds.push({ id: companyId, ...c })
          console.log(`Created company: ${c.name} (id=${companyId})`)
        }
      } catch (err) {
        console.error(`Company seed error (${c.name}):`, err.message)
      }
    }

    // ── Bot company posts ─────────────────────────────────────────────────────
    if (companyIds.length > 0) {
      const nordBotCompany = companyIds.find(c => c.name === 'NordBot ApS')
      const annaCompany = companyIds.find(c => c.name === 'Anna Design Studio')

      const companyPosts = [
        nordBotCompany && {
          company_id: nordBotCompany.id,
          author_id: nordBotId2,
          text_da: '🚀 Vi er glade for at annoncere vores nye integrationsplatform til dansk offentlig sektor! GDPR-ready, open-source og hostet i EU. Kontakt os for en demo → nordbot.eu',
          text_en: '🚀 We are excited to announce our new integration platform for the Danish public sector! GDPR-ready, open-source and hosted in the EU. Contact us for a demo → nordbot.eu',
          likes: 34,
        },
        nordBotCompany && {
          company_id: nordBotCompany.id,
          author_id: nordBotId2,
          text_da: '📈 Q1 2026 — rekordvækst! Vi har onboardet 12 nye kunder og vores ARR er steget med 67%. Tak til hele teamet og vores fantastiske kunder 💚',
          text_en: '📈 Q1 2026 — record growth! We have onboarded 12 new customers and our ARR has grown by 67%. Thanks to the whole team and our amazing customers 💚',
          likes: 61,
        },
        annaCompany && {
          company_id: annaCompany.id,
          author_id: annaBotId,
          text_da: '🎨 Ny case study ude! Vi redesignede brandingidentiteten for BioNord — fra logo til hjemmeside. Se hele processen på anna-design.dk 🌿',
          text_en: '🎨 New case study out! We redesigned the brand identity for BioNord — from logo to website. See the full process at anna-design.dk 🌿',
          likes: 28,
        },
      ].filter(Boolean)

      for (const p of companyPosts) {
        await conn.query(
          'INSERT INTO company_posts (company_id, author_id, text_da, text_en, likes) VALUES (?, ?, ?, ?, ?)',
          [p.company_id, p.author_id, p.text_da, p.text_en, p.likes]
        )
      }
      console.log(`Created ${companyPosts.length} company posts`)

      // All bots follow NordBot ApS
      if (nordBotCompany) {
        for (const botId of botIds) {
          await conn.query(
            'INSERT IGNORE INTO company_follows (company_id, user_id) VALUES (?, ?)',
            [nordBotCompany.id, botId]
          )
        }
        // All real users also follow NordBot ApS
        for (const user of allUsers) {
          await conn.query(
            'INSERT IGNORE INTO company_follows (company_id, user_id) VALUES (?, ?)',
            [nordBotCompany.id, user.id]
          )
        }
        console.log('Users and bots now follow NordBot ApS')
      }

      // ── Jobs ────────────────────────────────────────────────────────────────
      if (nordBotCompany) {
        const jobs = [
          {
            company_id: nordBotCompany.id,
            title: 'Senior React-udvikler',
            location: 'København / Remote',
            remote: 1,
            type: 'fulltime',
            description: 'Vi søger en erfaren React-udvikler til at drive vores frontend-platform. Du vil samarbejde med et lille, passioneret team og have stor indflydelse på arkitektur og produktbeslutninger.',
            requirements: '4+ års erfaring med React og TypeScript\nKendskab til REST APIs og GraphQL\nErfaring med CI/CD og Docker er en fordel\nFlydende dansk eller engelsk',
            apply_link: 'jobs@nordbot.eu',
          },
          {
            company_id: nordBotCompany.id,
            title: 'Junior Marketingkoordinator',
            location: 'København K',
            remote: 0,
            type: 'fulltime',
            description: 'Bliv en del af vores voksende marketing-team. Du vil hjælpe med content, sociale medier og outreach til potentielle kunder i EU-markedet.',
            requirements: 'Erfaring med B2B digital marketing\nGode skriftlige kompetencer på dansk og engelsk\nFlair for data og analyser\nCandidatgrad eller tilsvarende erfaring',
            apply_link: 'jobs@nordbot.eu',
          },
          {
            company_id: nordBotCompany.id,
            title: 'Backend-ingeniør (Node.js)',
            location: 'Remote',
            remote: 1,
            type: 'fulltime',
            description: 'Vi udvider vores backend-team med en dygtig Node.js-ingeniør. Du vil arbejde på vores API-infrastruktur og integrationer mod offentlige registre og EU-datasystemer.',
            requirements: '3+ års erfaring med Node.js\nKendskab til MariaDB/MySQL\nErfaring med EU-compliance (GDPR) er et plus\nFlydende dansk',
            apply_link: 'jobs@nordbot.eu',
          },
        ]

        if (annaCompany) {
          jobs.push({
            company_id: annaCompany.id,
            title: 'Freelance Grafisk Designer',
            location: 'Remote',
            remote: 1,
            type: 'freelance',
            description: 'Anna Design Studio søger en freelance grafisk designer til sporadiske projekter. Vi arbejder primært med branding, print og digital grafik for bæredygtige virksomheder.',
            requirements: 'Solid portefølje inden for branding og grafisk design\nErfaring med Adobe Creative Suite og Figma\nForståelse for bæredygtigt design er et plus',
            apply_link: 'hej@anna-design.dk',
          })
        }

        for (const j of jobs) {
          await conn.query(
            `INSERT INTO jobs (company_id, title, location, remote, type, description, requirements, apply_link)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [j.company_id, j.title, j.location, j.remote, j.type, j.description, j.requirements, j.apply_link]
          )
        }
        console.log(`Created ${jobs.length} job listings`)
      }
    }

    console.log('\n✅ Bots seeded!')
    console.log('  anna.bot@fellis.eu / bot123')
    console.log('  erik.bot@fellis.eu / bot123')
    console.log('  maria.bot@fellis.eu / bot123')
    console.log('  nordbot@fellis.eu / bot123  (business mode)')
    console.log('To remove bots: node server/cleanup-bots.js')

  } finally {
    conn.release()
    await pool.end()
  }
}

seedBots().catch(err => { console.error('Bot seed failed:', err); process.exit(1) })
