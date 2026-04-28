import express from 'express'
import pool from '../db.js'
import { sendSms } from '../sms.js'
import { validate, schemas } from '../validation.js'
import { BADGES, BADGE_BY_ID, PLATFORM_LAUNCH_DATE, BADGE_AD_FREE_DAYS } from '../../src/badges/badgeDefinitions.js'
import { evaluateBadges } from '../../src/badges/badgeEngine.js'
import {
  authenticate, writeLimit, fileUploadLimit, strictLimit, registerLimit,
  requireAdmin, requireModerator, requireBusiness, attachUserMode,
  upload, uploadDoc, reelUpload, coverUpload,
  formatPostTime, formatMsgTime, applySignals, autoSignalPost,
  checkInviteRateLimit, checkForgotRateLimit, checkAndAwardBadges,
  createNotification, auditLog, auditLogGdpr, hasConsent, recordConsent, withdrawConsent,
  getSessionIdFromRequest, setSessionCookie, clearSessionCookie, generateCsrfToken,
  validateMagicBytes, validatePasswordStrength, getPasswordPolicy,
  sseBroadcast, sseAdd, sseRemove, sseClients,
  parseBrowser, getGeoForIp,
  UPLOADS_DIR, MISTRAL_API_KEY, UPLOAD_FILES_CEILING,
  mailer, oauthStateTokens,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  COOKIE_NAME, SERVER_START, visitedSessions, visitedAnonIps,
} from '../middleware.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from '../livestream.js'
import {
  getMollieClient, checkKeywords, getMediaMaxFiles,
  isSafeExternalUrl, extractOgMeta, decodeHTMLEntities,
} from '../helpers.js'
import { moderateContent } from '../moderation.js'

const router = express.Router()

// Feed-weight cache for the ranked feed path. Mirrors getFeedWeights() in
// routes/admin.js but is duplicated here to avoid a cross-route import cycle.
let _feedWeightsRankCache = null
let _feedWeightsRankCacheTime = 0
async function getFeedWeightsForRanking() {
  if (_feedWeightsRankCache && Date.now() - _feedWeightsRankCacheTime < 5 * 60 * 1000) return _feedWeightsRankCache
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('feed_weight_family','feed_weight_interest','feed_weight_recency','feed_weight_engagement')"
    )
    const w = { family: 1000, interest: 100, recency: 50, engagement: 10 }
    for (const r of rows) {
      const k = r.key_name.replace('feed_weight_', '')
      const v = parseFloat(r.key_value)
      if (!isNaN(v) && v >= 0) w[k] = v
    }
    _feedWeightsRankCache = w
    _feedWeightsRankCacheTime = Date.now()
    return w
  } catch { return { family: 1000, interest: 100, recency: 50, engagement: 10 } }
}

