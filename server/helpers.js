// Shared helper functions used across route modules.
// Extracted from index.js so they can be imported by routes/*.js without circular deps.

import { fileURLToPath } from 'url'
import path from 'path'
import crypto from 'crypto'
import pool from './db.js'
import { PLATFORM_LAUNCH_DATE } from '../src/badges/badgeDefinitions.js'
import { formatMsgTime, MISTRAL_API_KEY, UPLOAD_FILES_CEILING } from './middleware.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Mollie ────────────────────────────────────────────────────────────────────

export async function getMollieKey() {
  try {
    const [[row]] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'mollie_api_key'")
    if (row?.key_value && !row.key_value.includes('•')) return row.key_value
  } catch {}
  const envKey = (process.env.MOLLIE_API_KEY || '').replace(/^["']|["']$/g, '').trim()
  if (envKey) return envKey
  try {
    const { readFileSync } = await import('fs')
    const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      if (trimmed.slice(0, idx).trim() === 'MOLLIE_API_KEY') {
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
        if (val) return val
      }
    }
  } catch {}
  return null
}

export async function getMollieClient() {
  const key = await getMollieKey()
  if (!key) return null
  try {
    const { createMollieClient } = await import('@mollie/api-client')
    return createMollieClient({ apiKey: key })
  } catch (err) {
    console.error('getMollieClient import error:', err.message)
    return null
  }
}

// EUR/DKK exchange rate cache
let _eurDkkRate = null
let _eurDkkCachedAt = 0
const EUR_DKK_CACHE_TTL = 3600 * 1000

export async function fetchEurDkkRate() {
  if (_eurDkkRate && Date.now() - _eurDkkCachedAt < EUR_DKK_CACHE_TTL) return _eurDkkRate
  const resp = await fetch('https://api.frankfurter.app/latest?from=EUR&to=DKK', { signal: AbortSignal.timeout(5000) })
  if (!resp.ok) throw new Error(`Exchange rate API returned ${resp.status}`)
  const data = await resp.json()
  const rate = data?.rates?.DKK
  if (!rate || typeof rate !== 'number') throw new Error('No DKK rate in response')
  _eurDkkRate = rate
  _eurDkkCachedAt = Date.now()
  return rate
}

// ── AI ────────────────────────────────────────────────────────────────────────

export async function callMistral(systemPrompt, userPrompt) {
  if (!MISTRAL_API_KEY) return null
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    }),
  })
  if (!resp.ok) { console.error('Mistral error:', resp.status, await resp.text()); return null }
  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

export function buildTemplateCV(me, experience, edu, skillsList, langList) {
  let t = `# ${me.name || ''}\n`
  if (me.location) t += `📍 ${me.location}\n`
  if (me.job_title || me.company) t += `💼 ${[me.job_title, me.company].filter(Boolean).join(' · ')}\n`
  t += '\n'
  if (me.bio_da || me.bio_en) t += `## Om mig\n${me.bio_da || me.bio_en}\n\n`
  if (experience.length) {
    t += `## Erhvervserfaring\n`
    for (const e of experience) {
      const from = e.start_date ? new Date(e.start_date).toLocaleDateString('da-DK', { year: 'numeric', month: 'short' }) : ''
      const to = e.is_current ? 'nu' : (e.end_date ? new Date(e.end_date).toLocaleDateString('da-DK', { year: 'numeric', month: 'short' }) : '')
      t += `\n### ${e.title} — ${e.company}\n`
      if (from || to) t += `_${[from, to].filter(Boolean).join(' – ')}_\n`
      if (e.description) t += `${e.description}\n`
    }
    t += '\n'
  }
  if (edu.length) {
    t += `## Uddannelse\n`
    for (const e of edu) {
      t += `\n### ${[e.degree, e.field].filter(Boolean).join(', ') || e.institution}\n`
      if (e.degree || e.field) t += `${e.institution}\n`
      if (e.start_year || e.end_year) t += `_${[e.start_year, e.end_year].filter(Boolean).join('–')}_\n`
      if (e.description) t += `${e.description}\n`
    }
    t += '\n'
  }
  if (skillsList.length) t += `## Kompetencer\n${skillsList.join(' · ')}\n\n`
  if (langList) t += `## Sprog\n${langList}\n\n`
  return t
}

