import crypto from 'crypto'
import bcrypt from 'bcrypt'
import pool from './db.js'

// Same mock data from the frontend, now inserted into MySQL
const USERS = [
  { name: 'Sofie Nielsen', handle: '@sofie.nielsen', initials: 'SN', bio_da: 'Grafisk designer fra København. Elsker kaffe, kunst og lange gåture.', bio_en: 'Graphic designer from Copenhagen. Loves coffee, art and long walks.', location: 'København, Danmark', join_date: '2026', photo_count: 2341, email: 'sofie@fellis.eu' },
  { name: 'Magnus Jensen', handle: '@magnus.jensen', initials: 'MJ', bio_da: '', bio_en: '', location: 'Aarhus, Danmark', join_date: '2026', photo_count: 0, email: 'magnus@fellis.eu' },
  { name: 'Freja Andersen', handle: '@freja.andersen', initials: 'FA', bio_da: '', bio_en: '', location: 'Odense, Danmark', join_date: '2026', photo_count: 0, email: 'freja@fellis.eu' },
  { name: 'Emil Larsen', handle: '@emil.larsen', initials: 'EL', bio_da: '', bio_en: '', location: 'København, Danmark', join_date: '2026', photo_count: 0, email: 'emil@fellis.eu' },
  { name: 'Ida Pedersen', handle: '@ida.pedersen', initials: 'IP', bio_da: '', bio_en: '', location: 'Aalborg, Danmark', join_date: '2026', photo_count: 0, email: 'ida@fellis.eu' },
  { name: 'Oscar Christensen', handle: '@oscar.christensen', initials: 'OC', bio_da: '', bio_en: '', location: 'København, Danmark', join_date: '2026', photo_count: 0, email: 'oscar@fellis.eu' },
  { name: 'Alma Hansen', handle: '@alma.hansen', initials: 'AH', bio_da: '', bio_en: '', location: 'Roskilde, Danmark', join_date: '2026', photo_count: 0, email: 'alma@fellis.eu' },
  { name: 'Viktor Mortensen', handle: '@viktor.mortensen', initials: 'VM', bio_da: '', bio_en: '', location: 'Esbjerg, Danmark', join_date: '2026', photo_count: 0, email: 'viktor@fellis.eu' },
  { name: 'Clara Johansen', handle: '@clara.johansen', initials: 'CJ', bio_da: '', bio_en: '', location: 'København, Danmark', join_date: '2026', photo_count: 0, email: 'clara@fellis.eu' },
  { name: 'Noah Rasmussen', handle: '@noah.rasmussen', initials: 'NR', bio_da: '', bio_en: '', location: 'Helsingør, Danmark', join_date: '2026', photo_count: 0, email: 'noah@fellis.eu' },
  { name: 'Astrid Poulsen', handle: '@astrid.poulsen', initials: 'AP', bio_da: '', bio_en: '', location: 'Kolding, Danmark', join_date: '2026', photo_count: 0, email: 'astrid@fellis.eu' },
  { name: 'Liam Madsen', handle: '@liam.madsen', initials: 'LM', bio_da: '', bio_en: '', location: 'Vejle, Danmark', join_date: '2026', photo_count: 0, email: 'liam@fellis.eu' },
]

// Map user name -> id (filled after insert)
const userIdMap = {}