router.get('/linked-content', authenticate, async (req, res) => {
  const { type, id } = req.query
  if (!type || !id) return res.status(400).json({ error: 'type and id required' })
  const numId = parseInt(id)
  if (!numId) return res.status(400).json({ error: 'invalid id' })
  try {
    if (type === 'job') {
      const [[row]] = await pool.query(
        `SELECT j.id, j.title, j.location, j.remote, j.type as job_type, c.name as company_name, c.color as company_color
         FROM jobs j JOIN companies c ON j.company_id = c.id WHERE j.id = ? AND j.active = 1`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      return res.json({ type: 'job', item: row })
    }
    if (type === 'listing') {
      const [[row]] = await pool.query(
        `SELECT id, title, price, category, location, photos FROM marketplace_listings WHERE id = ? AND sold = 0`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      let photos = null
      try { photos = row.photos ? (typeof row.photos === 'string' ? JSON.parse(row.photos) : row.photos) : null } catch {}
      return res.json({ type: 'listing', item: { ...row, photos } })
    }
    if (type === 'event') {
      const [[row]] = await pool.query(
        `SELECT e.id, e.title, e.date, e.location, e.event_type, e.cover_url, u.name as organizer
         FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = ?`, [numId])
      if (!row) return res.status(404).json({ error: 'Not found' })
      return res.json({ type: 'event', item: row })
    }
    res.status(400).json({ error: 'unknown type' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


router.get('/feed', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    // cursor = ISO timestamp of the oldest post already seen; null = load from the top
    const cursor = req.query.cursor || null

    // Optional mode filter — 'privat', 'business', or 'network'; omit for mixed feed
    const modeFilter = req.query.mode || null
    if (modeFilter && !['privat', 'business', 'network'].includes(modeFilter)) {
      return res.status(400).json({ error: 'Invalid mode parameter. Must be "privat" or "business" (or "network").' })
    }

    // Ranked mode: rerank a 30-day candidate window by family/interest/recency/engagement
    // instead of strict reverse-chronological. Uses offset-based pagination (?offset=).
    const ranked = req.query.ranked === '1'
    const offset = ranked ? Math.max(0, parseInt(req.query.offset) || 0) : 0
    const cursorFilter = (ranked || !cursor) ? '' : 'AND p.created_at < ?'
    const cursorParams = (ranked || !cursor) ? [] : [new Date(cursor)]
    const rankedWindowClause = ranked ? 'AND p.created_at > NOW() - INTERVAL 30 DAY' : ''
    const sqlLimit = ranked ? Math.min(limit * 5 + offset, 250) : limit
    // 'network' matches both 'network' and legacy 'business' rows until migration is complete
    const modeClause = modeFilter ? (modeFilter === 'network' ? 'AND p.user_mode IN (?, ?)' : 'AND p.user_mode = ?') : ''
    const modeParams = modeFilter ? (modeFilter === 'network' ? ['network', 'business'] : [modeFilter]) : []

    let posts
    try {
      ;[posts] = await pool.query(
        `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.categories, p.created_at, p.edited_at,
                p.place_name, p.geo_lat, p.geo_lng, p.tagged_users, p.linked_type, p.linked_id,
                p.post_context, u.professional_title, u.business_category,
                (SELECT COUNT(*) FROM earned_badges WHERE user_id = p.author_id) as author_badge_count,
                p.group_id, grp.name AS group_name, grp.slug AS group_slug,
                (SELECT COUNT(*) FROM user_follows WHERE follower_id = ? AND followee_id = p.author_id) AS viewer_follows_author,
                (SELECT COUNT(*) FROM group_follows WHERE user_id = ? AND group_id = p.group_id) AS viewer_follows_group
         FROM posts p JOIN users u ON p.author_id = u.id
         LEFT JOIN conversations grp ON grp.id = p.group_id
         WHERE (p.author_id = ?
           OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
           OR p.author_id IN (SELECT business_id FROM business_follows WHERE follower_id = ?))
           AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
           AND (p.post_context IS NULL OR p.post_context = 'social')
           ${modeClause}
           ${cursorFilter}
           ${rankedWindowClause}
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [req.userId, req.userId, req.userId, req.userId, req.userId, ...modeParams, ...cursorParams, sqlLimit]
      )
    } catch {
      // Second attempt: no extended columns (place_name etc.), but keep mode filter
      try {
        ;[posts] = await pool.query(
          `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.categories, p.created_at, p.edited_at,
                  NULL as place_name, NULL as geo_lat, NULL as geo_lng,
                  NULL as tagged_users, NULL as linked_type, NULL as linked_id,
                  NULL as professional_title, NULL as business_category,
                  0 as author_badge_count
           FROM posts p JOIN users u ON p.author_id = u.id
           WHERE (p.author_id = ?
             OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
             OR p.author_id IN (SELECT business_id FROM business_follows WHERE follower_id = ?))
             AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
             ${modeClause}
             ${cursorFilter}
             ${rankedWindowClause}
           ORDER BY p.created_at DESC
           LIMIT ?`,
          [req.userId, req.userId, req.userId, ...modeParams, ...cursorParams, sqlLimit]
        )
      } catch {
        // Third attempt: user_mode column not yet migrated — return unfiltered feed
        ;[posts] = await pool.query(
          `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media, p.categories, p.created_at, p.edited_at,
                  NULL as place_name, NULL as geo_lat, NULL as geo_lng,
                  NULL as tagged_users, NULL as linked_type, NULL as linked_id,
                  NULL as professional_title, NULL as business_category,
                  0 as author_badge_count
           FROM posts p JOIN users u ON p.author_id = u.id
           WHERE (p.author_id = ?
             OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
             OR p.author_id IN (SELECT business_id FROM business_follows WHERE follower_id = ?))
             AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
             ${cursorFilter}
             ${rankedWindowClause}
           ORDER BY p.created_at DESC
           LIMIT ?`,
          [req.userId, req.userId, req.userId, ...cursorParams, sqlLimit]
        )
      }
    }
    const postIds = posts.map(p => p.id)
    let comments = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en, c.media,
                  COUNT(cl.id) AS likes,
                  MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked,
                  MAX(CASE WHEN cl.user_id = ? THEN cl.reaction ELSE NULL END) AS my_reaction
           FROM comments c
           JOIN users u ON c.author_id = u.id
           LEFT JOIN comment_likes cl ON cl.comment_id = c.id
           WHERE c.post_id IN (?)
           GROUP BY c.id, c.post_id, u.name, c.text_da, c.text_en, c.media
           ORDER BY c.created_at ASC`,
          [req.userId, req.userId, postIds]
        )
        comments = rows
      } catch {
        // media/reaction column may not exist yet — fall back
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en,
                  COUNT(cl.id) AS likes,
                  MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked
           FROM comments c
           JOIN users u ON c.author_id = u.id
           LEFT JOIN comment_likes cl ON cl.comment_id = c.id
           WHERE c.post_id IN (?)
           GROUP BY c.id, c.post_id, u.name, c.text_da, c.text_en
           ORDER BY c.created_at ASC`,
          [req.userId, postIds]
        )
        comments = rows
      }
    }
    // Fetch user's own likes (with reaction if column exists)
    let userLikes = []
    try {
      const [rows] = await pool.query('SELECT post_id, reaction FROM post_likes WHERE user_id = ?', [req.userId])
      userLikes = rows
    } catch {
      const [rows] = await pool.query('SELECT post_id FROM post_likes WHERE user_id = ?', [req.userId])
      userLikes = rows
    }
    const likedSet = new Set(userLikes.map(l => l.post_id))
    const userReactionMap = {}
    for (const l of userLikes) { if (l.reaction) userReactionMap[l.post_id] = l.reaction }

    // Fetch aggregated reaction counts for all posts
    let reactionRows = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT post_id, reaction, COUNT(*) as cnt FROM post_likes WHERE post_id IN (?) GROUP BY post_id, reaction ORDER BY cnt DESC`,
          [postIds]
        )
        reactionRows = rows
      } catch {}
    }
    const reactionsByPost = {}
    for (const r of reactionRows) {
      if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = []
      reactionsByPost[r.post_id].push({ emoji: r.reaction, count: Number(r.cnt) })
    }

    const commentsByPost = {}
    for (const c of comments) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = []
      let cMedia = null
      if (c.media) { try { cMedia = typeof c.media === 'string' ? JSON.parse(c.media) : c.media } catch {} }
      commentsByPost[c.post_id].push({ id: c.id, author: c.author, text: { da: c.text_da, en: c.text_en }, media: cMedia, likes: Number(c.likes || 0), liked: !!c.liked, reaction: c.my_reaction || null })
    }
    // Batch-fetch linked services for posts that have one
    const serviceIds = [...new Set(posts.map(p => p.linked_service_id).filter(Boolean))]
    const serviceMap = {}
    if (serviceIds.length > 0) {
      try {
        const [svcRows] = await pool.query(
          'SELECT id, name_da, name_en, description_da, description_en, price_from, price_to, image_url FROM business_services WHERE id IN (?)',
          [serviceIds]
        )
        for (const s of svcRows) serviceMap[s.id] = s
      } catch {}
    }

    const result = posts.map(p => {
      let media = null
      if (p.media) {
        try {
          const raw = typeof p.media === 'string' ? JSON.parse(p.media) : p.media
          media = Array.isArray(raw) ? raw.map(m => typeof m === 'string'
            ? { url: m, type: /\.(mp4|webm|mov)$/i.test(m) ? 'video' : 'image', mime: /\.(mp4|webm|mov)$/i.test(m) ? 'video/mp4' : 'image/jpeg' }
            : m) : raw
        } catch {}
      }
      let categories = null
      if (p.categories) {
        try { categories = typeof p.categories === 'string' ? JSON.parse(p.categories) : p.categories } catch {}
      }
      let taggedUsers = null
      if (p.tagged_users) {
        try { taggedUsers = typeof p.tagged_users === 'string' ? JSON.parse(p.tagged_users) : p.tagged_users } catch {}
      }
      return {
        id: p.id,
        author: p.author,
        authorId: p.author_id,
        authorMode: p.author_mode || 'privat',
        time: { da: formatPostTime(p.created_at, 'da'), en: formatPostTime(p.created_at, 'en') },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes,
        liked: likedSet.has(p.id),
        userReaction: userReactionMap[p.id] || null,
        reactions: reactionsByPost[p.id] || [],
        media,
        categories,
        comments: commentsByPost[p.id] || [],
        createdAtRaw: p.created_at,
        edited: !!p.edited_at,
        authorBadgeCount: p.author_badge_count || 0,
        placeName: p.place_name || null,
        geoLat: p.geo_lat || null,
        geoLng: p.geo_lng || null,
        location: (p.place_name || p.geo_lat) ? { name: p.place_name || null, lat: p.geo_lat ? parseFloat(p.geo_lat) : null, lng: p.geo_lng ? parseFloat(p.geo_lng) : null } : null,
        taggedUsers,
        linkedType: p.linked_type || null,
        linkedId: p.linked_id || null,
        linkedService: p.linked_service_id ? (serviceMap[p.linked_service_id] || null) : null,
        postContext: p.post_context || 'social',
        professionalTitle: p.professional_title || null,
        businessCategory: p.business_category || null,
        groupId: p.group_id || null,
        groupName: p.group_name || null,
        groupSlug: p.group_slug || null,
        viewerFollowsAuthor: Boolean(p.viewer_follows_author),
        viewerFollowsGroup: Boolean(p.viewer_follows_group),
      }
    })
    // Ranked mode: rerank the candidate window by family × friend + interest × overlap
    //   + engagement × (likes + 2·comments) + recency / (hours_old + 1). Uses offset
    //   pagination instead of cursor, since score order is not monotonic in time.
    let pagedResult = result
    let nextOffset = null
    if (ranked) {
      const weights = await getFeedWeightsForRanking()
      const [friendRows] = await pool.query('SELECT friend_id FROM friendships WHERE user_id = ?', [req.userId]).catch(() => [[]])
      const friendSet = new Set(friendRows.map(r => r.friend_id))
      let interestMap = {}
      try {
        const [iRows] = await pool.query(
          'SELECT interest_slug, MAX(weight) AS w FROM interest_scores WHERE user_id = ? GROUP BY interest_slug',
          [req.userId]
        )
        for (const r of iRows) interestMap[r.interest_slug] = parseFloat(r.w) || 0
      } catch {}
      const now = Date.now()
      const scored = result.map(p => {
        const hoursOld = Math.max(0, (now - new Date(p.createdAtRaw).getTime()) / 3_600_000)
        const familyScore = friendSet.has(p.authorId) ? 1 : 0
        let interestScore = 0
        if (Array.isArray(p.categories)) {
          for (const slug of p.categories) {
            const s = typeof slug === 'string' ? slug : (slug?.slug || slug?.id)
            if (s && interestMap[s]) interestScore += interestMap[s]
          }
          // Normalise to 0–1 range against the best theoretical match (top user weight × slug count)
          interestScore = Math.min(1, interestScore / 100)
        }
        const engagementScore = Math.log1p((p.likes || 0) + 2 * (p.comments?.length || 0))
        const recencyScore = 1 / (hoursOld + 1)
        const score =
          weights.family * familyScore +
          weights.interest * interestScore +
          weights.engagement * engagementScore +
          weights.recency * recencyScore
        return { ...p, _score: score }
      })
      scored.sort((a, b) => b._score - a._score || new Date(b.createdAtRaw) - new Date(a.createdAtRaw))
      const end = offset + limit
      pagedResult = scored.slice(offset, end).map(({ _score, ...rest }) => rest)
      nextOffset = scored.length > end ? end : null
    }

    // Track post views (fire-and-forget) — only for posts actually returned
    if (pagedResult.length && req.userId) {
      const viewValues = pagedResult.map(p => [p.id, req.userId])
      pool.query(
        `INSERT INTO post_views (post_id, viewer_id, view_count)
         VALUES ${viewValues.map(() => '(?,?,1)').join(',')}
         ON DUPLICATE KEY UPDATE view_count = view_count + 1, last_viewed_at = NOW()`,
        viewValues.flat()
      ).catch(() => {})
    }

    // nextCursor = created_at of the oldest post in this page (use as ?cursor= to load the next page)
    // null when fewer posts were returned than requested — no more pages exist
    const nextCursor = ranked
      ? null
      : (pagedResult.length === limit
        ? pagedResult[pagedResult.length - 1].createdAtRaw?.toISOString?.() ?? new Date(pagedResult[pagedResult.length - 1].createdAtRaw).toISOString()
        : null)
    res.json({ posts: pagedResult, nextCursor, nextOffset })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' })
  }
})


router.get('/feed/memories', authenticate, async (req, res) => {
  try {
    const now = new Date()
    const month = now.getMonth() + 1 // 1-based
    const day = now.getDate()

    const [rows] = await pool.query(
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en,
              p.likes, p.media, p.created_at,
              YEAR(p.created_at) as post_year,
              (? - YEAR(p.created_at)) as years_ago
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = ?
         AND MONTH(p.created_at) = ?
         AND DAY(p.created_at) = ?
         AND YEAR(p.created_at) < ?
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [now.getFullYear(), req.userId, month, day, now.getFullYear()]
    )

    const memories = rows.map(p => ({
      id: p.id,
      authorId: p.author_id,
      author: p.author,
      text: { da: p.text_da, en: p.text_en },
      time: { da: p.time_da, en: p.time_en },
      likes: p.likes || 0,
      media: (() => { try { return p.media ? JSON.parse(p.media) : [] } catch { return [] } })(),
      createdAt: p.created_at,
      yearsAgo: p.years_ago,
    }))

    res.json({ memories })
  } catch (err) {
    console.error('GET /api/feed/memories error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


// ── Context feeds ─────────────────────────────────────────────────────────────

async function fetchContextFeed(req, res, context) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const cursor = req.query.cursor || null
    const cursorFilter = cursor ? 'AND p.created_at < ?' : ''
    const cursorParams = cursor ? [new Date(cursor)] : []
    let posts
    try {
      ;[posts] = await pool.query(
        `SELECT p.id, p.author_id, u.name as author, u.mode as author_mode,
                p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
                p.categories, p.created_at, p.edited_at,
                p.place_name, p.geo_lat, p.geo_lng, p.tagged_users,
                p.linked_type, p.linked_id, p.post_context,
                (SELECT COUNT(*) FROM earned_badges WHERE user_id = p.author_id) as author_badge_count
         FROM posts p JOIN users u ON p.author_id = u.id
         WHERE (p.author_id = ?
           OR p.author_id IN (SELECT friend_id FROM friendships WHERE user_id = ?)
           OR p.author_id IN (SELECT business_id FROM business_follows WHERE follower_id = ?))
           AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
           AND p.post_context = ?
           ${cursorFilter}
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [req.userId, req.userId, req.userId, context, ...cursorParams, limit]
      )
    } catch {
      // post_context column not yet migrated — return empty to avoid confusion
      return res.json({ posts: [], nextCursor: null })
    }
    const postIds = posts.map(p => p.id)
    let comments = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query(
          `SELECT c.id, c.post_id, u.name as author, c.text_da, c.text_en,
                  COUNT(cl.id) AS likes,
                  MAX(CASE WHEN cl.user_id = ? THEN 1 ELSE 0 END) AS liked
           FROM comments c
           JOIN users u ON c.author_id = u.id
           LEFT JOIN comment_likes cl ON cl.comment_id = c.id
           WHERE c.post_id IN (?)
           GROUP BY c.id, c.post_id, u.name, c.text_da, c.text_en
           ORDER BY c.created_at ASC`,
          [req.userId, postIds]
        )
        comments = rows
      } catch {}
    }
    const commentsByPost = {}
    for (const c of comments) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = []
      commentsByPost[c.post_id].push({ id: c.id, author: c.author, text: { da: c.text_da, en: c.text_en }, likes: Number(c.likes || 0), liked: !!c.liked, reaction: null })
    }
    let userLikes = []
    if (postIds.length > 0) {
      try {
        const [rows] = await pool.query('SELECT post_id, reaction FROM post_likes WHERE user_id = ? AND post_id IN (?)', [req.userId, postIds])
        userLikes = rows
      } catch {}
    }
    const likedSet = new Set(userLikes.map(l => l.post_id))
    const userReactionMap = {}
    for (const l of userLikes) { if (l.reaction) userReactionMap[l.post_id] = l.reaction }
    const result = posts.map(p => {
      let media = null
      if (p.media) { try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {} }
      let categories = null
      if (p.categories) { try { categories = typeof p.categories === 'string' ? JSON.parse(p.categories) : p.categories } catch {} }
      return {
        id: p.id, author: p.author, authorId: p.author_id,
        authorMode: p.author_mode || 'privat',
        time: { da: formatPostTime(p.created_at, 'da'), en: formatPostTime(p.created_at, 'en') },
        text: { da: p.text_da, en: p.text_en },
        likes: p.likes, liked: likedSet.has(p.id),
        userReaction: userReactionMap[p.id] || null,
        reactions: [],
        media, categories,
        comments: commentsByPost[p.id] || [],
        createdAtRaw: p.created_at,
        edited: !!p.edited_at,
        authorBadgeCount: p.author_badge_count || 0,
        placeName: p.place_name || null,
        postContext: p.post_context || context,
      }
    })
    const nextCursor = posts.length === limit ? posts[posts.length - 1].created_at : null
    res.json({ posts: result, nextCursor })
  } catch (err) {
    console.error(`GET /api/feed/${context} error:`, err.message)
    res.status(500).json({ error: 'Server error' })
  }
}

router.get('/feed/network', authenticate, attachUserMode, async (req, res) => {
  if (req.userMode !== 'network' && req.userMode !== 'business') {
    return res.status(401).json({ error: 'Network feed requires a network or business account.' })
  }
  return fetchContextFeed(req, res, 'professional')
})

router.get('/feed/business', authenticate, async (req, res) => {
  return fetchContextFeed(req, res, 'business')
})


router.post('/posts/:id/boost', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const [[post]] = await pool.query('SELECT id, author_id FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'You can only boost your own posts' })

    const [[settings]] = await pool.query('SELECT post_boost_price, post_boost_days, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const boostPrice = parseFloat(settings?.post_boost_price) || 19
    const boostDays = parseInt(settings?.post_boost_days) || 7
    const currency = settings?.currency || 'EUR'

    const endDate = new Date()
    endDate.setDate(endDate.getDate() + boostDays)

    const mollie = await getMollieClient()
    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'

    // Create the boost ad record
    const [[adSettings]] = await pool.query('SELECT ad_price_cpm FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const cpmRate = parseFloat(adSettings?.ad_price_cpm) || 50
    const [result] = await pool.query(
      `INSERT INTO ads (advertiser_id, title, target_url, placement, start_date, end_date, cpm_rate, boosted_post_id, budget)
       VALUES (?, ?, ?, 'feed', NOW(), ?, ?, ?, ?)`,
      [req.userId, `Boosted post #${postId}`, `/post/${postId}`, endDate, cpmRate, postId, boostPrice]
    )
    const adId = result.insertId

    if (!mollie) {
      // Dev fallback: activate immediately
      await pool.query(
        "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = ? WHERE id = ?",
        [endDate, adId]
      )
      await pool.query(
        'INSERT INTO subscriptions (user_id, plan, status, ad_id) VALUES (?, ?, ?, ?)',
        [req.userId, 'post_boost', 'paid', adId]
      )
      return res.json({ activated: true, ad_id: adId, checkout_url: null })
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    const payment = await mollie.payments.create({
      amount: { currency, value: boostPrice.toFixed(2) },
      description: `fellis.eu — post boost #${postId}`,
      redirectUrl: `${origin}/?mollie_payment=success&plan=post_boost&ad_id=${adId}`,
      webhookUrl: `${siteUrl}/api/mollie/payment/webhook`,
      metadata: { user_id: String(req.userId), plan: 'post_boost', ad_id: String(adId) },
    })
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, payment.id, 'post_boost', payment.status, adId]
    )
    res.json({ checkout_url: payment.getCheckoutUrl(), ad_id: adId, activated: false })
  } catch (err) {
    console.error('POST /api/posts/:id/boost error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/feed/preflight', authenticate, (req, res) => {
  const { text } = req.body
  if (!text) return res.json({ ok: true })
  const kw = checkKeywords(text)
  if (!kw) return res.json({ ok: true })
  res.json({ ok: kw.action !== 'block', flagged: kw.action === 'flag', blocked: kw.action === 'block', keyword: kw.keyword, category: kw.category || null, notes: kw.notes || null })
})


router.post('/feed', authenticate, writeLimit, upload.array('media', UPLOAD_FILES_CEILING), async (req, res) => {
  // Enforce admin-configured media max files at runtime
  const mediaMax = await getMediaMaxFiles()
  if (req.files?.length > mediaMax) {
    // Clean up all uploaded files that exceed the limit
    for (const f of req.files) {
      try { fs.unlinkSync(f.path) } catch {}
    }
    return res.status(400).json({ error: `Too many files (max ${mediaMax})` })
  }
  const { text, scheduled_at, place_name, geo_lat, geo_lng } = req.body
  const rawCats = req.body.categories
  const categories = rawCats ? (typeof rawCats === 'string' ? JSON.parse(rawCats) : rawCats) : null
  const rawTagged = req.body.tagged_users
  const taggedUsers = rawTagged ? (typeof rawTagged === 'string' ? JSON.parse(rawTagged) : rawTagged) : null
  const VALID_LINKED_TYPES = new Set(['job', 'listing', 'event', 'reel'])
  const linkedType = VALID_LINKED_TYPES.has(req.body.linked_type) ? req.body.linked_type : null
  const linkedId = req.body.linked_id ? parseInt(req.body.linked_id) : null
  // Service Spotlight — optional service card attached to the post
  const linkedServiceId = req.body.linked_service_id ? parseInt(req.body.linked_service_id) : null
  if (!text && !req.files?.length) return res.status(400).json({ error: 'Post text or media required' })

  // post_context validation
  const VALID_CONTEXTS = new Set(['social', 'professional', 'business'])
  const rawContext = req.body.post_context || 'social'
  if (!VALID_CONTEXTS.has(rawContext)) return res.status(400).json({ error: 'Invalid post_context. Must be social, professional, or business.' })
  let postContext = rawContext
  // Enforce per-mode context restrictions
  let authorMode = 'private'
  try {
    const [[modeRow]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    authorMode = modeRow?.mode || 'private'
  } catch {}
  const normalMode = authorMode === 'privat' ? 'private' : authorMode
  if (normalMode === 'private' && postContext !== 'social') return res.status(403).json({ error: 'Private users can only post in the social context.' })
  if (normalMode === 'network' && postContext === 'business') return res.status(403).json({ error: 'Network users cannot post in the business context.' })
  if (normalMode === 'business' && postContext === 'professional') return res.status(403).json({ error: 'Business users cannot post in the professional context.' })

  // Keyword filter check
  const kw = checkKeywords(text)
  if (kw?.action === 'block') return res.status(400).json({ error: 'Post indeholder forbudt indhold / Post contains prohibited content' })
  // flag: allow post but auto-create a report for admin review
  const autoFlagKeyword = kw?.action === 'flag' ? kw.keyword : null

  // AI content moderation
  let postModResult = { safe: true, reason: null, confidence: 'low' }
  if (text) {
    postModResult = await moderateContent(text, 'post')
    if (!postModResult.safe && postModResult.confidence === 'high') {
      pool.query(
        'INSERT INTO moderation_log (content_type, content_id, result, reason, confidence) VALUES (?, ?, ?, ?, ?)',
        ['post', null, 'blocked', postModResult.reason, postModResult.confidence]
      ).catch(() => {})
      return res.status(403).json({ error: 'Content not allowed' })
    }
  }
  const postModerationFlagged = postModResult.safe ? 0 : 1

  // Validate magic bytes for each uploaded file
  const mediaUrls = []
  if (req.files?.length) {
    const cleanupAll = () => {
      for (const f of req.files) {
        try { fs.unlinkSync(f.path) } catch {}
      }
    }
    for (const file of req.files) {
      const header = Buffer.alloc(16)
      try {
        const fd = fs.openSync(file.path, 'r')
        fs.readSync(fd, header, 0, 16, 0)
        fs.closeSync(fd)
      } catch (err) {
        console.error(`[post media] failed to read "${file.originalname}":`, err.message)
        cleanupAll()
        return res.status(400).json({ error: `Could not read "${file.originalname}"` })
      }
      if (!validateMagicBytes(header, file.mimetype)) {
        console.warn(`[post media] magic bytes mismatch for "${file.originalname}" (${file.mimetype})`)
        cleanupAll()
        return res.status(400).json({ error: `File "${file.originalname}" failed content validation` })
      }
      const type = file.mimetype.startsWith('video/') ? 'video' : 'image'
      if (type === 'video') await transcodeVideo(file.path)
      mediaUrls.push({ url: `/uploads/${file.filename}`, type, mime: file.mimetype })
    }
  }

  try {
    const mediaJson = mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null
    const categoriesJson = Array.isArray(categories) && categories.length > 0 ? JSON.stringify(categories) : null
    const scheduledDate = scheduled_at ? new Date(scheduled_at) : null
    if (scheduledDate && isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Invalid scheduled_at' })
    const placeName = typeof place_name === 'string' ? place_name.slice(0, 255) : null
    const rawLat = geo_lat ? parseFloat(geo_lat) : null
    const rawLng = geo_lng ? parseFloat(geo_lng) : null
    const lat = (rawLat !== null && rawLat >= -90  && rawLat <= 90)  ? rawLat : null
    const lng = (rawLng !== null && rawLng >= -180 && rawLng <= 180) ? rawLng : null
    const taggedJson = Array.isArray(taggedUsers) && taggedUsers.length > 0 ? JSON.stringify(taggedUsers) : null
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, scheduled_at, categories, place_name, geo_lat, geo_lng, tagged_users, linked_type, linked_id, linked_service_id, user_mode, post_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT mode FROM users WHERE id = ?), ?)',
      [req.userId, text, text, 'Lige nu', 'Just now', mediaJson, scheduledDate, categoriesJson, placeName, lat, lng, taggedJson, linkedType, linkedId, linkedServiceId, req.userId, postContext]
    ).catch(() =>
      pool.query(
        'INSERT INTO posts (author_id, text_da, text_en, time_da, time_en, media, scheduled_at, categories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.userId, text, text, 'Lige nu', 'Just now', mediaJson, scheduledDate, categoriesJson]
      )
    )
    const [users] = await pool.query('SELECT name, mode FROM users WHERE id = ?', [req.userId])
      .catch(async () => {
        const [rows] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
        return [rows.map(r => ({ ...r, mode: 'privat' }))]
      })
    const [[badgeRow]] = await pool.query('SELECT COUNT(*) as cnt FROM earned_badges WHERE user_id = ?', [req.userId]).catch(() => [[{ cnt: 0 }]])
    const now = new Date()
    const postId = result.insertId
    if (postModerationFlagged) {
      pool.query('UPDATE posts SET flagged = 1 WHERE id = ?', [postId]).catch(() => {})
    }
    pool.query(
      'INSERT INTO moderation_log (content_type, content_id, result, reason, confidence) VALUES (?, ?, ?, ?, ?)',
      ['post', postId, postModResult.safe ? 'safe' : 'flagged', postModResult.reason, postModResult.confidence]
    ).catch(() => {})
    // Extract and store hashtags (max 10)
    if (text) {
      const tags = [...new Set((text.match(/#([\wæøåÆØÅ]{1,99})/g) || []).map(t => t.slice(1).toLowerCase()))].slice(0, 10)
      if (tags.length > 0) {
        pool.query(
          `INSERT IGNORE INTO post_hashtags (post_id, tag) VALUES ${tags.map(() => '(?,?)').join(',')}`,
          tags.flatMap(tag => [postId, tag])
        ).catch(() => {})
      }
    }
    // Auto-flag: create a pending report for admin review
    if (autoFlagKeyword) {
      pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'post', postId, 'keyword_flag', `Auto-flagged: keyword "${autoFlagKeyword}"`]
      ).catch(() => {})
    }
    // Business community score: increment when a business user publishes a post
    pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [req.userId]).catch(() => {})
    if (scheduledDate) {
      return res.json({ id: postId, scheduled: true, scheduledAt: scheduledDate })
    }
    res.json({
      id: postId,
      author: users[0].name,
      authorId: req.userId,
      authorMode: users[0].mode || 'privat',
      time: { da: formatPostTime(now, 'da'), en: formatPostTime(now, 'en') },
      text: { da: text, en: text },
      likes: 0, liked: false, userReaction: null, comments: [],
      reactions: [],
      media: mediaUrls.length > 0 ? mediaUrls : null,
      categories: categoriesJson ? JSON.parse(categoriesJson) : null,
      createdAtRaw: now.toISOString(),
      edited: false,
      authorBadgeCount: badgeRow?.cnt || 0,
      placeName: placeName || null,
      geoLat: lat || null,
      geoLng: lng || null,
      taggedUsers: taggedJson ? JSON.parse(taggedJson) : null,
      postContext: postContext || 'social',
      linkedType: linkedType || null,
      linkedId: linkedId || null,
      linkedService: linkedServiceId ? await pool.query(
        'SELECT id, name_da, name_en, description_da, description_en, price_from, price_to, image_url FROM business_services WHERE id = ? AND user_id = ?',
        [linkedServiceId, req.userId]
      ).then(([rows]) => rows[0] || null).catch(() => null) : null,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create post' })
  }
})


router.post('/upload', authenticate, fileUploadLimit, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate magic bytes
  const header = Buffer.alloc(16)
  const fd = fs.openSync(req.file.path, 'r')
  fs.readSync(fd, header, 0, 16, 0)
  fs.closeSync(fd)
  if (!validateMagicBytes(header, req.file.mimetype)) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'File content does not match declared type' })
  }

  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
  if (type === 'video') await transcodeVideo(req.file.path)
  // Audit log: file uploaded
  await auditLog(req, 'file_upload', 'file', null, {
    status: 'success',
    details: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      type: type
    }
  })
  res.json({ url: `/uploads/${req.file.filename}`, type, mime: req.file.mimetype })
})


router.post('/feed/:id/like', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  const reaction = req.body?.reaction || '❤️'
  try {
    const [existing] = await pool.query(
      'SELECT id, reaction FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    )
    if (existing.length > 0) {
      const cur = existing[0].reaction || '❤️'
      if (cur !== reaction) {
        // Change reaction without removing the like
        try {
          await pool.query('UPDATE post_likes SET reaction = ? WHERE post_id = ? AND user_id = ?', [reaction, postId, req.userId])
        } catch {} // reaction column not yet migrated
        return res.json({ liked: true, reaction })
      }
      // Same reaction — toggle off
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.userId])
      await pool.query('UPDATE posts SET likes = likes - 1 WHERE id = ?', [postId])
      res.json({ liked: false })
    } else {
      try {
        await pool.query('INSERT INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)', [postId, req.userId, reaction])
      } catch {
        await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.userId])
      }
      await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId])
      // Notify post author (not self)
      const [[post]] = await pool.query('SELECT user_id, categories FROM posts WHERE id = ?', [postId]).catch(() => [[null]])
      if (post && post.user_id !== req.userId) {
        const [[liker]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
        if (liker) {
          const emoji = reaction || '❤️'
          createNotification(post.user_id, 'like',
            `${liker.name} reagerede ${emoji} på dit opslag`,
            `${liker.name} reacted ${emoji} to your post`,
            req.userId, liker.name, postId
          )
        }
      }
      autoSignalPost(req.userId, postId, 'like')
      // Business community score: author gains +1 when their post receives a like
      if (post) pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [post.user_id]).catch(() => {})
      res.json({ liked: true, reaction })
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like' })
  }
})