export function buildTemplateLetter(me, experience, skillsList, langList, job) {
  const jobTitle = job ? (typeof job.title === 'string' ? job.title : job.title?.da || '') : '[Stilling]'
  const companyName = job?.company_name || '[Virksomhed]'
  const today = new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })
  let t = `${me.location || ''}, ${today}\n\nKære ${companyName},\n\n`
  t += `Jeg ansøger hermed om stillingen som ${jobTitle}. `
  if (me.job_title || me.seniority) {
    t += `Som ${[me.seniority, me.job_title].filter(Boolean).join(' ')}${me.company ? ` hos ${me.company}` : ''} bringer jeg relevant erfaring til rollen.\n\n`
  }
  if (experience.length) t += `I min rolle som ${experience[0].title} hos ${experience[0].company} har jeg opnået solid erfaring inden for ${me.industry || 'branchen'}. `
  if (skillsList.length) t += `Mine kernekompetencer inkluderer ${skillsList.slice(0, 4).join(', ')}. `
  t += `\n\nJeg er motiveret af [udfyld din motivation] og ser frem til muligheden for at bidrage til ${companyName}.\n\nVenlig hilsen,\n${me.name || ''}\n`
  if (langList) t += `\n---\n_Sprog: ${langList}_\n`
  return t
}

// ── Link preview helpers ──────────────────────────────────────────────────────

export function isSafeExternalUrl(urlStr) {
  let parsed
  try { parsed = new URL(urlStr) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost') return false
  const bare = host.startsWith('[') ? host.slice(1, -1) : host
  if (bare === '::1') return false
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return false
  if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i.test(bare)) return false
  if (/^ff[0-9a-f]{2}:/i.test(bare)) return false
  if (/^::f{4}:/i.test(bare)) return false
  if (bare === '::' || bare === '0:0:0:0:0:0:0:0') return false
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1]), parseInt(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 192 && b === 0 && parseInt(ipv4[3]) === 2) return false
  }
  return true
}

export function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}