async function seed() {
  // Default password for all seed users (bcrypt, generated once)
  const DEFAULT_PASSWORD_HASH = await bcrypt.hash('password123', 10)
  const conn = await pool.getConnection()
  try {
    // Insert users
    for (const u of USERS) {
      const [result] = await conn.query(
        'INSERT INTO users (name, handle, initials, bio_da, bio_en, location, join_date, photo_count, email, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.email, DEFAULT_PASSWORD_HASH]
      )
      userIdMap[u.name] = result.insertId || result.affectedRows
    }

    // Re-fetch all user IDs
    const [users] = await conn.query('SELECT id, name FROM users')
    for (const u of users) userIdMap[u.name] = u.id

    const sofieId = userIdMap['Sofie Nielsen']

    // Friendships (Sofie is friends with everyone)
    const friendData = [
      { name: 'Magnus Jensen', mutual: 18, online: true },
      { name: 'Freja Andersen', mutual: 31, online: false },
      { name: 'Emil Larsen', mutual: 12, online: true },
      { name: 'Ida Pedersen', mutual: 27, online: false },
      { name: 'Oscar Christensen', mutual: 9, online: true },
      { name: 'Alma Hansen', mutual: 22, online: true },
      { name: 'Viktor Mortensen', mutual: 15, online: false },
      { name: 'Clara Johansen', mutual: 33, online: true },
      { name: 'Noah Rasmussen', mutual: 7, online: false },
      { name: 'Astrid Poulsen', mutual: 19, online: true },
      { name: 'Liam Madsen', mutual: 11, online: false },
    ]
    for (const f of friendData) {
      const friendId = userIdMap[f.name]
      await conn.query(
        'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
        [sofieId, friendId, f.mutual, f.online]
      )
      await conn.query(
        'INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count, is_online) VALUES (?, ?, ?, ?)',
        [friendId, sofieId, f.mutual, true]
      )
    }

    // Posts
    const postsData = [
      { author: 'Sofie Nielsen', text_da: 'Endelig er mit nye designprojekt færdigt! Så glad for at dele det med jer alle her på fellis.eu 🎨', text_en: 'Finally my new design project is done! So happy to share it with everyone here on fellis.eu 🎨', time_da: '2 timer siden', time_en: '2 hours ago', likes: 47 },
      { author: 'Magnus Jensen', text_da: 'Nogen der vil med til koncert i Vega i næste uge? Har en ekstra billet!', text_en: 'Anyone want to come to a concert at Vega next week? I have an extra ticket!', time_da: '4 timer siden', time_en: '4 hours ago', likes: 23 },
      { author: 'Freja Andersen', text_da: 'Smukkeste solnedgang over Nyhavn i dag. København, du er smuk! ☀️', text_en: 'Most beautiful sunset over Nyhavn today. Copenhagen, you are beautiful! ☀️', time_da: '6 timer siden', time_en: '6 hours ago', likes: 89 },
      { author: 'Alma Hansen', text_da: 'Lige færdig med at læse "Smilla\'s fornemmelse for sne" for tredje gang. Stadig lige så god! 📚 Nogen der har boganbefalinger?', text_en: 'Just finished reading "Smilla\'s Sense of Snow" for the third time. Still just as good! 📚 Anyone have book recommendations?', time_da: '8 timer siden', time_en: '8 hours ago', likes: 34 },
      { author: 'Clara Johansen', text_da: 'Ny opskrift testet: Rugbrødsburger med remoulade og sprøde løg. Dommen: 10/10 ville lave igen! 🍔', text_en: 'New recipe tested: Rye bread burger with remoulade and crispy onions. The verdict: 10/10 would make again! 🍔', time_da: '12 timer siden', time_en: '12 hours ago', likes: 56 },
      { author: 'Oscar Christensen', text_da: 'Første dag på den nye cykelrute langs kysten. 45 km og benene er færdige, men udsigten var det hele værd! 🚴‍♂️', text_en: 'First day on the new coastal bike route. 45 km and my legs are done, but the view was worth it! 🚴‍♂️', time_da: '1 dag siden', time_en: '1 day ago', likes: 41 },
      { author: 'Ida Pedersen', text_da: 'Så glad for at være skiftet væk fra de store techplatforme. Her på fellis.eu føles det som om mine data faktisk er mine! 💚', text_en: 'So happy to have switched away from the big tech platforms. Here on fellis.eu it feels like my data is actually mine! 💚', time_da: '1 dag siden', time_en: '1 day ago', likes: 112 },
    ]
    const postIdMap = {}
    for (let i = 0; i < postsData.length; i++) {
      const p = postsData[i]
      const [result] = await conn.query(
        'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, likes) VALUES (?, ?, ?, ?, ?, ?)',
        [userIdMap[p.author], p.text_da, p.text_en, p.time_da, p.time_en, p.likes]
      )
      postIdMap[i + 1] = result.insertId
    }

    // Comments
    const commentsData = [
      { postIdx: 1, author: 'Magnus Jensen', text_da: 'Det ser fantastisk ud! 🔥', text_en: 'Looks amazing! 🔥' },
      { postIdx: 1, author: 'Clara Johansen', text_da: 'Wow, du er så talentfuld!', text_en: 'Wow, you are so talented!' },
      { postIdx: 2, author: 'Emil Larsen', text_da: 'Ja tak! Hvem spiller?', text_en: 'Yes please! Who is playing?' },
      { postIdx: 2, author: 'Alma Hansen', text_da: 'Jeg er med! 🎵', text_en: "I'm in! 🎵" },
      { postIdx: 2, author: 'Oscar Christensen', text_da: 'Skriv mig op som reserve!', text_en: 'Put me down as backup!' },
      { postIdx: 3, author: 'Ida Pedersen', text_da: 'Savner København så meget!', text_en: 'Miss Copenhagen so much!' },
      { postIdx: 4, author: 'Viktor Mortensen', text_da: 'Prøv "Fasandræberne" af Jussi Adler-Olsen!', text_en: 'Try "The Pheasant Killers" by Jussi Adler-Olsen!' },
      { postIdx: 4, author: 'Astrid Poulsen', text_da: 'Elsker den bog! Prøv også Helle Helle.', text_en: 'Love that book! Also try Helle Helle.' },
      { postIdx: 5, author: 'Noah Rasmussen', text_da: 'Del venligst opskriften!', text_en: 'Please share the recipe!' },
      { postIdx: 5, author: 'Sofie Nielsen', text_da: 'Det lyder helt vildt godt!', text_en: 'That sounds absolutely amazing!' },
      { postIdx: 5, author: 'Liam Madsen', text_da: 'Rugbrød gør alt bedre 🙌', text_en: 'Rye bread makes everything better 🙌' },
      { postIdx: 6, author: 'Magnus Jensen', text_da: 'Stærkt! Hvilken rute?', text_en: 'Strong! Which route?' },
      { postIdx: 7, author: 'Freja Andersen', text_da: 'Enig! Bedste beslutning i år.', text_en: 'Agreed! Best decision this year.' },
      { postIdx: 7, author: 'Alma Hansen', text_da: 'Velkommen! Du vil elske det her ❤️', text_en: 'Welcome! You will love it here ❤️' },
      { postIdx: 7, author: 'Emil Larsen', text_da: '100% enig. EU-hostet og krypteret!', text_en: '100% agreed. EU-hosted and encrypted!' },
    ]
    for (const c of commentsData) {
      await conn.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
        [postIdMap[c.postIdx], userIdMap[c.author], c.text_da, c.text_en]
      )
    }

    // Messages
    const messagesData = [
      { from: 'Magnus Jensen', to: 'Sofie Nielsen', text_da: 'Hey! Skal vi mødes til kaffe i morgen?', text_en: 'Hey! Shall we meet for coffee tomorrow?', time: '14:23' },
      { from: 'Sofie Nielsen', to: 'Magnus Jensen', text_da: 'Ja, det lyder perfekt! Hvor?', text_en: 'Yes, that sounds perfect! Where?', time: '14:25' },
      { from: 'Magnus Jensen', to: 'Sofie Nielsen', text_da: 'Den nye café på Vesterbro? Kl 10?', text_en: 'The new café in Vesterbro? At 10?', time: '14:26' },
      { from: 'Sofie Nielsen', to: 'Magnus Jensen', text_da: 'Ses der! ☕', text_en: 'See you there! ☕', time: '14:27' },
      { from: 'Clara Johansen', to: 'Sofie Nielsen', text_da: 'Har du set den nye udstilling på Louisiana?', text_en: 'Have you seen the new exhibition at Louisiana?', time: '11:02' },
      { from: 'Sofie Nielsen', to: 'Clara Johansen', text_da: 'Nej, er den god?', text_en: 'No, is it good?', time: '11:15' },
      { from: 'Clara Johansen', to: 'Sofie Nielsen', text_da: 'Den er fantastisk! Vi skal derhen sammen!', text_en: "It's amazing! We should go together!", time: '11:16' },
      { from: 'Emil Larsen', to: 'Sofie Nielsen', text_da: 'Tillykke med det nye projekt! 🎉', text_en: 'Congrats on the new project! 🎉', time: '09:45' },
      { from: 'Sofie Nielsen', to: 'Emil Larsen', text_da: 'Tak! Det har været et langt forløb.', text_en: 'Thanks! It has been a long process.', time: '09:50' },
      { from: 'Alma Hansen', to: 'Sofie Nielsen', text_da: 'Kan du anbefale en god podcast?', text_en: 'Can you recommend a good podcast?', time: '23:00' },
    ]
    for (const m of messagesData) {
      await conn.query(
        'INSERT INTO messages (sender_id, receiver_id, text_da, text_en, time) VALUES (?, ?, ?, ?, ?)',
        [userIdMap[m.from], userIdMap[m.to], m.text_da, m.text_en, m.time]
      )
    }

    console.log('Seed complete! All mock data inserted.')
    console.log('Default login: sofie@fellis.eu / password123')

    // Demo ads (active, valid through 2027)
    const adRows = [
      { title: 'Prøv fellis Premium', body: 'Oplev platformen reklamefri fra kun €2,99/md.', target_url: 'https://fellis.eu', placement: 'feed' },
      { title: 'Danish Design Co.', body: 'Håndlavede møbler fra Aarhus. Besøg os i dag!', target_url: 'https://fellis.eu', placement: 'feed' },
      { title: 'Nordisk Kafferisteri', body: 'Friskristet specialkaffe leveret til din dør.', target_url: 'https://fellis.eu', placement: 'sidebar' },
      { title: 'FellisPro for erhverv', body: 'Styrk dit brand med annoncering på fellis.eu.', target_url: 'https://fellis.eu', placement: 'stories' },
    ]
    for (const ad of adRows) {
      await conn.query(
        `INSERT IGNORE INTO ads (advertiser_id, title, body, target_url, placement, status, start_date, end_date, cpm_rate)
         VALUES (?, ?, ?, ?, ?, 'active', '2026-01-01', '2027-12-31', 50)`,
        [sofieId, ad.title, ad.body, ad.target_url, ad.placement]
      )
    }

    // Marketplace listings
    const listingRows = [
      { seller: 'Sofie Nielsen',      title: 'Vintage Arne Jacobsen stol',      price: '1200', category: 'furniture',   location: 'København',  description: 'Original 7-er stol i fin stand. Afhentes i Vesterbro.' },
      { seller: 'Magnus Jensen',      title: 'MacBook Air M2 (2023)',           price: '850',  category: 'electronics', location: 'Aarhus',     description: '13" MacBook Air, 256GB, 8GB RAM. Som ny, inkl. oplader.' },
      { seller: 'Freja Andersen',     title: 'Cykel – Raleigh dame',            price: '150',  category: 'vehicles',    location: 'Odense',     description: '7 gear, lige serviceret, nye dæk.' },
      { seller: 'Alma Hansen',        title: 'Samling af krimier (15 bøger)',   price: '80',   category: 'books',       location: 'Roskilde',   description: 'Blandet samling af danske og nordiske krimier.' },
      { seller: 'Clara Johansen',     title: 'Løbesko Nike str. 40',            price: '45',   category: 'sports',      location: 'København',  description: 'Brugt et par gange, passer ikke. Nypris 120€.' },
      { seller: 'Oscar Christensen',  title: 'Plantekrukker i terracotta (5)',  price: '30',   category: 'garden',      location: 'København',  description: 'Fem store krukker i fin stand. Samlet pris.' },
    ]
    for (const l of listingRows) {
      await conn.query(
        `INSERT INTO marketplace_listings (user_id, title, price, category, location, description) VALUES (?, ?, ?, ?, ?, ?)`,
        [userIdMap[l.seller], l.title, l.price, l.category, l.location, l.description]
      )
    }
  } finally {
    conn.release()
    await pool.end()
  }
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1) })
