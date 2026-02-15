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

// Current user
export const CURRENT_USER = {
  name: 'Sofie Nielsen',
  handle: '@sofie.nielsen',
  initials: 'SN',
  bio: { da: 'Grafisk designer fra København. Elsker kaffe, kunst og lange gåture.', en: 'Graphic designer from Copenhagen. Loves coffee, art and long walks.' },
  location: 'København, Danmark',
  joinDate: '2026-01-15T10:30:00.000Z',
  friendCount: 312,
  postCount: 847,
  photoCount: 2341,
}

// Friends
export const FRIENDS = [
  { name: 'Sofie Nielsen', mutual: 24, online: true },
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

// Feed posts
export const POSTS = [
  {
    id: 1,
    author: 'Sofie Nielsen',
    time: { da: '2 timer siden', en: '2 hours ago' },
    text: { da: 'Endelig er mit nye designprojekt færdigt! Så glad for at dele det med jer alle her på fellis.eu 🎨', en: 'Finally my new design project is done! So happy to share it with everyone here on fellis.eu 🎨' },
    likes: 47,
    comments: [
      { author: 'Magnus Jensen', text: { da: 'Det ser fantastisk ud! 🔥', en: 'Looks amazing! 🔥' } },
      { author: 'Clara Johansen', text: { da: 'Wow, du er så talentfuld!', en: 'Wow, you are so talented!' } },
    ],
  },
  {
    id: 2,
    author: 'Magnus Jensen',
    time: { da: '4 timer siden', en: '4 hours ago' },
    text: { da: 'Nogen der vil med til koncert i Vega i næste uge? Har en ekstra billet!', en: 'Anyone want to come to a concert at Vega next week? I have an extra ticket!' },
    likes: 23,
    comments: [
      { author: 'Emil Larsen', text: { da: 'Ja tak! Hvem spiller?', en: 'Yes please! Who is playing?' } },
      { author: 'Alma Hansen', text: { da: 'Jeg er med! 🎵', en: "I'm in! 🎵" } },
      { author: 'Oscar Christensen', text: { da: 'Skriv mig op som reserve!', en: 'Put me down as backup!' } },
    ],
  },
  {
    id: 3,
    author: 'Freja Andersen',
    time: { da: '6 timer siden', en: '6 hours ago' },
    text: { da: 'Smukkeste solnedgang over Nyhavn i dag. København, du er smuk! ☀️', en: 'Most beautiful sunset over Nyhavn today. Copenhagen, you are beautiful! ☀️' },
    likes: 89,
    comments: [
      { author: 'Ida Pedersen', text: { da: 'Savner København så meget!', en: 'Miss Copenhagen so much!' } },
    ],
  },
  {
    id: 4,
    author: 'Alma Hansen',
    time: { da: '8 timer siden', en: '8 hours ago' },
    text: { da: 'Lige færdig med at læse "Smilla\'s fornemmelse for sne" for tredje gang. Stadig lige så god! 📚 Nogen der har boganbefalinger?', en: 'Just finished reading "Smilla\'s Sense of Snow" for the third time. Still just as good! 📚 Anyone have book recommendations?' },
    likes: 34,
    comments: [
      { author: 'Viktor Mortensen', text: { da: 'Prøv "Fasandræberne" af Jussi Adler-Olsen!', en: 'Try "The Pheasant Killers" by Jussi Adler-Olsen!' } },
      { author: 'Astrid Poulsen', text: { da: 'Elsker den bog! Prøv også Helle Helle.', en: 'Love that book! Also try Helle Helle.' } },
    ],
  },
  {
    id: 5,
    author: 'Clara Johansen',
    time: { da: '12 timer siden', en: '12 hours ago' },
    text: { da: 'Ny opskrift testet: Rugbrødsburger med remoulade og sprøde løg. Dommen: 10/10 ville lave igen! 🍔', en: 'New recipe tested: Rye bread burger with remoulade and crispy onions. The verdict: 10/10 would make again! 🍔' },
    likes: 56,
    comments: [
      { author: 'Noah Rasmussen', text: { da: 'Del venligst opskriften!', en: 'Please share the recipe!' } },
      { author: 'Sofie Nielsen', text: { da: 'Det lyder helt vildt godt!', en: 'That sounds absolutely amazing!' } },
      { author: 'Liam Madsen', text: { da: 'Rugbrød gør alt bedre 🙌', en: 'Rye bread makes everything better 🙌' } },
    ],
  },
  {
    id: 6,
    author: 'Oscar Christensen',
    time: { da: '1 dag siden', en: '1 day ago' },
    text: { da: 'Første dag på den nye cykelrute langs kysten. 45 km og benene er færdige, men udsigten var det hele værd! 🚴‍♂️', en: 'First day on the new coastal bike route. 45 km and my legs are done, but the view was worth it! 🚴‍♂️' },
    likes: 41,
    comments: [
      { author: 'Magnus Jensen', text: { da: 'Stærkt! Hvilken rute?', en: 'Strong! Which route?' } },
    ],
  },
  {
    id: 7,
    author: 'Ida Pedersen',
    time: { da: '1 dag siden', en: '1 day ago' },
    text: { da: 'Så glad for at være skiftet væk fra de store techplatforme. Her på fellis.eu føles det som om mine data faktisk er mine! 💚', en: 'So happy to have switched away from the big tech platforms. Here on fellis.eu it feels like my data is actually mine! 💚' },
    likes: 112,
    comments: [
      { author: 'Freja Andersen', text: { da: 'Enig! Bedste beslutning i år.', en: 'Agreed! Best decision this year.' } },
      { author: 'Alma Hansen', text: { da: 'Velkommen! Du vil elske det her ❤️', en: 'Welcome! You will love it here ❤️' } },
      { author: 'Emil Larsen', text: { da: '100% enig. EU-hostet og krypteret!', en: '100% agreed. EU-hosted and encrypted!' } },
    ],
  },
]

// Platform translations
export const PT = {
  da: {
    feed: 'Feed',
    profile: 'Profil',
    friends: 'Venner',
    messages: 'Beskeder',
    navBrand: 'fellis.eu',
    langToggle: 'EN',
    newPost: 'Hvad har du på hjerte?',
    post: 'Opslå',
    like: 'Synes godt om',
    comment: 'Kommentar',
    share: 'Del',
    writeComment: 'Skriv en kommentar...',
    send: 'Send',
    friendsTitle: 'Dine venner',
    online: 'Online',
    offline: 'Offline',
    mutualFriends: 'fælles venner',
    message: 'Besked',
    editProfile: 'Rediger profil',
    joined: 'Medlem siden',
    postsLabel: 'Opslag',
    photosLabel: 'Fotos',
    friendsLabel: 'Venner',
    messagesTitle: 'Beskeder',
    typeMessage: 'Skriv en besked...',
    noMessages: 'Vælg en samtale for at starte',
    allFriends: 'Alle venner',
    onlineFriends: 'Online',
    searchFriends: 'Søg venner...',
    backToLanding: 'Tilbage til landing',
  },
  en: {
    feed: 'Feed',
    profile: 'Profile',
    friends: 'Friends',
    messages: 'Messages',
    navBrand: 'fellis.eu',
    langToggle: 'DA',
    newPost: "What's on your mind?",
    post: 'Post',
    like: 'Like',
    comment: 'Comment',
    share: 'Share',
    writeComment: 'Write a comment...',
    send: 'Send',
    friendsTitle: 'Your friends',
    online: 'Online',
    offline: 'Offline',
    mutualFriends: 'mutual friends',
    message: 'Message',
    editProfile: 'Edit profile',
    joined: 'Member since',
    postsLabel: 'Posts',
    photosLabel: 'Photos',
    friendsLabel: 'Friends',
    messagesTitle: 'Messages',
    typeMessage: 'Type a message...',
    noMessages: 'Select a conversation to start',
    allFriends: 'All friends',
    onlineFriends: 'Online',
    searchFriends: 'Search friends...',
    backToLanding: 'Back to landing',
  },
}

// Fake message threads
export const MESSAGE_THREADS = [
  {
    friend: 'Magnus Jensen',
    messages: [
      { from: 'Magnus Jensen', text: { da: 'Hey! Skal vi mødes til kaffe i morgen?', en: 'Hey! Shall we meet for coffee tomorrow?' }, time: '14:23' },
      { from: 'Sofie Nielsen', text: { da: 'Ja, det lyder perfekt! Hvor?', en: 'Yes, that sounds perfect! Where?' }, time: '14:25' },
      { from: 'Magnus Jensen', text: { da: 'Den nye café på Vesterbro? Kl 10?', en: 'The new café in Vesterbro? At 10?' }, time: '14:26' },
      { from: 'Sofie Nielsen', text: { da: 'Ses der! ☕', en: 'See you there! ☕' }, time: '14:27' },
    ],
    unread: 0,
  },
  {
    friend: 'Clara Johansen',
    messages: [
      { from: 'Clara Johansen', text: { da: 'Har du set den nye udstilling på Louisiana?', en: 'Have you seen the new exhibition at Louisiana?' }, time: '11:02' },
      { from: 'Sofie Nielsen', text: { da: 'Nej, er den god?', en: "No, is it good?" }, time: '11:15' },
      { from: 'Clara Johansen', text: { da: 'Den er fantastisk! Vi skal derhen sammen!', en: "It's amazing! We should go together!" }, time: '11:16' },
    ],
    unread: 1,
  },
  {
    friend: 'Emil Larsen',
    messages: [
      { from: 'Emil Larsen', text: { da: 'Tillykke med det nye projekt! 🎉', en: 'Congrats on the new project! 🎉' }, time: '09:45' },
      { from: 'Sofie Nielsen', text: { da: 'Tak! Det har været et langt forløb.', en: 'Thanks! It has been a long process.' }, time: '09:50' },
    ],
    unread: 0,
  },
  {
    friend: 'Alma Hansen',
    messages: [
      { from: 'Alma Hansen', text: { da: 'Kan du anbefale en god podcast?', en: 'Can you recommend a good podcast?' }, time: 'I går' },
    ],
    unread: 1,
  },
]