export function extractOgMeta(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m =
    html.match(new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${esc}["']`, 'i'))
  return m ? decodeHTMLEntities(m[1]) : null
}

// ── Keyword moderation ────────────────────────────────────────────────────────

let keywordFilterCache = []

export async function reloadKeywordFilters() {
  try {
    const [rows] = await pool.query('SELECT keyword, action, category, notes FROM keyword_filters')
    keywordFilterCache = rows
  } catch { keywordFilterCache = [] }
}

export function checkKeywords(text) {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const f of keywordFilterCache) {
    if (lower.includes(f.keyword.toLowerCase())) return f
  }
  return null
}

// ── Media settings cache ──────────────────────────────────────────────────────

let _mediaMaxFilesCache = { value: 4, expiresAt: 0 }

export async function getMediaMaxFiles() {
  const now = Date.now()
  if (now < _mediaMaxFilesCache.expiresAt) return _mediaMaxFilesCache.value
  try {
    const [rows] = await pool.query("SELECT key_value FROM admin_settings WHERE key_name = 'media_max_files'")
    const val = rows[0]?.key_value ? parseInt(rows[0].key_value, 10) : 4
    const clamped = Math.max(1, Math.min(val || 4, UPLOAD_FILES_CEILING))
    _mediaMaxFilesCache = { value: clamped, expiresAt: now + 60_000 }
    return clamped
  } catch {
    return _mediaMaxFilesCache.value
  }
}

export function invalidateMediaMaxFilesCache() { _mediaMaxFilesCache.expiresAt = 0 }

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function verifySettingsMfaCode(userId, mfaCode) {
  const [[user]] = await pool.query(
    'SELECT mfa_enabled, mfa_code, mfa_code_expires FROM users WHERE id = ?', [userId]
  )
  if (!user || !user.mfa_enabled) return true
  if (!mfaCode) return false
  if (!user.mfa_code || !user.mfa_code_expires) return false
  if (new Date(user.mfa_code_expires) < new Date()) return false
  const hashed = crypto.createHash('sha256').update(String(mfaCode)).digest('hex')
  if (hashed !== user.mfa_code) return false
  await pool.query('UPDATE users SET mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [userId])
  return true
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function getConversationForUser(convId, userId, myName) {
  const [participants] = await pool.query(
    `SELECT u.id, u.name, cp.last_read_at FROM users u
     JOIN conversation_participants cp ON cp.user_id = u.id
     WHERE cp.conversation_id = ?`, [convId])
  const [adminMutes] = await pool.query(
    `SELECT user_id, admin_muted_until FROM conversation_participants WHERE conversation_id = ?`, [convId]
  ).catch(() => [[]])
  const adminMuteMap = Object.fromEntries(adminMutes.map(r => [r.user_id, r.admin_muted_until ?? null]))
  const [msgs] = await pool.query(
    `SELECT m.id, u.name as from_name, m.text_da, m.text_en, m.time, m.is_read, m.created_at, m.media
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 20`, [convId])
  msgs.reverse()
  const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?', [convId])
  const [[conv]] = await pool.query(
    `SELECT c.name, c.created_by, cp.muted_until FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
     WHERE c.id = ?`, [userId, convId])
  const unread = msgs.filter(m => !m.is_read && m.from_name !== myName).length
  const otherParticipant = participants.find(p => p.id !== userId)
  const fallbackName = msgs.find(m => m.from_name !== myName)?.from_name || null
  const otherParticipants = participants.filter(p => p.id !== userId)
  const displayName = conv.name
    || (otherParticipants.length === 1 ? otherParticipants[0]?.name : otherParticipants.map(p => p.name.split(' ')[0]).join(', '))
    || fallbackName || 'Ukendt'
  const readReceipts = participants
    .filter(p => p.id !== userId && p.last_read_at)
    .map(p => ({ userId: p.id, name: p.name, lastReadAt: p.last_read_at }))
  return {
    id: convId,
    name: displayName,
    convName: conv.name,
    createdBy: conv.created_by,
    participants: participants.map(p => ({
      id: p.id,
      name: p.name,
      adminMutedUntil: adminMuteMap[p.id] ?? null,
    })),
    messages: msgs.map(m => ({
      id: m.id,
      from: m.from_name,
      text: { da: m.text_da, en: m.text_en },
      time: m.created_at ? formatMsgTime(m.created_at) : m.time,
      createdAtRaw: m.created_at,
      media: (() => { try { return m.media ? JSON.parse(m.media) : null } catch { return null } })(),
    })),
    totalMessages: total,
    unread,
    mutedUntil: conv.muted_until,
    readReceipts,
  }
}

// ── Badges / login streak ─────────────────────────────────────────────────────

export async function recordLoginDay(userId) {
  try {
    await pool.query(
      'INSERT IGNORE INTO user_login_days (user_id, login_date) VALUES (?, CURDATE())',
      [userId]
    )
  } catch { /* non-fatal */ }
}

export async function computeUserStats(userId) {
  const [[user]] = await pool.query(
    `SELECT created_at, name, bio_da, bio_en, location, avatar_url FROM users WHERE id = ?`, [userId]
  )
  if (!user) return null

  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM posts WHERE author_id = ?) AS postCount,
      (SELECT COUNT(*) FROM comments WHERE author_id = ?) AS commentCount,
      (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.author_id = ?) AS likesReceived,
      (SELECT COUNT(*) FROM post_likes WHERE user_id = ?) AS likesSentCount,
      (SELECT COUNT(*) FROM friendships WHERE user_id = ?) AS followingCount,
      (SELECT COUNT(*) FROM friendships WHERE friend_id = ?) AS followerCount,
      (SELECT COUNT(*) FROM friendships f1 WHERE f1.user_id = ? AND EXISTS(
        SELECT 1 FROM friendships f2 WHERE f2.user_id = f1.friend_id AND f2.friend_id = ?
      )) AS mutualFollowCount,
      (SELECT COUNT(DISTINCT profile_id) FROM profile_views WHERE viewer_id = ?) AS profilesVisited,
      (SELECT COALESCE(COUNT(*), 0) FROM share_events s WHERE s.user_id = ? AND s.share_type = 'post') +
      COALESCE((SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.shared_by_user_id = ?), 0) AS shareCount,
      (SELECT COUNT(*) FROM posts WHERE author_id = ? AND likes >= 10) AS postsWithTenPlusLikes,
      (SELECT COALESCE(MAX(likes), 0) FROM posts WHERE author_id = ?) AS maxLikesOnSinglePost,
      (SELECT COUNT(DISTINCT cl.comment_id) FROM comment_likes cl JOIN comments c ON c.id = cl.comment_id WHERE c.author_id = ?) AS commentsWithLikes,
      (SELECT COUNT(*) FROM friendships f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ?
        AND f.created_at <= DATE_ADD(u.created_at, INTERVAL 7 DAY)) AS followersJoinedWithinFirstWeek
  `, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId])

  const [[reelStats]] = await pool.query(`
    SELECT
      COUNT(*) AS reelCount,
      COALESCE(SUM(views_count), 0) AS reelViewsTotal
    FROM reels WHERE user_id = ?
  `, [userId])
  const [[reelLikeRow]] = await pool.query(`
    SELECT COUNT(*) AS reelLikesReceived
    FROM reel_likes rl JOIN reels r ON r.id = rl.reel_id
    WHERE r.user_id = ?
  `, [userId])

  const [[{ activeMonths }]] = await pool.query(`
    SELECT COUNT(DISTINCT ym) AS activeMonths FROM (
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym
      FROM posts WHERE author_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      UNION ALL
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym
      FROM comments WHERE author_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    ) sub
  `, [userId, userId])

  const [loginDays] = await pool.query(
    'SELECT login_date FROM user_login_days WHERE user_id = ? ORDER BY login_date DESC',
    [userId]
  )
  const totalLoginDays = loginDays.length
  let loginStreakDays = 0
  if (loginDays.length) {
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const todayStr = today.toISOString().slice(0, 10)
    const yestStr = yesterday.toISOString().slice(0, 10)
    const dates = loginDays.map(d => {
      const v = d.login_date
      if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`
      return String(v).slice(0, 10)
    })
    if (dates[0] === todayStr || dates[0] === yestStr) {
      loginStreakDays = 1
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]); prev.setDate(prev.getDate() - 1)
        const prevStr = prev.toISOString().slice(0, 10)
        if (dates[i] === prevStr) loginStreakDays++
        else break
      }
    }
  }

  const [eggRows] = await pool.query(`
    SELECT egg_id,
           COUNT(*) AS total_count,
           SUM(IF(event='discovered',1,0)) AS discovered_count,
           MIN(IF(event='discovered', activated_at, NULL)) AS first_discovered_at
    FROM easter_egg_events WHERE user_id = ?
    GROUP BY egg_id
  `, [userId])

  const eggDiscovered = []
  const eggActivationCounts = {}
  const eggFirstDiscoveredAt = {}
  for (const r of eggRows) {
    eggActivationCounts[r.egg_id] = Number(r.total_count)
    if (r.discovered_count > 0) {
      eggDiscovered.push(r.egg_id)
      eggFirstDiscoveredAt[r.egg_id] = r.first_discovered_at
    }
  }

  const profileComplete = !!(
    user.name?.trim() &&
    (user.bio_da?.trim() || user.bio_en?.trim()) &&
    user.location?.trim() &&
    user.avatar_url?.trim()
  )

  return {
    accountCreatedAt: user.created_at,
    platformLaunchDate: PLATFORM_LAUNCH_DATE,
    postCount: Number(counts.postCount || 0),
    commentCount: Number(counts.commentCount || 0),
    likesReceived: Number(counts.likesReceived || 0),
    likesSentCount: Number(counts.likesSentCount || 0),
    followingCount: Number(counts.followingCount || 0),
    followerCount: Number(counts.followerCount || 0),
    mutualFollowCount: Number(counts.mutualFollowCount || 0),
    profilesVisited: Number(counts.profilesVisited || 0),
    shareCount: Number(counts.shareCount || 0),
    reelCount: Number(reelStats?.reelCount || 0),
    reelViewsTotal: Number(reelStats?.reelViewsTotal || 0),
    reelLikesReceived: Number(reelLikeRow?.reelLikesReceived || 0),
    postsWithTenPlusLikes: Number(counts.postsWithTenPlusLikes || 0),
    maxLikesOnSinglePost: Number(counts.maxLikesOnSinglePost || 0),
    commentsWithLikes: Number(counts.commentsWithLikes || 0),
    followersJoinedWithinFirstWeek: Number(counts.followersJoinedWithinFirstWeek || 0),
    loginStreakDays,
    totalLoginDays,
    activeMonths: Number(activeMonths || 0),
    profileComplete,
    easterEggs: {
      discovered: eggDiscovered,
      activationCounts: eggActivationCounts,
      firstDiscoveredAt: eggFirstDiscoveredAt,
    },
  }
}