router.get('/feed/:id/likers', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url, COALESCE(pl.reaction, '❤️') as reaction
       FROM post_likes pl JOIN users u ON u.id = pl.user_id
       WHERE pl.post_id = ? ORDER BY pl.created_at DESC`,
      [postId])
    res.json(rows.map(r => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url, reaction: r.reaction })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load likers' })
  }
})


router.post('/feed/:id/comment', authenticate, writeLimit, upload.single('media'), async (req, res) => {
  const text = (req.body.text || '').trim()
  if (!text && !req.file) return res.status(400).json({ error: 'Comment text or media required' })
  const postId = parseInt(req.params.id)
  // Keyword filter check
  const kwc = checkKeywords(text)
  if (kwc?.action === 'block') return res.status(400).json({ error: 'Kommentar indeholder forbudt indhold / Comment contains prohibited content' })
  const autoFlagKeywordComment = kwc?.action === 'flag' ? kwc.keyword : null

  // AI content moderation
  let commentModResult = { safe: true, reason: null, confidence: 'low' }
  if (text) {
    commentModResult = await moderateContent(text, 'comment')
    if (!commentModResult.safe && commentModResult.confidence === 'high') {
      pool.query(
        'INSERT INTO moderation_log (content_type, content_id, result, reason, confidence) VALUES (?, ?, ?, ?, ?)',
        ['comment', null, 'blocked', commentModResult.reason, commentModResult.confidence]
      ).catch(() => {})
      return res.status(403).json({ error: 'Content not allowed' })
    }
  }
  const commentModerationFlagged = commentModResult.safe ? 0 : 1

  let mediaJson = null
  if (req.file) {
    const header = Buffer.alloc(16)
    const fd = fs.openSync(req.file.path, 'r')
    fs.readSync(fd, header, 0, 16, 0)
    fs.closeSync(fd)
    if (!validateMagicBytes(header, req.file.mimetype)) {
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ error: 'File failed content validation' })
    }
    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
    if (type === 'video') await transcodeVideo(req.file.path)
    mediaJson = JSON.stringify([{ url: `/uploads/${req.file.filename}`, type, mime: req.file.mimetype }])
  }
  try {
    try {
      await pool.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en, media) VALUES (?, ?, ?, ?, ?)',
        [postId, req.userId, text, text, mediaJson]
      )
    } catch {
      // media column not yet migrated — insert without it
      await pool.query(
        'INSERT INTO comments (post_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
        [postId, req.userId, text, text]
      )
    }
    const [rows2] = await pool.query('SELECT LAST_INSERT_ID() as id')
    const commentId = rows2[0].id
    if (commentModerationFlagged) {
      pool.query('UPDATE comments SET flagged = 1 WHERE id = ?', [commentId]).catch(() => {})
    }
    pool.query(
      'INSERT INTO moderation_log (content_type, content_id, result, reason, confidence) VALUES (?, ?, ?, ?, ?)',
      ['comment', commentId, commentModResult.safe ? 'safe' : 'flagged', commentModResult.reason, commentModResult.confidence]
    ).catch(() => {})
    if (autoFlagKeywordComment) {
      pool.query(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
        [req.userId, 'comment', commentId, 'keyword_flag', `Auto-flagged: keyword "${autoFlagKeywordComment}"`]
      ).catch(() => {})
    }
    const [users] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const media = mediaJson ? JSON.parse(mediaJson) : null
    // Notify post author (not self)
    const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id = ?', [postId]).catch(() => [[null]])
    if (post && post.user_id !== req.userId) {
      createNotification(post.user_id, 'comment',
        `${users[0].name} kommenterede dit opslag`,
        `${users[0].name} commented on your post`,
        req.userId, users[0].name, postId
      )
    }
    autoSignalPost(req.userId, postId, 'comment')
    // Business community score: increment when a business user adds a comment
    pool.query("UPDATE users SET community_score = LEAST(community_score + 1, 9999) WHERE id = ? AND mode = 'business'", [req.userId]).catch(() => {})
    res.json({ author: users[0].name, text: { da: text, en: text }, media })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})


router.post('/comments/:id/like', authenticate, async (req, res) => {
  const commentId = parseInt(req.params.id)
  const emoji = (req.body?.emoji || '❤️').slice(0, 8)
  try {
    const [existing] = await pool.query(
      'SELECT id, reaction FROM comment_likes WHERE comment_id = ? AND user_id = ?',
      [commentId, req.userId]
    )
    if (existing.length) {
      const prev = existing[0].reaction || '❤️'
      if (prev === emoji) {
        // Same emoji → unlike
        await pool.query('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?', [commentId, req.userId])
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', [commentId])
        return res.json({ liked: false, reaction: null, likes: n })
      }
      // Different emoji → update reaction
      await pool.query('UPDATE comment_likes SET reaction = ? WHERE comment_id = ? AND user_id = ?', [emoji, commentId, req.userId])
    } else {
      await pool.query(
        'INSERT INTO comment_likes (comment_id, user_id, reaction) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reaction = VALUES(reaction)',
        [commentId, req.userId, emoji]
      ).catch(() =>
        // reaction column may not exist yet on old installs
        pool.query('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)', [commentId, req.userId])
      )
    }
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', [commentId])
    res.json({ liked: true, reaction: emoji, likes: n })
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle comment like' })
  }
})


router.delete('/feed/:id', authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const [rows] = await pool.query('SELECT id FROM posts WHERE id = ? AND author_id = ?', [postId, req.userId])
    if (!rows.length) return res.status(403).json({ error: 'Not your post' })
    await pool.query('DELETE FROM posts WHERE id = ?', [postId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete post' })
  }
})


router.patch('/feed/:id', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  try {
    const postId = parseInt(req.params.id)
    const [[post]] = await pool.query(
      'SELECT id, author_id, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds FROM posts WHERE id = ?', [postId]
    )
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Not your post' })
    if (post.age_seconds > 3600) return res.status(403).json({ error: 'Edit window expired (1 hour)' })
    await pool.query(
      'UPDATE posts SET text_da = ?, text_en = ?, edited_at = NOW() WHERE id = ?',
      [text.trim(), text.trim(), postId]
    )
    res.json({ ok: true, text: text.trim() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to edit post' })
  }
})


router.get('/posts/:id', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [posts] = await pool.query(
      `SELECT p.id, p.author_id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              (SELECT reaction FROM post_likes WHERE post_id = p.id AND user_id = ?) as userReaction
       FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      [req.userId, postId]
    )
    if (!posts.length) return res.status(404).json({ error: 'Post not found' })
    const post = posts[0]
    const [comments] = await pool.query(
      `SELECT u.name as author, c.text_da, c.text_en, c.media
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`, [postId]
    )
    const [rxRows] = await pool.query(
      'SELECT reaction, COUNT(*) as count FROM post_likes WHERE post_id = ? GROUP BY reaction', [postId]
    )
    res.json({
      id: post.id, author: post.author, authorId: post.author_id,
      text: { da: post.text_da, en: post.text_en },
      time: { da: post.time_da, en: post.time_en },
      likes: post.likes, liked: !!post.userReaction, userReaction: post.userReaction,
      reactions: Object.fromEntries(rxRows.map(r => [r.reaction, r.count])),
      media: post.media ? JSON.parse(post.media) : null,
      comments: comments.map(c => ({ author: c.author, text: { da: c.text_da, en: c.text_en }, media: c.media ? JSON.parse(c.media) : null })),
    })
  } catch (err) { res.status(500).json({ error: 'Failed to fetch post' }) }
})


