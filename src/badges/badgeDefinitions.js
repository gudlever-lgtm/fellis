/**
 * Badge definitions for the Fellis badge reward system.
 *
 * Each badge: { id, name, description, tier, category, icon, evaluate(userStats) }
 *
 * tier:     1=bronze, 2=silver, 3=gold, 0=easter_egg (no tier color — secret style)
 * category: 'activity' | 'social' | 'profile' | 'special' | 'easter_egg'
 * evaluate: pure function(userStats) → boolean  (no side effects)
 *
 * Adding a new badge = add one entry here. Nothing else.
 *
 * userStats shape (all fields optional — evaluate must handle missing gracefully):
 * {
 *   accountCreatedAt,          // ISO string
 *   platformLaunchDate,        // ISO string
 *   postCount,
 *   commentCount,
 *   likesReceived,
 *   likesSentCount,
 *   followingCount,
 *   followerCount,
 *   mutualFollowCount,
 *   profilesVisited,
 *   loginStreakDays,
 *   totalLoginDays,
 *   postsWithTenPlusLikes,
 *   commentsWithLikes,
 *   maxLikesOnSinglePost,
 *   activeMonths,
 *   followersJoinedWithinFirstWeek,
 *   shareCount,
 *   profileComplete,           // boolean
 *   earnedBadgeIds,            // string[] — populated by the engine for cross-badge checks
 *   easterEggs: {
 *     discovered: string[],    // egg IDs (e.g. ['chuck','matrix'])
 *     activationCounts: {},    // eggId -> number
 *     firstDiscoveredAt: {},   // eggId -> ISO timestamp
 *   }
 * }
 */

export const PLATFORM_LAUNCH_DATE = '2024-01-01T00:00:00.000Z'

// Used by t3_legend evaluate()
const ALL_T1_IDS = [
  't1_first_steps', 't1_say_hello', 't1_welcomed', 't1_profile_complete',
  't1_early_bird', 't1_connected', 't1_follower', 't1_curious', 't1_sharer', 't1_comeback',
]
const ALL_T2_IDS = [
  't2_regular', 't2_conversationalist', 't2_popular', 't2_social_butterfly',
  't2_influencer', 't2_explorer', 't2_dedicated', 't2_appreciated', 't2_networker', 't2_contributor',
]