// ── Stream ────────────────────────────────────────────────────────────────────

export function generateStreamKey() {
  return crypto.randomBytes(16).toString('hex')
}

// ── CVR validation ────────────────────────────────────────────────────────────

export function isValidCVRChecksum(cvr) {
  const weights = [2, 7, 6, 5, 4, 3, 2, 1]
  const digits = cvr.split('').map(Number)
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  return sum % 11 === 0
}

export async function lookupCVR(cvr) {
  const token = process.env.CVRAPI_TOKEN
  const url = `https://cvrapi.dk/api?country=dk&search=${encodeURIComponent(cvr)}&useragent=fellis.eu${token ? `&token=${encodeURIComponent(token)}` : ''}`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`lookupCVR: HTTP ${res.status} from cvrapi.dk for CVR ${cvr}`)
      return { unavailable: true, status: res.status }
    }
    const data = await res.json()
    console.log(`lookupCVR: cvrapi.dk response for ${cvr}:`, JSON.stringify(data).slice(0, 200))
    if (data.error && data.error !== false) return { unavailable: true, status: 200, apiError: data.error }
    if (!data.name) return { unavailable: true, status: 200, apiError: 'no name' }
    return { name: data.name, city: data.city || null, industry: data.industrydesc || null }
  } catch (err) {
    console.warn(`lookupCVR: fetch failed for CVR ${cvr}:`, err.message)
    return { unavailable: true, status: 0, apiError: err.message }
  }
}