router.get('/link-preview', authenticate, async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })
  if (!isSafeExternalUrl(url)) return res.status(400).json({ error: 'URL not allowed' })
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const response = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'fellis-link-preview/1.0', Accept: 'text/html' },
    })
    clearTimeout(timer)
    if (!response.ok) return res.json({ url })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return res.json({ url })
    const html = (await response.text()).slice(0, 60000) // only need <head>
    const title = extractOgMeta(html, 'og:title') ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null)
    const image = extractOgMeta(html, 'og:image')
    const description = extractOgMeta(html, 'og:description')
    const siteName = extractOgMeta(html, 'og:site_name') || new URL(url).hostname.replace(/^www\./, '')
    res.json({ url, title: title ? decodeHTMLEntities(title) : null, image, description, siteName })
  } catch {
    res.json({ url }) // silently return empty — preview just won't show
  }
})


router.get('/feed/company-posts', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT cp.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              u.name AS author_name,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp
       JOIN companies c ON c.id = cp.company_id
       JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id IN (
         SELECT company_id FROM company_follows WHERE user_id = ?
         UNION
         SELECT company_id FROM company_members WHERE user_id = ?
       )
       AND cp.created_at >= NOW() - INTERVAL 14 DAY
       ORDER BY cp.created_at DESC
       LIMIT 20`,
      [req.userId, req.userId, req.userId]
    )
    res.json({ posts })
  } catch (err) {
    console.error('GET /api/feed/company-posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/feed/scheduled', authenticate, async (req, res) => {
  try {
    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.scheduled_at
       FROM posts p WHERE p.author_id = ? AND p.scheduled_at > NOW()
       ORDER BY p.scheduled_at ASC`,
      [req.userId]
    )
    const result = posts.map(p => {
      let media = null
      if (p.media) { try { media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media } catch {} }
      return { id: p.id, text: { da: p.text_da, en: p.text_en }, media, scheduledAt: p.scheduled_at }
    })
    res.json({ posts: result })
  } catch (err) {
    console.error('GET /api/feed/scheduled error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/feed/scheduled/:id', authenticate, async (req, res) => {
  try {
    const { scheduled_at } = req.body
    const [[post]] = await pool.query('SELECT id FROM posts WHERE id = ? AND author_id = ? AND scheduled_at > NOW()', [req.params.id, req.userId])
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' })
    if (!scheduled_at) {
      // Cancel: set scheduled_at to null so post publishes immediately
      await pool.query('UPDATE posts SET scheduled_at = NULL WHERE id = ?', [req.params.id])
    } else {
      await pool.query('UPDATE posts SET scheduled_at = ? WHERE id = ?', [new Date(scheduled_at), req.params.id])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/feed/scheduled/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/public/profile/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.startsWith('@') ? req.params.handle : '@' + req.params.handle
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.bio_da, u.bio_en, u.location, u.avatar_url, u.join_date,
              u.profile_public, u.reputation_score, u.referral_count,
              u.mode,
              u.business_category, u.business_website, u.business_hours,
              u.business_description_da, u.business_description_en,
              (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
              (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND is_public = 1) as public_post_count
       FROM users u WHERE u.handle = ?`,
      [handle]
    )
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' })
    const user = rows[0]
    if (!user.profile_public) return res.status(403).json({ error: 'Profile is private' })

    // Public posts for this profile
    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              p.share_token, p.share_count, p.created_at
       FROM posts p WHERE p.author_id = ? AND p.is_public = 1
       ORDER BY p.created_at DESC LIMIT 10`,
      [user.id]
    )

    const publicProfile = {
      id: user.id,
      name: user.name,
      handle: user.handle,
      bio: { da: user.bio_da, en: user.bio_en },
      location: user.location,
      avatarUrl: user.avatar_url,
      joinDate: user.join_date,
      mode: user.mode || 'privat',
      friendCount: Number(user.friend_count),
      publicPostCount: Number(user.public_post_count),
      reputationScore: Number(user.reputation_score),
      posts: posts.map(p => ({
        id: p.id,
        text: { da: p.text_da, en: p.text_en },
        time: { da: p.time_da, en: p.time_en },
        likes: p.likes,
        media: p.media,
        shareToken: p.share_token,
        shareCount: p.share_count,
        createdAt: p.created_at,
      })),
    }
    if (user.mode === 'business') {
      publicProfile.businessCategory = user.business_category || null
      publicProfile.businessWebsite = user.business_website || null
      publicProfile.businessHours = user.business_hours || null
      publicProfile.businessDescription = { da: user.business_description_da || '', en: user.business_description_en || '' }
    }
    res.json(publicProfile)
  } catch (err) {
    console.error('GET /api/public/profile/:handle error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/public/post/:shareToken', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.time_da, p.time_en, p.likes, p.media,
              p.share_token, p.share_count, p.created_at, p.is_public,
              u.id as author_id, u.name as author_name, u.handle as author_handle,
              u.avatar_url as author_avatar, u.profile_public,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.share_token = ?`,
      [req.params.shareToken]
    )
    if (!rows.length) return res.status(404).json({ error: 'Post not found' })
    const post = rows[0]
    if (!post.is_public) return res.status(403).json({ error: 'Post is not public' })

    // Increment share view count
    await pool.query('UPDATE posts SET share_count = share_count + 1 WHERE share_token = ?', [req.params.shareToken])

    res.json({
      id: post.id,
      text: { da: post.text_da, en: post.text_en },
      time: { da: post.time_da, en: post.time_en },
      likes: post.likes,
      media: post.media,
      shareToken: post.share_token,
      shareCount: post.share_count,
      commentCount: Number(post.comment_count),
      createdAt: post.created_at,
      author: {
        id: post.author_id,
        name: post.author_name,
        handle: post.author_handle,
        avatarUrl: post.author_avatar,
        profilePublic: !!post.profile_public,
      },
    })
  } catch (err) {
    console.error('GET /api/public/post/:shareToken error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/posts/:id/share-token', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [[post]] = await pool.query('SELECT id, author_id, share_token, is_public FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    let shareToken = post.share_token
    if (!shareToken) {
      shareToken = crypto.randomBytes(16).toString('hex')
      await pool.query('UPDATE posts SET share_token = ?, is_public = 1 WHERE id = ?', [shareToken, postId])
    } else if (!post.is_public) {
      await pool.query('UPDATE posts SET is_public = 1 WHERE id = ?', [postId])
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    res.json({ shareToken, shareUrl: `${siteUrl}/p/${shareToken}` })
  } catch (err) {
    console.error('POST /api/posts/:id/share-token error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/posts/:id/share-token', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  try {
    const [[post]] = await pool.query('SELECT author_id FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE posts SET is_public = 0 WHERE id = ?', [postId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/feedback', authenticate, async (req, res) => {
  const { type, title, description } = req.body
  if (!['bug', 'missing', 'suggestion'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (!title?.trim() || !description?.trim()) return res.status(400).json({ error: 'Title and description required' })
  try {
    await pool.query(
      'INSERT INTO platform_feedback (user_id, type, title, description) VALUES (?, ?, ?, ?)',
      [req.userId, type, title.trim().slice(0, 200), description.trim()]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/feedback error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/feed/suggest-category', authenticate, async (req, res) => {
  const raw = req.query.text
  const text = (Array.isArray(raw) ? raw[0] : raw || '').toLowerCase()
  const MAP = [
    { keywords: ['mad', 'opskrift', 'food', 'recipe', 'pizza', 'kaffe', 'coffee'], cat: 'mad' },
    { keywords: ['musik', 'music', 'sang', 'song', 'band', 'concert', 'koncert'], cat: 'musik' },
    { keywords: ['rejse', 'travel', 'ferie', 'vacation', 'hotel', 'fly', 'flight'], cat: 'rejser' },
    { keywords: ['film', 'movie', 'serie', 'netflix', 'tv'], cat: 'film' },
    { keywords: ['teknologi', 'tech', 'ai', 'software', 'computer', 'kode', 'code'], cat: 'teknologi' },
    { keywords: ['sport', 'fodbold', 'football', 'løb', 'run', 'træning', 'workout'], cat: 'sundhed' },
    { keywords: ['kunst', 'art', 'maleri', 'painting', 'design', 'foto', 'photo'], cat: 'kunst' },
    { keywords: ['gaming', 'game', 'spil', 'playstation', 'xbox', 'pc'], cat: 'gaming' },
    { keywords: ['politik', 'politics', 'valg', 'election', 'regering', 'government'], cat: 'politik' },
    { keywords: ['natur', 'nature', 'skov', 'forest', 'dyr', 'animal', 'plante', 'plant'], cat: 'natur' },
    { keywords: ['bog', 'book', 'læs', 'read', 'roman', 'novel'], cat: 'boger' },
    { keywords: ['økonomi', 'finance', 'aktie', 'stock', 'invest', 'penge', 'money'], cat: 'okonomi' },
    { keywords: ['humor', 'sjov', 'funny', 'joke', 'griner', 'laugh'], cat: 'humor' },
    { keywords: ['mode', 'fashion', 'tøj', 'clothes', 'outfit', 'style'], cat: 'mode' },
    { keywords: ['diy', 'gør-det-selv', 'byg', 'build', 'reparér', 'fix'], cat: 'diy' },
  ]
  const match = MAP.find(m => m.keywords.some(kw => text.includes(kw)))
  res.json({ category: match ? match.cat : null })
})


router.get('/posts/:id/insights', authenticate, async (req, res) => {
  const postId = parseInt(req.params.id)
  if (isNaN(postId)) return res.status(400).json({ error: 'Invalid post ID' })
  try {
    const [[post]] = await pool.query(
      'SELECT id, likes FROM posts WHERE id = ? AND author_id = ?',
      [postId, req.userId]
    )
    if (!post) return res.status(403).json({ error: 'Not your post' })

    const [[views]] = await pool.query(
      'SELECT COUNT(*) AS reach, COALESCE(SUM(view_count), 0) AS impressions FROM post_views WHERE post_id = ?',
      [postId]
    )
    const [[cmt]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM comments WHERE post_id = ?',
      [postId]
    )
    let shares = 0
    try {
      const [[sh]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM share_events WHERE target_id = ? AND share_type = 'post'",
        [postId]
      )
      shares = Number(sh.cnt)
    } catch { shares = 0 }

    res.json({
      reach: Number(views.reach),
      impressions: Number(views.impressions),
      likes: post.likes || 0,
      comments: Number(cmt.cnt),
      shares,
    })
  } catch (err) {
    console.error('GET /api/posts/:id/insights error:', err)
    res.status(500).json({ error: 'Failed to load insights' })
  }
})


router.get('/explore/trending-tags', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT tag, COUNT(*) AS count
      FROM post_hashtags
      WHERE created_at > NOW() - INTERVAL 48 HOUR
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `)
    res.json(rows)
  } catch (err) {
    console.error('GET /api/explore/trending-tags error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/explore/trending', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT tag, COUNT(*) AS count
      FROM post_hashtags
      WHERE created_at > NOW() - INTERVAL 48 HOUR
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `)
    res.json(rows)
  } catch (err) {
    console.error('GET /api/explore/trending error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/explore/feed', authenticate, async (req, res) => {
  const cursor = req.query.cursor ? parseFloat(req.query.cursor) : null
  const filter = req.query.filter || 'all'   // all | images | video | reels
  const limit = 20
  try {
    // Build media-type filter clause
    let mediaFilter = ''
    if (filter === 'images') mediaFilter = `AND JSON_LENGTH(p.media) > 0 AND NOT JSON_CONTAINS(p.media, '"video"', '$[0].type')`
    else if (filter === 'video') mediaFilter = `AND JSON_LENGTH(p.media) > 0 AND JSON_CONTAINS(p.media, '"video"', '$[0].type')`
    else if (filter === 'reels') {
      // Reels are a separate content type (not linked to posts) — return empty
      return res.json({ posts: [], nextCursor: null })
    }

    // Cursor is the trending_score of the last item
    const cursorClause = cursor !== null ? `HAVING trending_score < ${parseFloat(cursor)}` : ''

    const [rows] = await pool.query(`
      SELECT
        p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
        p.likes, p.media, p.categories, p.created_at,
        u.name AS author, u.avatar_url, u.initials,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        (p.likes + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) * 2)
          / POW(TIMESTAMPDIFF(HOUR, p.created_at, NOW()) + 1, 1.2) AS trending_score
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.author_id != ?
        AND p.scheduled_at IS NULL
        ${mediaFilter}
      ${cursorClause}
      ORDER BY trending_score DESC
      LIMIT ?
    `, [req.userId, limit])

    const posts = rows.map(r => ({
      id: r.id,
      author: r.author,
      author_id: r.author_id,
      avatar_url: r.avatar_url,
      initials: r.initials,
      text: { da: r.text_da, en: r.text_en },
      time: { da: r.time_da, en: r.time_en },
      likes: r.likes,
      comment_count: r.comment_count,
      media: r.media ? JSON.parse(r.media) : null,
      categories: r.categories ? JSON.parse(r.categories) : null,
      created_at: r.created_at,
      trending_score: parseFloat(r.trending_score) || 0,
    }))

    const nextCursor = posts.length === limit ? posts[posts.length - 1].trending_score : null
    res.json({ posts, nextCursor })
  } catch (err) {
    console.error('GET /api/explore/feed error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/explore/group-posts', authenticate, async (req, res) => {
  const limit = 20
  try {
    const [rows] = await pool.query(`
      SELECT
        p.id, p.text_da, p.text_en, p.media, p.created_at, p.likes,
        u.name AS author_name, u.id AS author_id, u.avatar_url, u.initials,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        cv.id AS group_id, cv.name AS group_name, cv.slug AS group_slug,
        COALESCE(MAX(iscore.weight), 0) AS interest_weight
      FROM posts p
      JOIN users u ON u.id = p.author_id
      JOIN conversations cv ON cv.id = p.group_id
      LEFT JOIN interest_scores iscore
        ON iscore.user_id = ?
        AND cv.tags IS NOT NULL
        AND JSON_SEARCH(cv.tags, 'one', iscore.interest_slug) IS NOT NULL
      WHERE cv.is_group = 1
        AND cv.type = 'public'
        AND (cv.group_status IS NULL OR cv.group_status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM conversation_participants cp
          WHERE cp.conversation_id = cv.id
            AND cp.user_id = ?
            AND cp.status = 'active'
        )
        AND p.scheduled_at IS NULL
      GROUP BY p.id, u.name, u.id, u.avatar_url, u.initials,
               cv.id, cv.name, cv.slug,
               p.text_da, p.text_en, p.media, p.created_at, p.likes
      ORDER BY interest_weight DESC, p.created_at DESC
      LIMIT ?
    `, [req.userId, req.userId, limit])

    const posts = rows.map(r => ({
      id: r.id,
      author: r.author_name,
      author_id: r.author_id,
      avatar_url: r.avatar_url,
      initials: r.initials,
      text: { da: r.text_da, en: r.text_en },
      likes: r.likes,
      comment_count: Number(r.comment_count),
      media: r.media ? JSON.parse(r.media) : null,
      created_at: r.created_at,
      group_id: r.group_id,
      group_name: r.group_name,
      group_slug: r.group_slug,
    }))

    res.json({ posts })
  } catch (err) {
    console.error('GET /api/explore/group-posts error:', err.message)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/feed/suggested-posts', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 40)
  const excludeIds = (req.query.exclude_ids || '')
    .split(',').map(s => parseInt(s)).filter(n => !isNaN(n) && n > 0)

  try {
    // Try tag-overlap ranking first (requires post_hashtags table)
    let rows = []
    try {
      const excludeClause = excludeIds.length
        ? `AND p.id NOT IN (${excludeIds.map(() => '?').join(',')})`
        : ''

      ;[rows] = await pool.query(`
        SELECT
          p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
          p.likes, p.media, p.categories, p.created_at,
          u.name AS author, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          COALESCE(td.overlap, 0) AS tag_overlap,
          td.matching_tags
        FROM posts p
        JOIN users u ON u.id = p.author_id
        LEFT JOIN (
          SELECT ph2.post_id,
            COUNT(DISTINCT ph2.tag) AS overlap,
            GROUP_CONCAT(DISTINCT ph2.tag ORDER BY ph2.tag SEPARATOR ',') AS matching_tags
          FROM post_hashtags ph2
          WHERE ph2.tag IN (
            SELECT DISTINCT ph1.tag
            FROM post_hashtags ph1
            WHERE ph1.post_id IN (
              SELECT id FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 50
            )
          )
          GROUP BY ph2.post_id
        ) AS td ON td.post_id = p.id
        WHERE p.author_id != ?
          AND p.author_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND p.scheduled_at IS NULL
          AND p.created_at > NOW() - INTERVAL 60 DAY
          AND u.email NOT LIKE 'e2e.test.%@fellis-test.invalid'
          ${excludeClause}
        ORDER BY td.overlap DESC, p.likes DESC, p.created_at DESC
        LIMIT ?
      `, [req.userId, req.userId, req.userId, ...excludeIds, limit])
    } catch {
      // post_hashtags table missing — fall back to popularity
    }

    // If tag-overlap returned nothing (no hashtags used), fall back to popularity
    if (!rows.length) {
      const excludeClause = excludeIds.length
        ? `AND p.id NOT IN (${excludeIds.map(() => '?').join(',')})`
        : ''
      ;[rows] = await pool.query(`
        SELECT
          p.id, p.author_id, p.text_da, p.text_en, p.time_da, p.time_en,
          p.likes, p.media, p.categories, p.created_at,
          u.name AS author, u.avatar_url, u.initials,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          0 AS tag_overlap, NULL AS matching_tags
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.author_id != ?
          AND p.author_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
          AND p.scheduled_at IS NULL
          AND p.created_at > NOW() - INTERVAL 60 DAY
          AND u.email NOT LIKE 'e2e.test.%@fellis-test.invalid'
          ${excludeClause}
        ORDER BY p.likes DESC, p.created_at DESC
        LIMIT ?
      `, [req.userId, req.userId, ...excludeIds, limit])
    }

    const posts = rows.map(r => ({
      id: r.id,
      author: r.author,
      author_id: r.author_id,
      avatar_url: r.avatar_url,
      initials: r.initials,
      text: { da: r.text_da, en: r.text_en },
      time: { da: r.time_da, en: r.time_en },
      likes: r.likes,
      comment_count: r.comment_count,
      media: r.media ? JSON.parse(r.media) : null,
      categories: r.categories ? JSON.parse(r.categories) : null,
      tag_overlap: r.tag_overlap || 0,
      matching_tags: r.matching_tags ? r.matching_tags.split(',').slice(0, 3) : [],
    }))

    res.json({ posts })
  } catch (err) {
    console.error('GET /api/feed/suggested-posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/posts/:id/share', authenticate, writeLimit, async (req, res) => {
  try {
    const { comment } = req.body
    const [[post]] = await pool.query('SELECT id FROM posts WHERE id=?', [req.params.id])
    if (!post) return res.status(404).json({ error: 'Post not found' })
    await pool.query(
      'INSERT INTO post_shares (user_id, original_post_id, comment) VALUES (?,?,?) ON DUPLICATE KEY UPDATE comment=VALUES(comment)',
      [req.userId, req.params.id, comment || null]
    )
    await pool.query('UPDATE posts SET share_count = share_count + 1 WHERE id=?', [req.params.id])
    // Notify original author
    const [[orig]] = await pool.query('SELECT user_id FROM posts WHERE id=?', [req.params.id])
    if (orig && orig.user_id !== req.userId) {
      const [[sharer]] = await pool.query('SELECT name FROM users WHERE id=?', [req.userId])
      await pool.query(
        `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, message_da, message_en)
         VALUES (?,?,?,?,?,?,?)`,
        [orig.user_id, 'post_share', req.userId, 'post', req.params.id,
          `${sharer?.name || 'En bruger'} delte dit opslag`,
          `${sharer?.name || 'Someone'} shared your post`]
      ).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/posts/:id/share error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/posts/:id/share', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM post_shares WHERE user_id=? AND original_post_id=?', [req.userId, req.params.id])
    await pool.query('UPDATE posts SET share_count = GREATEST(share_count - 1, 0) WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/posts/:id/save', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query(
      'INSERT IGNORE INTO saved_posts (user_id, post_id) VALUES (?,?)',
      [req.userId, req.params.id]
    )
    res.json({ ok: true, saved: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/posts/:id/save', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_posts WHERE user_id=? AND post_id=?', [req.userId, req.params.id])
    res.json({ ok: true, saved: false })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/saved-posts', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar,
             sp.created_at AS saved_at,
             (SELECT COUNT(*) FROM post_likes WHERE post_id=p.id) AS like_count,
             (SELECT COUNT(*) FROM comments WHERE post_id=p.id AND parent_id IS NULL) AS comment_count
      FROM saved_posts sp
      JOIN posts p ON p.id = sp.post_id
      JOIN users u ON u.id = p.author_id
      WHERE sp.user_id = ?
      ORDER BY sp.created_at DESC
      LIMIT 100
    `, [req.userId])
    res.json({ posts: rows })
  } catch (err) {
    console.error('[saved-posts]', err.message)
    res.status(500).json({ error: 'Server error', detail: err.message })
  }
})