export const BADGES = [
  // ── Tier 1 — Beginner (bronze) ───────────────────────────────────────────────
  {
    id: 't1_first_steps',
    name: { da: 'Første skridt', en: 'First Steps' },
    description: { da: 'Publicer dit første opslag', en: 'Post your first update' },
    tier: 1, category: 'activity', icon: '🥉',
    evaluate: s => (s.postCount || 0) >= 1,
  },
  {
    id: 't1_say_hello',
    name: { da: 'Sig hej', en: 'Say Hello' },
    description: { da: 'Skriv din første kommentar', en: 'Leave your first comment' },
    tier: 1, category: 'activity', icon: '💬',
    evaluate: s => (s.commentCount || 0) >= 1,
  },
  {
    id: 't1_welcomed',
    name: { da: 'Budt velkommen', en: 'Welcomed' },
    description: { da: 'Modtag din første reaktion', en: 'Receive your first like/reaction' },
    tier: 1, category: 'social', icon: '❤️',
    evaluate: s => (s.likesReceived || 0) >= 1,
  },
  {
    id: 't1_profile_complete',
    name: { da: 'Komplet profil', en: 'Profile Complete' },
    description: { da: 'Udfyld alle profilfelter', en: 'Fill in all profile fields' },
    tier: 1, category: 'profile', icon: '✅',
    evaluate: s => s.profileComplete === true,
  },
  {
    id: 't1_early_bird',
    name: { da: 'Tidlig fugl', en: 'Early Bird' },
    description: { da: 'Opret konto inden for de første 30 dage af platformens lancering', en: 'Create account within the first 30 days of platform launch' },
    tier: 1, category: 'special', icon: '🐦',
    evaluate: s => {
      if (!s.accountCreatedAt || !s.platformLaunchDate) return false
      const ms = new Date(s.accountCreatedAt) - new Date(s.platformLaunchDate)
      return ms >= 0 && ms <= 30 * 24 * 60 * 60 * 1000
    },
  },
  {
    id: 't1_connected',
    name: { da: 'Forbundet', en: 'Connected' },
    description: { da: 'Tilføj din første ven', en: 'Follow your first user' },
    tier: 1, category: 'social', icon: '🔗',
    evaluate: s => (s.followingCount || 0) >= 1,
  },
  {
    id: 't1_follower',
    name: { da: 'Første ven', en: 'Follower' },
    description: { da: 'Få din første ven', en: 'Get your first follower' },
    tier: 1, category: 'social', icon: '👥',
    evaluate: s => (s.followerCount || 0) >= 1,
  },
  {
    id: 't1_curious',
    name: { da: 'Nysgerrig', en: 'Curious' },
    description: { da: 'Besøg 10 forskellige brugerprofiler', en: 'Visit 10 different user profiles' },
    tier: 1, category: 'activity', icon: '🔍',
    evaluate: s => (s.profilesVisited || 0) >= 10,
  },
  {
    id: 't1_sharer',
    name: { da: 'Deler', en: 'Sharer' },
    description: { da: 'Del dit første opslag', en: 'Share your first post' },
    tier: 1, category: 'activity', icon: '📤',
    evaluate: s => (s.shareCount || 0) >= 1,
  },
  {
    id: 't1_comeback',
    name: { da: 'Genkomst', en: 'Comeback' },
    description: { da: 'Log ind 7 dage i træk', en: 'Log in 7 days in a row' },
    tier: 1, category: 'activity', icon: '🔄',
    evaluate: s => (s.loginStreakDays || 0) >= 7,
  },

  // ── Tier 2 — Engaged (silver) ────────────────────────────────────────────────
  {
    id: 't2_regular',
    name: { da: 'Fast bruger', en: 'Regular' },
    description: { da: 'Publicer 25 opslag', en: 'Post 25 updates' },
    tier: 2, category: 'activity', icon: '🥈',
    evaluate: s => (s.postCount || 0) >= 25,
  },
  {
    id: 't2_conversationalist',
    name: { da: 'Samtalepartner', en: 'Conversationalist' },
    description: { da: 'Skriv 50 kommentarer', en: 'Leave 50 comments' },
    tier: 2, category: 'activity', icon: '🗨️',
    evaluate: s => (s.commentCount || 0) >= 50,
  },
  {
    id: 't2_popular',
    name: { da: 'Populær', en: 'Popular' },
    description: { da: 'Modtag 50 reaktioner i alt', en: 'Receive 50 likes/reactions total' },
    tier: 2, category: 'social', icon: '⭐',
    evaluate: s => (s.likesReceived || 0) >= 50,
  },
  {
    id: 't2_social_butterfly',
    name: { da: 'Social sommerfugl', en: 'Social Butterfly' },
    description: { da: 'Tilføj 25 venner', en: 'Follow 25 users' },
    tier: 2, category: 'social', icon: '🦋',
    evaluate: s => (s.followingCount || 0) >= 25,
  },
  {
    id: 't2_influencer',
    name: { da: 'Influencer', en: 'Influencer' },
    description: { da: 'Få 25 venner', en: 'Get 25 followers' },
    tier: 2, category: 'social', icon: '📢',
    evaluate: s => (s.followerCount || 0) >= 25,
  },
  {
    id: 't2_explorer',
    name: { da: 'Opdagelsesrejsende', en: 'Explorer' },
    description: { da: 'Besøg 50 forskellige brugerprofiler', en: 'Visit 50 different user profiles' },
    tier: 2, category: 'activity', icon: '🧭',
    evaluate: s => (s.profilesVisited || 0) >= 50,
  },
  {
    id: 't2_dedicated',
    name: { da: 'Dedikeret', en: 'Dedicated' },
    description: { da: 'Log ind 30 dage i træk', en: 'Log in 30 days in a row' },
    tier: 2, category: 'activity', icon: '📅',
    evaluate: s => (s.loginStreakDays || 0) >= 30,
  },
  {
    id: 't2_appreciated',
    name: { da: 'Værdsat', en: 'Appreciated' },
    description: { da: 'Et opslag modtager 10 likes', en: 'Have a post receive 10 likes' },
    tier: 2, category: 'social', icon: '💫',
    evaluate: s => (s.postsWithTenPlusLikes || 0) >= 1,
  },
  {
    id: 't2_networker',
    name: { da: 'Netværker', en: 'Networker' },
    description: { da: 'Bliv venner med en du har tilføjet', en: 'Get followed back by someone you follow' },
    tier: 2, category: 'social', icon: '🤝',
    evaluate: s => (s.mutualFollowCount || 0) >= 1,
  },
  {
    id: 't2_contributor',
    name: { da: 'Bidragsyder', en: 'Contributor' },
    description: { da: '5 af dine kommentarer har fået mindst ét like', en: 'Have 5 comments receive at least one like each' },
    tier: 2, category: 'activity', icon: '✍️',
    evaluate: s => (s.commentsWithLikes || 0) >= 5,
  },

  // ── Tier 3 — Expert (gold) ───────────────────────────────────────────────────
  {
    id: 't3_veteran',
    name: { da: 'Veteran', en: 'Veteran' },
    description: { da: 'Kontoen er 1 år gammel', en: 'Account is 1 year old' },
    tier: 3, category: 'special', icon: '🥇',
    evaluate: s => {
      if (!s.accountCreatedAt) return false
      return (Date.now() - new Date(s.accountCreatedAt).getTime()) >= 365 * 24 * 60 * 60 * 1000
    },
  },
  {
    id: 't3_prolific',
    name: { da: 'Produktiv', en: 'Prolific' },
    description: { da: 'Publicer 100 opslag', en: 'Post 100 updates' },
    tier: 3, category: 'activity', icon: '📝',
    evaluate: s => (s.postCount || 0) >= 100,
  },
  {
    id: 't3_voice',
    name: { da: 'Stemme', en: 'Voice' },
    description: { da: 'Skriv 200 kommentarer', en: 'Leave 200 comments' },
    tier: 3, category: 'activity', icon: '🎙️',
    evaluate: s => (s.commentCount || 0) >= 200,
  },
  {
    id: 't3_beloved',
    name: { da: 'Elsket', en: 'Beloved' },
    description: { da: 'Modtag 500 reaktioner i alt', en: 'Receive 500 likes/reactions total' },
    tier: 3, category: 'social', icon: '💝',
    evaluate: s => (s.likesReceived || 0) >= 500,
  },
  {
    id: 't3_trendsetter',
    name: { da: 'Trendsætter', en: 'Trendsetter' },
    description: { da: 'Få 100 venner', en: 'Get 100 followers' },
    tier: 3, category: 'social', icon: '🌊',
    evaluate: s => (s.followerCount || 0) >= 100,
  },
  {
    id: 't3_mentor',
    name: { da: 'Mentor', en: 'Mentor' },
    description: { da: 'Bliv venner med 5 brugere der tilmeldte sig inden for den første uge', en: 'Be followed by 5 users who joined within their first week' },
    tier: 3, category: 'social', icon: '🏫',
    evaluate: s => (s.followersJoinedWithinFirstWeek || 0) >= 5,
  },
  {
    id: 't3_streak_master',
    name: { da: 'Streak-mester', en: 'Streak Master' },
    description: { da: 'Log ind 100 dage i træk', en: 'Log in 100 days in a row' },
    tier: 3, category: 'activity', icon: '🔥',
    evaluate: s => (s.loginStreakDays || 0) >= 100,
  },
  {
    id: 't3_viral',
    name: { da: 'Viral', en: 'Viral' },
    description: { da: 'Et enkelt opslag modtager 50 likes', en: 'Have a single post receive 50 likes' },
    tier: 3, category: 'social', icon: '📣',
    evaluate: s => (s.maxLikesOnSinglePost || 0) >= 50,
  },
  {
    id: 't3_community_pillar',
    name: { da: 'Søjle i fællesskabet', en: 'Community Pillar' },
    description: { da: 'Aktiv (mindst 1 opslag eller kommentar) hver måned i 6 måneder', en: 'Active (at least 1 post or comment) every month for 6 months' },
    tier: 3, category: 'activity', icon: '🏛️',
    evaluate: s => (s.activeMonths || 0) >= 6,
  },
  {
    id: 't3_legend',
    name: { da: 'Legende', en: 'Legend' },
    description: { da: 'Hold alle Tier 1 og Tier 2 badges samtidigt', en: 'Hold all Tier 1 and Tier 2 badges simultaneously' },
    tier: 3, category: 'special', icon: '👑',
    evaluate: s => {
      const earned = new Set(s.earnedBadgeIds || [])
      return ALL_T1_IDS.every(id => earned.has(id)) && ALL_T2_IDS.every(id => earned.has(id))
    },
  },

  // ── Easter Egg Badges (tier 0 — secret style) ────────────────────────────────
  {
    id: 'egg_rule_breaker',
    name: { da: 'Regelbryder', en: 'Rule Breaker' },
    description: { da: 'Opdagede Konami-kode påskeægget', en: 'Discovered the Konami code easter egg' },
    tier: 0, category: 'easter_egg', icon: '🕹️',
    evaluate: s => (s.easterEggs?.discovered || []).includes('chuck'),
  },
  {
    id: 'egg_into_the_matrix',
    name: { da: 'Ind i Matrix', en: 'Into the Matrix' },
    description: { da: 'Opdagede Matrix Rain påskeægget', en: 'Discovered the Matrix Rain easter egg' },
    tier: 0, category: 'easter_egg', icon: '🟩',
    evaluate: s => (s.easterEggs?.discovered || []).includes('matrix'),
  },
  {
    id: 'egg_upside_down',
    name: { da: 'På hovedet', en: 'Upside Down' },
    description: { da: 'Opdagede Flip Feed påskeægget', en: 'Discovered the Flip Feed easter egg' },
    tier: 0, category: 'easter_egg', icon: '🙃',
    evaluate: s => (s.easterEggs?.discovered || []).includes('flip'),
  },
  {
    id: 'egg_old_school',
    name: { da: 'Den gamle skole', en: 'Old School' },
    description: { da: 'Opdagede Retro Mode påskeægget', en: 'Discovered the Retro Mode easter egg' },
    tier: 0, category: 'easter_egg', icon: '📺',
    evaluate: s => (s.easterEggs?.discovered || []).includes('retro'),
  },
  {
    id: 'egg_what_goes_up',
    name: { da: 'Det der går op...', en: 'What Goes Up' },
    description: { da: 'Opdagede Gravity påskeægget', en: 'Discovered the Gravity easter egg' },
    tier: 0, category: 'easter_egg', icon: '🪂',
    evaluate: s => (s.easterEggs?.discovered || []).includes('gravity'),
  },
  {
    id: 'egg_party_animal',
    name: { da: 'Festabe', en: 'Party Animal' },
    description: { da: 'Opdagede Party Mode påskeægget', en: 'Discovered the Party Mode easter egg' },
    tier: 0, category: 'easter_egg', icon: '🎉',
    evaluate: s => (s.easterEggs?.discovered || []).includes('party'),
  },
  {
    id: 'egg_never_gonna',
    name: { da: 'Never Gonna...', en: 'Never Gonna...' },
    description: { da: 'Opdagede Rick Roll påskeægget', en: 'Discovered the Rick Roll easter egg' },
    tier: 0, category: 'easter_egg', icon: '🎵',
    evaluate: s => (s.easterEggs?.discovered || []).includes('rickroll'),
  },
  {
    id: 'egg_shadow_watcher',
    name: { da: 'Skyggefølger', en: 'Shadow Watcher' },
    description: { da: 'Opdagede Profil-kigger påskeægget', en: 'Discovered the Profile Watcher easter egg' },
    tier: 0, category: 'easter_egg', icon: '👀',
    evaluate: s => (s.easterEggs?.discovered || []).includes('watcher'),
  },
  {
    id: 'egg_riddler',
    name: { da: 'The Riddler', en: 'The Riddler' },
    description: { da: 'Opdagede Riddler påskeægget', en: 'Discovered the Riddler easter egg' },
    tier: 0, category: 'easter_egg', icon: '❓',
    evaluate: s => (s.easterEggs?.discovered || []).includes('riddler'),
  },
  {
    id: 'egg_egg_hunter',
    name: { da: 'Ægsjæger', en: 'Egg Hunter' },
    description: { da: 'Opdagede 3 påskeæg', en: 'Discovered 3 easter eggs' },
    tier: 0, category: 'easter_egg', icon: '🥚',
    evaluate: s => (s.easterEggs?.discovered || []).length >= 3,
  },
  {
    id: 'egg_egg_master',
    name: { da: 'Ægsmester', en: 'Egg Master' },
    description: { da: 'Opdagede alle 9 påskeæg', en: 'Discovered all 9 easter eggs' },
    tier: 0, category: 'easter_egg', icon: '🐣',
    evaluate: s => (s.easterEggs?.discovered || []).length >= 9,
  },
  {
    id: 'egg_speedrunner',
    name: { da: 'Speedrunner', en: 'Speedrunner' },
    description: { da: 'Opdagede alle 9 påskeæg inden for 7 dage af kontoopretholdelse', en: 'Discover all 9 easter eggs within 7 days of account creation' },
    tier: 0, category: 'easter_egg', icon: '⚡',
    evaluate: s => {
      const disc = s.easterEggs?.discovered || []
      if (disc.length < 9 || !s.accountCreatedAt) return false
      const ts = s.easterEggs?.firstDiscoveredAt || {}
      const times = Object.values(ts).map(t => new Date(t).getTime()).filter(Boolean)
      if (!times.length) return false
      const maxTs = Math.max(...times)
      return (maxTs - new Date(s.accountCreatedAt).getTime()) <= 7 * 24 * 60 * 60 * 1000
    },
  },
  {
    id: 'egg_obsessed',
    name: { da: 'Besat', en: 'Obsessed' },
    description: { da: 'Aktiver ét enkelt påskeæg 10 gange', en: 'Trigger any single easter egg 10 times' },
    tier: 0, category: 'easter_egg', icon: '😵',
    evaluate: s => {
      const counts = s.easterEggs?.activationCounts || {}
      return Object.values(counts).some(c => (c || 0) >= 10)
    },
  },
  {
    id: 'egg_day_one',
    name: { da: 'Dag ét', en: 'Day One' },
    description: { da: 'Opdag et påskeæg inden for 24 timer efter kontoopretholdelse', en: 'Discover any easter egg within 24 hours of account creation' },
    tier: 0, category: 'easter_egg', icon: '🌅',
    evaluate: s => {
      const ts = s.easterEggs?.firstDiscoveredAt || {}
      const times = Object.values(ts).map(t => new Date(t).getTime()).filter(Boolean)
      if (!times.length || !s.accountCreatedAt) return false
      const minTs = Math.min(...times)
      return (minTs - new Date(s.accountCreatedAt).getTime()) <= 24 * 60 * 60 * 1000
    },
  },
]

// Convenience lookups
export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]))
export const BADGE_IDS = BADGES.map(b => b.id)