// ── Ad selection ──────────────────────────────────────────────────────────────
// Selects up to `limit` ads for a user, applying daily/weekly frequency caps,
// interest-score relevance ranking, budget pacing, and random jitter.

export async function selectAdsForUser(userId, limit) {
  const [[caps]] = await pool.query(
    'SELECT ad_daily_cap_per_user, ad_weekly_cap_per_user FROM admin_ad_settings WHERE id = 1'
  ).catch(() => [[null]])
  const dailyCap = parseInt(caps?.ad_daily_cap_per_user) || 5
  const weeklyCap = parseInt(caps?.ad_weekly_cap_per_user) || 20

  const [ads] = await pool.query(
    `SELECT id, title, body, image_url, target_url, placement, cpm_rate, budget, spent, target_interests
       FROM ads
      WHERE status = 'active'
        AND (start_date IS NULL OR start_date <= CURDATE())
        AND (end_date   IS NULL OR end_date   >= CURDATE())
      ORDER BY created_at DESC
      LIMIT 100`
  )
  if (!ads.length) return []

  const adIds = ads.map(a => a.id)
  let dayCountMap = {}
  let weekCountMap = {}
  try {
    const [dayRows] = await pool.query(
      'SELECT ad_id, COUNT(*) AS c FROM ad_impressions WHERE user_id = ? AND ad_id IN (?) AND created_at > NOW() - INTERVAL 1 DAY GROUP BY ad_id',
      [userId, adIds]
    )
    for (const r of dayRows) dayCountMap[r.ad_id] = Number(r.c)
    const [weekRows] = await pool.query(
      'SELECT ad_id, COUNT(*) AS c FROM ad_impressions WHERE user_id = ? AND ad_id IN (?) AND created_at > NOW() - INTERVAL 7 DAY GROUP BY ad_id',
      [userId, adIds]
    )
    for (const r of weekRows) weekCountMap[r.ad_id] = Number(r.c)
  } catch {}

  let interestMap = {}
  try {
    const [iRows] = await pool.query(
      'SELECT interest_slug, MAX(weight) AS w FROM interest_scores WHERE user_id = ? GROUP BY interest_slug',
      [userId]
    )
    for (const r of iRows) interestMap[r.interest_slug] = parseFloat(r.w) || 0
  } catch {}
  const hasInterestData = Object.keys(interestMap).length > 0

  const eligible = []
  for (const ad of ads) {
    if ((dayCountMap[ad.id] || 0) >= dailyCap) continue
    if ((weekCountMap[ad.id] || 0) >= weeklyCap) continue
    let targetSlugs = []
    if (ad.target_interests) {
      try {
        const parsed = typeof ad.target_interests === 'string' ? JSON.parse(ad.target_interests) : ad.target_interests
        if (Array.isArray(parsed)) targetSlugs = parsed.filter(s => typeof s === 'string')
      } catch {}
    }
    let relevance = 0
    if (hasInterestData && targetSlugs.length) {
      for (const slug of targetSlugs) relevance += interestMap[slug] || 0
    }
    const budgetNum = parseFloat(ad.budget) || 0
    const spentNum = parseFloat(ad.spent) || 0
    const pacing = budgetNum > 0 ? Math.max(0, 1 - spentNum / budgetNum) : 0.5
    const jitter = Math.random()
    const score = relevance * 10 + pacing * 1 + jitter * 0.5
    eligible.push({ ad, score })
  }
  eligible.sort((a, b) => b.score - a.score)
  return eligible.slice(0, limit).map(e => e.ad)
}