router.post('/posts/:id/poll', authenticate, writeLimit, async (req, res) => {
  try {
    const { options, ends_in_hours } = req.body
    if (!Array.isArray(options) || options.length < 2 || options.length > 4)
      return res.status(400).json({ error: 'Polls need 2–4 options' })
    // Verify post belongs to user
    const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id=?', [req.params.id])
    if (!post || post.user_id !== req.userId)
      return res.status(403).json({ error: 'Forbidden' })
    const endsAt = ends_in_hours ? new Date(Date.now() + ends_in_hours * 3600_000) : null
    const [pr] = await pool.query(
      'INSERT INTO post_polls (post_id, ends_at) VALUES (?,?)',
      [req.params.id, endsAt]
    )
    const pollId = pr.insertId
    for (let i = 0; i < options.length; i++) {
      await pool.query(
        'INSERT INTO poll_options (poll_id, text_da, text_en, sort_order) VALUES (?,?,?,?)',
        [pollId, options[i].da || options[i], options[i].en || options[i], i]
      )
    }
    res.json({ ok: true, poll_id: pollId })
  } catch (err) {
    console.error('POST poll error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/posts/:id/poll', authenticate, async (req, res) => {
  try {
    const [[poll]] = await pool.query('SELECT * FROM post_polls WHERE post_id=?', [req.params.id])
    if (!poll) return res.json({ poll: null })
    const [options] = await pool.query(
      'SELECT po.*, COUNT(pv.id) AS vote_count FROM poll_options po LEFT JOIN poll_votes pv ON pv.option_id=po.id WHERE po.poll_id=? GROUP BY po.id ORDER BY po.sort_order',
      [poll.id]
    )
    const [[userVote]] = await pool.query(
      'SELECT option_id FROM poll_votes WHERE poll_id=? AND user_id=?',
      [poll.id, req.userId]
    )
    res.json({ poll: { ...poll, options, user_vote: userVote?.option_id || null } })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/polls/:pollId/vote', authenticate, writeLimit, async (req, res) => {
  try {
    const { option_id } = req.body
    const [[poll]] = await pool.query('SELECT * FROM post_polls WHERE id=?', [req.params.pollId])
    if (!poll) return res.status(404).json({ error: 'Poll not found' })
    if (poll.ends_at && new Date(poll.ends_at) < new Date())
      return res.status(400).json({ error: 'Poll has ended' })
    await pool.query(
      'INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE option_id=VALUES(option_id)',
      [req.params.pollId, option_id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/comments/:id/reply', authenticate, writeLimit, async (req, res) => {
  try {
    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
    const [[parent]] = await pool.query('SELECT post_id, user_id FROM comments WHERE id=?', [req.params.id])
    if (!parent) return res.status(404).json({ error: 'Comment not found' })
    const [r] = await pool.query(
      'INSERT INTO comments (post_id, user_id, text, parent_id) VALUES (?,?,?,?)',
      [parent.post_id, req.userId, text.trim(), req.params.id]
    )
    // Notify parent comment author
    if (parent.user_id !== req.userId) {
      const [[replier]] = await pool.query('SELECT name FROM users WHERE id=?', [req.userId])
      await pool.query(
        `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, message_da, message_en)
         VALUES (?,?,?,?,?,?,?)`,
        [parent.user_id, 'comment_reply', req.userId, 'comment', r.insertId,
          `${replier?.name || 'En bruger'} svarede på din kommentar`,
          `${replier?.name || 'Someone'} replied to your comment`]
      ).catch(() => {})
    }
    const [[reply]] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar
       FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`,
      [r.insertId]
    )
    res.json({ reply })
  } catch (err) {
    console.error('POST /api/comments/:id/reply error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/comments/:id/replies', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar
       FROM comments c JOIN users u ON u.id=c.user_id
       WHERE c.parent_id=? ORDER BY c.created_at ASC`,
      [req.params.id]
    )
    res.json({ replies: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/hashtags/:tag/follow', authenticate, writeLimit, async (req, res) => {
  try {
    const tag = req.params.tag.toLowerCase().replace(/^#/, '')
    await pool.query(
      'INSERT IGNORE INTO hashtag_follows (user_id, hashtag) VALUES (?,?)',
      [req.userId, tag]
    )
    res.json({ ok: true, following: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/hashtags/:tag/follow', authenticate, async (req, res) => {
  try {
    const tag = req.params.tag.toLowerCase().replace(/^#/, '')
    await pool.query('DELETE FROM hashtag_follows WHERE user_id=? AND hashtag=?', [req.userId, tag])
    res.json({ ok: true, following: false })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/feed/:id/convert-to-reel', authenticate, writeLimit, async (req, res) => {
  try {
    const [[post]] = await pool.query('SELECT * FROM posts WHERE id=? AND author_id=?', [req.params.id, req.userId])
    if (!post) return res.status(403).json({ error: 'Forbidden' })
    const mediaArr = Array.isArray(post.media) ? post.media
      : (() => { try { return JSON.parse(post.media || '[]') } catch { return [] } })()
    const videos = mediaArr.filter(m => m.type === 'video')
    if (!videos.length) return res.status(400).json({ error: 'No video in post' })
    const caption = post.text_da || post.text_en || ''
    const reelIds = []
    for (const video of videos) {
      const [r] = await pool.query(
        'INSERT INTO reels (user_id, video_url, caption, created_at) VALUES (?,?,?,NOW())',
        [req.userId, video.url, caption]
      )
      reelIds.push(r.insertId)
    }
    res.json({ ok: true, reel_ids: reelIds })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/feed/discovery', authenticate, async (req, res) => {
  try {
    const uid = req.userId

    // Users: not self, not already friends
    const [users] = await pool.query(
      `SELECT u.id, 'user' AS type, u.name,
              u.avatar_url AS avatar,
              COALESCE(u.bio_da, '') AS description_da,
              COALESCE(u.bio_en, '') AS description_en,
              COALESCE(u.follower_count, 0) AS follower_count
       FROM users u
       WHERE u.id != ?
         AND u.id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
         AND u.id NOT IN (SELECT user_id FROM friendships WHERE friend_id = ?)
       ORDER BY RAND()
       LIMIT 2`,
      [uid, uid, uid]
    )

    // Businesses: not followed, not owned
    const [businesses] = await pool.query(
      `SELECT c.id, 'business' AS type, c.name,
              NULL AS avatar,
              COALESCE(c.tagline, '') AS description_da,
              COALESCE(c.tagline, '') AS description_en,
              (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS follower_count
       FROM companies c
       WHERE c.id NOT IN (SELECT company_id FROM company_follows WHERE user_id = ?)
         AND c.id NOT IN (SELECT company_id FROM company_members WHERE user_id = ?)
       ORDER BY RAND()
       LIMIT 2`,
      [uid, uid]
    )

    // Public groups: not joined
    const [groups] = await pool.query(
      `SELECT cv.id, 'group' AS type, cv.name,
              NULL AS avatar,
              COALESCE(cv.description_da, '') AS description_da,
              COALESCE(cv.description_en, '') AS description_en,
              (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = cv.id) AS follower_count
       FROM conversations cv
       WHERE cv.is_public = 1
         AND cv.is_group = 1
         AND cv.id NOT IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ?)
       ORDER BY RAND()
       LIMIT 2`,
      [uid]
    )

    const all = [...users, ...businesses, ...groups]
    // Fisher-Yates shuffle for unbiased random mix
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]]
    }
    res.json({ suggestions: all.slice(0, 5) })
  } catch (err) {
    console.error('GET /api/feed/discovery error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
