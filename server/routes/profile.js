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
  mailer,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  COOKIE_NAME, SERVER_START, visitedSessions, visitedAnonIps,
} from '../middleware.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from '../livestream.js'
import { RTMP_PORT } from '../rtmp.js'
import { recordLoginDay, verifySettingsMfaCode, isValidCVRChecksum, lookupCVR } from '../helpers.js'

const router = express.Router()

router.patch('/profile/phone', authenticate, writeLimit, async (req, res) => {
  const { phone } = req.body
  // Allow clearing phone (empty string → null), or set a new number
  const cleaned = phone ? phone.trim() : null
  // Basic E.164 validation if provided
  if (cleaned && !/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format, e.g. +4512345678' })
  }
  try {
    // If clearing the phone number, also disable MFA to avoid locked-out state
    if (!cleaned) {
      await pool.query('UPDATE users SET phone = NULL, mfa_enabled = 0, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [req.userId])
    } else {
      await pool.query('UPDATE users SET phone = ? WHERE id = ?', [cleaned, req.userId])
    }
    res.json({ ok: true, phone: cleaned })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update phone number' })
  }
})


router.get('/profile/:id', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    let users
    try {
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url, u.cover_photo_url,
          u.industry, u.seniority, u.job_title, u.company, u.professional_title,
          u.mode, u.follower_count, u.community_score,
          u.business_category, u.business_website, u.business_hours,
          u.business_description_da, u.business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count,
          (SELECT COUNT(*) FROM friendships f1
             JOIN friendships f2 ON f1.friend_id = f2.friend_id
             WHERE f1.user_id = ? AND f2.user_id = u.id) as mutual_count,
          (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = u.id) as is_friend,
          (SELECT COUNT(*) FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') as request_sent
         FROM users u WHERE u.id = ?`,
        [req.userId, req.userId, req.userId, targetId]
      )
    } catch {
      // Phase 1/2 migration columns not yet applied — fall back without them
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url, NULL AS cover_photo_url,
          u.industry, u.seniority, u.job_title, u.company, NULL AS professional_title,
          u.mode,
          0 AS follower_count, 0 AS community_score,
          NULL AS business_category, NULL AS business_website, NULL AS business_hours,
          NULL AS business_description_da, NULL AS business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count,
          (SELECT COUNT(*) FROM friendships f1
             JOIN friendships f2 ON f1.friend_id = f2.friend_id
             WHERE f1.user_id = ? AND f2.user_id = u.id) as mutual_count,
          (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = u.id) as is_friend,
          (SELECT COUNT(*) FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') as request_sent
         FROM users u WHERE u.id = ?`,
        [req.userId, req.userId, req.userId, targetId]
      )
    }
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    // Check block status separately (user_blocks table is optional — added via migrate-moderation.sql)
    let isBlocked = false
    try {
      const [[blockRow]] = await pool.query(
        'SELECT COUNT(*) as cnt FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?',
        [req.userId, targetId]
      )
      isBlocked = blockRow.cnt > 0
    } catch { /* table not yet created */ }
    // Log profile view (fire-and-forget, skip self-views)
    // source_post_id tracks which post led to the visit (for analytics)
    if (targetId !== req.userId) {
      const sourcePostId = parseInt(req.query.source_post_id) || null
      pool.query(
        'INSERT INTO profile_views (viewer_id, profile_id, source_post_id) VALUES (?, ?, ?)',
        [req.userId, targetId, sourcePostId]
      ).catch(() => {})
    }
    // Fetch earned badges for the target user
    let badges = []
    try {
      const lang = req.lang || 'da'
      const [badgeRows] = await pool.query(
        'SELECT badge_id, awarded_at FROM earned_badges WHERE user_id = ? ORDER BY awarded_at ASC',
        [targetId]
      )
      badges = badgeRows.map(r => {
        const def = BADGE_BY_ID[r.badge_id]
        if (!def) return null
        return { id: r.badge_id, icon: def.icon, name: def.name[lang] || def.name.da, description: def.description?.[lang] || def.description?.da || null, tier: def.tier, awardedAt: r.awarded_at }
      }).filter(Boolean)
    } catch { /* badges table may not exist yet */ }
    // Check if viewer is following this user (user_follows table)
    let isFollowingUser = false
    let userFollowerCount = Number(u.follower_count || 0)
    if (targetId !== req.userId) {
      try {
        const [[fRow]] = await pool.query(
          'SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?',
          [req.userId, targetId]
        )
        isFollowingUser = !!fRow
        const [[cntRow]] = await pool.query(
          'SELECT COUNT(*) as cnt FROM user_follows WHERE followee_id = ?',
          [targetId]
        )
        userFollowerCount = Number(cntRow?.cnt || 0)
      } catch { /* user_follows table may not exist yet */ }
    }
    const profilePayload = {
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      avatarUrl: u.avatar_url || null,
      coverPhotoUrl: u.cover_photo_url || null,
      mode: u.mode || 'privat',
      industry: u.industry || null,
      seniority: u.seniority || null,
      jobTitle: u.job_title || null,
      professionalTitle: u.professional_title || null,
      company: u.company || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
      mutualCount: u.mutual_count || 0,
      isFriend: !!u.is_friend,
      requestSent: !!u.request_sent,
      isBlocked,
      badges,
      followerCount: userFollowerCount,
      isFollowing: isFollowingUser,
    }
    if (u.mode === 'business') {
      profilePayload.businessCategory = u.business_category || null
      profilePayload.businessWebsite = u.business_website || null
      profilePayload.businessHours = u.business_hours || null
      profilePayload.businessDescription = { da: u.business_description_da || '', en: u.business_description_en || '' }
      profilePayload.communityScore = Number(u.community_score || 0)
      profilePayload.cvrNumber = u.cvr_number || null
      profilePayload.is_verified = !!u.is_verified
      // For business: override with business_follows count and isFollowing check
      let bizFollowing = false
      try {
        const [[fRow]] = await pool.query(
          'SELECT 1 FROM business_follows WHERE follower_id = ? AND business_id = ?',
          [req.userId, targetId]
        )
        bizFollowing = !!fRow
        const [[cntRow]] = await pool.query(
          'SELECT COUNT(*) as cnt FROM business_follows WHERE business_id = ?',
          [targetId]
        )
        profilePayload.followerCount = Number(cntRow?.cnt || u.follower_count || 0)
      } catch {}
      profilePayload.isFollowing = bizFollowing
    }
    res.json(profilePayload)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})


router.get('/profile/:id/photos', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT id, media, created_at
       FROM posts
       WHERE author_id = ? AND media IS NOT NULL AND media != 'null' AND scheduled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 30`,
      [targetId]
    )
    const photos = []
    for (const row of rows) {
      let media = []
      try { media = JSON.parse(row.media) || [] } catch { continue }
      for (const m of media) {
        if (m?.url) photos.push({ postId: row.id, url: m.url, type: m.type || 'image', created_at: row.created_at })
      }
    }
    res.json(photos.slice(0, 30))
  } catch (err) {
    console.error('GET /api/profile/:id/photos error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/profile/:id/posts', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.likes, p.created_at,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
              p.group_id, c.name AS group_name, c.slug AS group_slug
       FROM posts p
       LEFT JOIN conversations c ON c.id = p.group_id AND c.is_group = 1
       WHERE p.author_id = ? AND p.scheduled_at IS NULL
       ORDER BY p.created_at DESC LIMIT 10`,
      [targetId]
    )
    res.json(rows.map(p => {
      let media = []
      try { media = JSON.parse(p.media) || [] } catch { /* ignore */ }
      return { id: p.id, text_da: p.text_da, text_en: p.text_en, media, likes: p.likes, comment_count: p.comment_count, created_at: p.created_at, group_id: p.group_id || null, group_name: p.group_name || null, group_slug: p.group_slug || null }
    }))
  } catch (err) {
    console.error('GET /api/profile/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/profile', authenticate, async (req, res) => {
  try {
    let users
    try {
      ;[users] = await pool.query(
        `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url, u.cover_photo_url,
          u.email,
          (u.password_hash IS NOT NULL AND u.password_hash != '') AS has_password,
          u.created_at, u.birthday, u.gender,
          u.profile_public, u.reputation_score, u.referral_count, u.interests, u.tags,
          u.relationship_status, u.website,
          u.phone, u.mobilepay, u.mfa_enabled,
          u.industry, u.seniority, u.job_title, u.company,
          u.mode,
          u.business_category, u.business_website, u.business_hours,
          u.business_description_da, u.business_description_en,
          (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
         FROM users u WHERE u.id = ?`,
        [req.userId]
      )
    } catch {
      try {
        // Fallback: without business_* columns
        ;[users] = await pool.query(
          `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url, NULL AS cover_photo_url,
            u.email,
            (u.password_hash IS NOT NULL AND u.password_hash != '') AS has_password,
            u.created_at, u.birthday, u.gender,
            u.profile_public, u.reputation_score, u.referral_count, u.interests, u.tags,
            u.relationship_status, u.website,
            u.phone, u.mobilepay, u.mfa_enabled,
            u.industry, u.seniority, u.job_title, u.company,
            u.mode,
            NULL AS business_category, NULL AS business_website, NULL AS business_hours,
            NULL AS business_description_da, NULL AS business_description_en,
            (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
            (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
           FROM users u WHERE u.id = ?`,
          [req.userId]
        )
      } catch {
        // Final fallback: without gender/mobilepay (migration not yet applied)
        ;[users] = await pool.query(
          `SELECT u.id, u.name, u.handle, u.initials, u.bio_da, u.bio_en, u.location, u.join_date, u.photo_count, u.avatar_url, NULL AS cover_photo_url,
            u.email,
            (u.password_hash IS NOT NULL AND u.password_hash != '') AS has_password,
            u.created_at, u.birthday,
            NULL AS gender,
            u.profile_public, u.reputation_score, u.referral_count, u.interests, u.tags,
            u.relationship_status, u.website,
            u.phone, NULL AS mobilepay, u.mfa_enabled,
            u.industry, u.seniority, u.job_title, u.company,
            u.mode,
            NULL AS business_category, NULL AS business_website, NULL AS business_hours,
            NULL AS business_description_da, NULL AS business_description_en,
            (SELECT COUNT(*) FROM friendships WHERE user_id = u.id) as friend_count,
            (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
           FROM users u WHERE u.id = ?`,
          [req.userId]
        )
      }
    }
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    const u = users[0]
    let interests = []
    try { interests = typeof u.interests === 'string' ? JSON.parse(u.interests) : (u.interests || []) } catch {}
    let tags = []
    try { tags = typeof u.tags === 'string' ? JSON.parse(u.tags) : (u.tags || []) } catch {}
    const payload = {
      id: u.id, name: u.name, handle: u.handle, initials: u.initials,
      bio: { da: u.bio_da || '', en: u.bio_en || '' },
      location: u.location, joinDate: u.join_date,
      avatarUrl: u.avatar_url || null,
      coverPhotoUrl: u.cover_photo_url || null,
      mode: u.mode || 'privat',
      industry: u.industry || null,
      seniority: u.seniority || null,
      jobTitle: u.job_title || null,
      company: u.company || null,
      friendCount: u.friend_count, postCount: u.post_count, photoCount: u.photo_count || 0,
      email: u.email || null,
      loginMethod: 'email',
      hasPassword: !!u.has_password,
      createdAt: u.created_at || u.join_date || null,
      birthday: u.birthday ? (u.birthday instanceof Date ? `${u.birthday.getFullYear()}-${String(u.birthday.getMonth() + 1).padStart(2,'0')}-${String(u.birthday.getDate()).padStart(2,'0')}` : String(u.birthday).slice(0, 10)) : null,
      gender: u.gender || null,
      profile_public: !!u.profile_public,
      reputationScore: Number(u.reputation_score || 0),
      referralCount: Number(u.referral_count || 0),
      interests, tags,
      relationship_status: u.relationship_status || null,
      website: u.website || null,
      phone: u.phone || null,
      mobilepay: u.mobilepay || null,
      mfaEnabled: !!u.mfa_enabled,
    }
    if (u.mode === 'business') {
      payload.businessCategory = u.business_category || null
      payload.businessWebsite = u.business_website || null
      payload.businessHours = u.business_hours || null
      payload.businessDescription = { da: u.business_description_da || '', en: u.business_description_en || '' }
    }
    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' })
  }
})


router.patch('/me/mode', authenticate, writeLimit, async (req, res) => {
  const { mode } = req.body
  if (!['privat', 'network', 'business'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' })
  try {
    await pool.query('UPDATE users SET mode = ? WHERE id = ?', [mode, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mode' })
  }
})


router.patch('/me/lang', authenticate, writeLimit, async (req, res) => {
  const { lang } = req.body
  const VALID_LANGS = ['da','en','de','fr','es','it','nl','sv','no','fi','pl','pt','ro','hu','cs','sk','hr','bg','el','lt','lv','et','sl','mt','ga','lb']
  if (!VALID_LANGS.includes(lang)) return res.status(400).json({ error: 'Invalid lang' })
  const sessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('UPDATE sessions SET lang = ? WHERE id = ?', [lang, sessionId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lang' })
  }
})


router.patch('/me/plan', authenticate, writeLimit, async (req, res) => {
  const { plan } = req.body
  if (!['business'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' })
  try {
    await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' })
  }
})


router.patch('/me/interests', authenticate, writeLimit, async (req, res) => {
  const { interests } = req.body
  if (!Array.isArray(interests) || interests.length < 3) {
    return res.status(400).json({ error: 'At least 3 interests required' })
  }
  const VALID = ['musik','videnskab','nyheder','sport','teknologi','kunst','mad','rejser','film','politik','natur','gaming','sundhed','boger','humor','diy','okonomi','mode']
  const clean = interests.filter(i => VALID.includes(i))
  if (clean.length < 3) return res.status(400).json({ error: 'Invalid interest categories' })
  try {
    await pool.query('UPDATE users SET interests = ? WHERE id = ?', [JSON.stringify(clean), req.userId])
    res.json({ ok: true, interests: clean })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update interests' })
  }
})


router.patch('/me/tags', authenticate, writeLimit, async (req, res) => {
  const { tags } = req.body
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' })
  const clean = tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10)
  try {
    await pool.query('UPDATE users SET tags = ? WHERE id = ?', [JSON.stringify(clean), req.userId])
    res.json({ ok: true, tags: clean })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tags' })
  }
})


router.patch('/me/profile-extended', authenticate, writeLimit, async (req, res) => {
  const { relationship_status, website } = req.body
  const VALID_REL = ['single','in_relationship','married','engaged','open','prefer_not']
  const fields = [], vals = []
  if (relationship_status !== undefined) {
    const rel = VALID_REL.includes(relationship_status) ? relationship_status : null
    fields.push('relationship_status = ?'); vals.push(rel)
  }
  if (website !== undefined) {
    const url = website ? String(website).trim().slice(0, 300) : null
    fields.push('website = ?'); vals.push(url)
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
  try {
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...vals, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})


router.patch('/me/business-profile', authenticate, writeLimit, async (req, res) => {
  const { business_category, business_website, business_hours, business_description_da, business_description_en } = req.body
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    if (business_website) {
      try { new URL(business_website) } catch {
        return res.status(400).json({ error: 'Invalid URL' })
      }
    }
    await pool.query(
      `UPDATE users SET
        business_category = ?,
        business_website = ?,
        business_hours = ?,
        business_description_da = ?,
        business_description_en = ?
       WHERE id = ?`,
      [
        business_category || null,
        business_website || null,
        business_hours || null,
        business_description_da || null,
        business_description_en || null,
        req.userId,
      ]
    )
    res.json({
      ok: true,
      businessCategory: business_category || null,
      businessWebsite: business_website || null,
      businessHours: business_hours || null,
      businessDescription: {
        da: business_description_da || '',
        en: business_description_en || '',
      },
    })
  } catch (err) {
    console.error('PATCH /api/me/business-profile error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/followers', authenticate, async (req, res) => {
  try {
    // Union: explicit user_follows + existing business_follows (deduplicated by user id)
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url AS avatar, u.mode,
              (u.last_active IS NOT NULL AND u.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) AS online,
              EXISTS(SELECT 1 FROM user_follows WHERE follower_id = u.id AND followee_id = ?)
                OR EXISTS(SELECT 1 FROM business_follows WHERE follower_id = u.id AND business_id = ?) AS is_following_back,
              COALESCE(uf.created_at, bf.created_at) AS followed_at
       FROM users u
       LEFT JOIN user_follows uf ON uf.follower_id = u.id AND uf.followee_id = ?
       LEFT JOIN business_follows bf ON bf.follower_id = u.id AND bf.business_id = ?
       WHERE uf.followee_id = ? OR bf.business_id = ?
       ORDER BY followed_at DESC`,
      [req.userId, req.userId, req.userId, req.userId, req.userId, req.userId]
    )
    res.json(rows)
  } catch (err) {
    console.error('GET /api/me/followers error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/following', authenticate, async (req, res) => {
  try {
    // Union user_follows and business_follows so existing BusinessDirectory follows appear
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url AS avatar, u.mode,
              (u.last_active IS NOT NULL AND u.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) AS online,
              'user' AS kind, COALESCE(uf.created_at, bf.created_at) AS followed_at
       FROM users u
       LEFT JOIN user_follows uf ON uf.followee_id = u.id AND uf.follower_id = ?
       LEFT JOIN business_follows bf ON bf.business_id = u.id AND bf.follower_id = ?
       WHERE uf.follower_id = ? OR bf.follower_id = ?
       ORDER BY followed_at DESC`,
      [req.userId, req.userId, req.userId, req.userId]
    )
    // company_follows may not exist on older installations — degrade gracefully
    let companies = []
    try {
      const [rows] = await pool.query(
        `SELECT c.id, c.name, c.logo_url AS avatar, NULL AS mode, NULL AS online, 'company' AS kind
         FROM company_follows cf
         JOIN companies c ON c.id = cf.company_id
         WHERE cf.user_id = ?`,
        [req.userId]
      )
      companies = rows
    } catch (_) { /* company_follows or companies table may not exist */ }
    res.json({ users, companies })
  } catch (err) {
    console.error('GET /api/me/following error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/profile/avatar', authenticate, fileUploadLimit, upload.single('avatar'), async (req, res) => {
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
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'Only image files allowed for profile picture' })
  }
  const avatarUrl = `/uploads/${req.file.filename}`
  try {
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.userId])
    res.json({ avatarUrl })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update avatar' })
  }
})


router.patch('/profile/email', authenticate, writeLimit, async (req, res) => {
  const { newEmail, password, mfaCode } = req.body
  if (!newEmail || !password) return res.status(400).json({ error: 'newEmail and password required' })
  try {
    const [[user]] = await pool.query('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const passwordMatch = user.password_hash && await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) return res.status(401).json({ error: 'Wrong password' })
    // MFA check
    if (user.mfa_enabled) {
      if (!mfaCode) return res.status(403).json({ error: 'mfa_required' })
      const mfaOk = await verifySettingsMfaCode(req.userId, mfaCode)
      if (!mfaOk) return res.status(401).json({ error: 'Invalid or expired MFA code' })
    }
    const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, req.userId])
    if (existing) return res.status(409).json({ error: 'Email already in use' })
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, req.userId])
    res.json({ ok: true, email: newEmail })
  } catch (err) {
    console.error('PATCH /api/profile/email error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/profile/password', authenticate, writeLimit, validate(schemas.changePassword), async (req, res) => {
  const { currentPassword, newPassword, lang: chgLang, mfaCode } = req.body
  const chgPolicy = await getPasswordPolicy()
  const chgPwdErrors = validatePasswordStrength(newPassword, chgPolicy, chgLang || 'da')
  if (chgPwdErrors.length > 0) return res.status(400).json({ error: chgPwdErrors.join('. ') })
  try {
    const [[user]] = await pool.query('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    // If user has no password yet (OAuth only), allow setting without current password
    if (user.password_hash) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword required' })
      const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash)
      if (!passwordMatch) return res.status(401).json({ error: 'Wrong current password' })
    }
    // MFA check
    if (user.mfa_enabled) {
      if (!mfaCode) return res.status(403).json({ error: 'mfa_required' })
      const mfaOk = await verifySettingsMfaCode(req.userId, mfaCode)
      if (!mfaOk) return res.status(401).json({ error: 'Invalid or expired MFA code' })
    }
    const newHash = await bcrypt.hash(newPassword, 10)
    const currentSessionId = getSessionIdFromRequest(req)
    // Update password and clear any pending MFA codes atomically
    await pool.query(
      'UPDATE users SET password_hash = ?, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?',
      [newHash, req.userId]
    )
    // Invalidate all OTHER active sessions — force re-login on other devices
    await pool.query(
      'DELETE FROM sessions WHERE user_id = ? AND id != ?',
      [req.userId, currentSessionId]
    ).catch(() => {}) // non-fatal: sessions table may differ on older installs
    // Audit log: password changed
    await auditLog(req, 'password_change', 'user', req.userId, { status: 'success' })
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile/password error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/settings/sessions', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  try {
    const [rows] = await pool.query(
      `SELECT id, lang, user_agent, ip_address, created_at, expires_at,
              (id = ?) AS is_current
       FROM sessions WHERE user_id = ? AND expires_at > NOW() AND id NOT LIKE 'reset:%'
       ORDER BY is_current DESC, created_at DESC`,
      [sessionId, req.userId]
    )
    res.json({ sessions: rows })
  } catch (err) {
    console.error('GET /api/settings/sessions error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/settings/sessions/others', authenticate, writeLimit, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.userId, sessionId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/settings/sessions/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const [[session]] = await pool.query('SELECT user_id FROM sessions WHERE id = ?', [req.params.id])
    if (!session || session.user_id !== req.userId) return res.status(404).json({ error: 'Not found' })
    await pool.query('DELETE FROM sessions WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/settings/privacy', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `SELECT profile_visibility, friend_request_privacy, post_default_visibility,
              message_privacy, comment_privacy, searchable, show_online_status,
              analytics_opt_out, allow_tagging, friend_list_visibility
       FROM users WHERE id = ?`,
      [req.userId]
    )
    res.json({
      profile_visibility:       user?.profile_visibility       || 'all',
      friend_request_privacy:   user?.friend_request_privacy   || 'all',
      post_default_visibility:  user?.post_default_visibility  || 'all',
      message_privacy:          user?.message_privacy          || 'all',
      comment_privacy:          user?.comment_privacy          || 'all',
      searchable:               user?.searchable               ?? 1,
      show_online_status:       user?.show_online_status       ?? 1,
      analytics_opt_out:        user?.analytics_opt_out        ?? 0,
      allow_tagging:            user?.allow_tagging            ?? 1,
      friend_list_visibility:   user?.friend_list_visibility   || 'all',
    })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/settings/privacy', authenticate, async (req, res) => {
  const {
    profile_visibility, friend_request_privacy, post_default_visibility,
    message_privacy, comment_privacy, searchable, show_online_status,
    analytics_opt_out, allow_tagging, friend_list_visibility,
  } = req.body
  const fields = []
  const vals = []
  const enumCol = (v, allowed, col) => { if (allowed.includes(v)) { fields.push(`${col} = ?`); vals.push(v) } }
  const boolCol = (v, col) => { if (v !== undefined) { fields.push(`${col} = ?`); vals.push(v ? 1 : 0) } }
  enumCol(profile_visibility,      ['all','friends'],                          'profile_visibility')
  enumCol(friend_request_privacy,  ['all','friends_of_friends'],               'friend_request_privacy')
  enumCol(post_default_visibility, ['all','friends','only_me'],                'post_default_visibility')
  enumCol(message_privacy,         ['all','friends'],                          'message_privacy')
  enumCol(comment_privacy,         ['all','friends'],                          'comment_privacy')
  enumCol(friend_list_visibility,  ['all','friends','only_me'],                'friend_list_visibility')
  boolCol(searchable,        'searchable')
  boolCol(show_online_status,'show_online_status')
  boolCol(analytics_opt_out, 'analytics_opt_out')
  boolCol(allow_tagging,     'allow_tagging')
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
  try {
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...vals, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


const NAV_VALID_IDS = new Set(['messages', 'events', 'friends', 'groups', 'explore', 'calendar', 'saved-posts', 'marketplace', 'jobs', 'business-hub'])

router.get('/settings/nav', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT nav_order FROM users WHERE id = ?', [req.userId])
    const raw = user?.nav_order
    res.json({ navOrder: raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null })
  } catch (err) {
    console.error('GET /api/settings/nav error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.patch('/settings/nav', authenticate, writeLimit, async (req, res) => {
  const { main, more } = req.body
  if (!Array.isArray(main) || !Array.isArray(more)) return res.status(400).json({ error: 'Invalid nav order' })
  if (![...main, ...more].every(id => NAV_VALID_IDS.has(id))) return res.status(400).json({ error: 'Invalid nav item' })
  if (main.length > 5) return res.status(400).json({ error: 'Too many main tabs' })
  try {
    await pool.query('UPDATE users SET nav_order = ? WHERE id = ?', [JSON.stringify({ main, more }), req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/settings/nav error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/subscription', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const [[adSettings]] = await pool.query('SELECT adfree_price_private, adfree_price_business, adfree_recurring_pct, adfree_annual_discount_pct, currency, ads_enabled FROM admin_ad_settings WHERE id = 1').catch(() => [[{ adfree_price_private: 29, adfree_price_business: 49, adfree_recurring_pct: 100, adfree_annual_discount_pct: 0, currency: 'EUR', ads_enabled: 1 }]])
    const price = parseFloat(user.mode === 'business' ? adSettings?.adfree_price_business : adSettings?.adfree_price_private) || 29
    const recurringPct = parseInt(adSettings?.adfree_recurring_pct ?? 100)
    const recurringPrice = Math.round(price * recurringPct / 100 * 100) / 100
    const annualDiscountPct = parseInt(adSettings?.adfree_annual_discount_pct ?? 0)
    const annualPrice = Math.round(recurringPrice * 12 * (1 - annualDiscountPct / 100) * 100) / 100

    // Include Mollie subscription status
    const [[sub]] = await pool.query(
      `SELECT plan, status, expires_at, recurring, mollie_subscription_id
       FROM subscriptions WHERE user_id = ? AND plan != 'ad_activation'
       ORDER BY recurring DESC, created_at DESC LIMIT 1`,
      [req.userId]
    ).catch(() => [[null]])

    // Compute ads_free dynamically — only active purchased periods or activated earned-day
    // assignments count. Days sitting in the bank (not yet assigned) do NOT make a user ad-free.
    const today = new Date().toISOString().split('T')[0]
    const [[adFreeRow]] = await pool.query(`
      SELECT (
        (SELECT COUNT(*) FROM adfree_day_assignments
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
        (SELECT COUNT(*) FROM adfree_purchased_periods
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
      ) AS total
    `, [req.userId, today, today, req.userId, today, today]).catch(() => [[{ total: 0 }]])
    const ads_free = (adFreeRow?.total ?? 0) > 0

    res.json({
      ads_free,
      price,
      recurring_price: recurringPrice,
      recurring_pct: recurringPct,
      annual_price: annualPrice,
      annual_discount_pct: annualDiscountPct,
      currency: adSettings?.currency || 'EUR',
      ads_enabled: Boolean(adSettings?.ads_enabled),
      plan: sub?.plan || null,
      status: sub?.status || null,
      expires_at: sub?.expires_at || null,
      recurring: Boolean(sub?.recurring),
      has_subscription: !!sub?.mollie_subscription_id,
    })
  } catch (err) {
    console.error('GET /api/me/subscription error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/profile/birthday', authenticate, async (req, res) => {
  try {
    const { birthday } = req.body
    // Accepts ISO date string 'YYYY-MM-DD' or null to clear
    const value = birthday ? birthday : null
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return res.status(400).json({ error: 'Invalid date format, use YYYY-MM-DD' })
    }
    await pool.query('UPDATE users SET birthday = ? WHERE id = ?', [value, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile/birthday error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/profile/public', authenticate, async (req, res) => {
  const { isPublic } = req.body
  if (typeof isPublic !== 'boolean') return res.status(400).json({ error: 'isPublic must be boolean' })
  try {
    await pool.query('UPDATE users SET profile_public = ? WHERE id = ?', [isPublic ? 1 : 0, req.userId])
    res.json({ ok: true, isPublic })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/heartbeat', authenticate, async (req, res) => {
  pool.query('UPDATE users SET last_active = NOW() WHERE id = ?', [req.userId]).catch(() => {})
  recordLoginDay(req.userId).catch(() => {})
  res.json({ ok: true })
})


router.patch('/profile', authenticate, async (req, res) => {
  const { name, bio_da, bio_en, location, industry, seniority, job_title, company, mobilepay } = req.body
  try {
    const fields = [], vals = []
    if (name !== undefined)      { fields.push('name = ?');      vals.push(name.trim()) }
    if (bio_da !== undefined)    { fields.push('bio_da = ?');    vals.push(bio_da) }
    if (bio_en !== undefined)    { fields.push('bio_en = ?');    vals.push(bio_en) }
    if (location !== undefined)  { fields.push('location = ?');  vals.push(location) }
    if (industry !== undefined)  { fields.push('industry = ?');  vals.push(industry ? String(industry).trim().slice(0, 100) : null) }
    if (seniority !== undefined) { fields.push('seniority = ?'); vals.push(seniority || null) }
    if (job_title !== undefined) { fields.push('job_title = ?'); vals.push(job_title ? String(job_title).trim().slice(0, 100) : null) }
    if (company !== undefined)   { fields.push('company = ?');   vals.push(company ? String(company).trim().slice(0, 100) : null) }
    if (mobilepay !== undefined) {
      const clean = mobilepay ? String(mobilepay).replace(/\D/g, '').slice(0, 8) : ''
      fields.push('mobilepay = ?'); vals.push(clean || null)
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
    vals.push(req.userId)
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals)
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/profile error:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})


router.get('/me/notification-preferences', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT type, enabled FROM notification_preferences WHERE user_id = ?',
      [req.userId]
    )
    const prefs = {}
    for (const r of rows) prefs[r.type] = Boolean(r.enabled)
    res.json({ prefs })
  } catch {
    res.json({ prefs: {} })
  }
})


router.put('/me/notification-preferences', authenticate, async (req, res) => {
  const { prefs } = req.body
  if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'Invalid prefs' })
  try {
    for (const [type, enabled] of Object.entries(prefs)) {
      const val = enabled ? 1 : 0
      await pool.query(
        'INSERT INTO notification_preferences (user_id, type, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = ?',
        [req.userId, type, val, val]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/me/notification-preferences]', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/blocks', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, ub.created_at AS blocked_at
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = ?
       ORDER BY ub.created_at DESC`,
      [req.userId]
    )
    res.json({ blocks: rows })
  } catch (err) {
    console.error('GET /api/me/blocks error:', err)
    res.status(500).json({ error: 'Failed to load blocks' })
  }
})


router.get('/me/interest-graph', authenticate, async (req, res) => {
  try {
    const [scores] = await pool.query(`
      SELECT interest_slug, context, weight, explicit_set, last_signal_at, updated_at
      FROM interest_scores
      WHERE user_id = ?
      ORDER BY weight DESC
    `, [req.userId])

    // Seed explicit interests with initial score 50 if not yet tracked
    const [[user]] = await pool.query('SELECT interests FROM users WHERE id=?', [req.userId]).catch(() => [[null]])
    const explicit = user?.interests ? (Array.isArray(user.interests) ? user.interests : JSON.parse(user.interests)) : []

    const scoreMap = new Set(scores.map(s => `${s.interest_slug}:${s.context}`))
    const missing = []
    for (const slug of explicit) {
      if (!scoreMap.has(`${slug}:hobby`)) {
        missing.push({ user_id: req.userId, interest_slug: slug, context: 'hobby', weight: 50, explicit_set: 1 })
      }
    }
    if (missing.length > 0) {
      const vals = missing.map(m => [m.user_id, m.interest_slug, m.context, m.weight, m.explicit_set])
      await pool.query(
        'INSERT IGNORE INTO interest_scores (user_id, interest_slug, context, weight, explicit_set) VALUES ?',
        [vals]
      )
      // Re-fetch after seeding
      const [fresh] = await pool.query(
        'SELECT interest_slug, context, weight, explicit_set, last_signal_at, updated_at FROM interest_scores WHERE user_id=? ORDER BY weight DESC',
        [req.userId]
      )
      return res.json({ scores: fresh, explicit })
    }

    res.json({ scores, explicit })
  } catch (err) {
    console.error('GET /api/me/interest-graph error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/me/interest-graph/:slug', authenticate, async (req, res) => {
  try {
    const { slug } = req.params
    const { weight, context = 'hobby' } = req.body
    if (typeof weight !== 'number' || weight < 0 || weight > 100) {
      return res.status(400).json({ error: 'weight must be a number between 0 and 100' })
    }
    const ctx = ['professional', 'hobby', 'purchase'].includes(context) ? context : 'hobby'
    await pool.query(
      `INSERT INTO interest_scores (user_id, interest_slug, context, weight, explicit_set, last_signal_at)
       VALUES (?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE weight=?, explicit_set=1, last_signal_at=NOW()`,
      [req.userId, slug, ctx, weight, weight]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/me/interest-graph/:slug error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/interest-graph/signal-stats', authenticate, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT interest_slug, signal_type, COUNT(*) as cnt, MAX(created_at) as last_at
      FROM interest_signals
      WHERE user_id = ? AND created_at > NOW() - INTERVAL 30 DAY
      GROUP BY interest_slug, signal_type
      ORDER BY cnt DESC
    `, [req.userId])
    res.json({ stats })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/stream-key', authenticate, async (req, res) => {
  try {
    let [[user]] = await pool.query('SELECT stream_key FROM users WHERE id = ?', [req.userId])
    if (!user.stream_key) {
      const key = crypto.randomBytes(24).toString('hex')
      await pool.query('UPDATE users SET stream_key = ? WHERE id = ?', [key, req.userId])
      user = { stream_key: key }
    }
    const siteUrl   = process.env.SITE_URL || 'https://fellis.eu'
    const rtmpHost  = new URL(siteUrl).hostname
    const rtmpUrl   = `rtmp://${rtmpHost}:${RTMP_PORT}/live`
    res.json({ stream_key: user.stream_key, rtmp_url: rtmpUrl })
  } catch (err) {
    console.error('GET /api/me/stream-key error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/stream-key/regenerate', authenticate, async (req, res) => {
  try {
    const key = crypto.randomBytes(24).toString('hex')
    await pool.query('UPDATE users SET stream_key = ? WHERE id = ?', [key, req.userId])
    const siteUrl  = process.env.SITE_URL || 'https://fellis.eu'
    const rtmpHost = new URL(siteUrl).hostname
    const rtmpUrl  = `rtmp://${rtmpHost}:${RTMP_PORT}/live`
    res.json({ stream_key: key, rtmp_url: rtmpUrl })
  } catch (err) {
    console.error('POST /api/me/stream-key/regenerate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/profile/cover', authenticate, fileUploadLimit, coverUpload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const url = `/uploads/${req.file.filename}`
    await pool.query('UPDATE users SET cover_photo_url=? WHERE id=?', [url, req.userId])
    res.json({ ok: true, cover_photo_url: url })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/profile/cover', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE users SET cover_photo_url=NULL WHERE id=?', [req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/profile/pinned-post', authenticate, async (req, res) => {
  try {
    const { post_id } = req.body
    if (post_id) {
      const [[post]] = await pool.query('SELECT user_id FROM posts WHERE id=?', [post_id])
      if (!post || post.user_id !== req.userId)
        return res.status(403).json({ error: 'Forbidden' })
    }
    await pool.query('UPDATE users SET pinned_post_id=? WHERE id=?', [post_id || null, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/hashtag-follows', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT hashtag, created_at FROM hashtag_follows WHERE user_id=? ORDER BY hashtag ASC',
      [req.userId]
    )
    res.json({ hashtags: rows.map(r => r.hashtag) })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/story-highlights', authenticate, async (req, res) => {
  try {
    const [highlights] = await pool.query(
      'SELECT * FROM story_highlights WHERE user_id=? ORDER BY created_at DESC',
      [req.userId]
    )
    for (const h of highlights) {
      const [items] = await pool.query(
        `SELECT shi.story_id, s.content_text, s.bg_color, s.created_at
         FROM story_highlight_items shi
         JOIN stories s ON s.id=shi.story_id
         WHERE shi.highlight_id=?
         ORDER BY s.created_at DESC`,
        [h.id]
      )
      h.stories = items
    }
    res.json({ highlights })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/job-alerts', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM job_alerts WHERE user_id=? ORDER BY created_at DESC',
      [req.userId]
    )
    res.json({ alerts: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/job-alerts', authenticate, writeLimit, async (req, res) => {
  try {
    const { query, location, job_type, frequency } = req.body
    const [r] = await pool.query(
      'INSERT INTO job_alerts (user_id, query, location, job_type, frequency) VALUES (?,?,?,?,?)',
      [req.userId, query || null, location || null, job_type || null, frequency || 'weekly']
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/job-alerts/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM job_alerts WHERE id=? AND user_id=?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/marketplace-alerts', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM marketplace_keyword_alerts WHERE user_id=? ORDER BY created_at DESC',
      [req.userId]
    )
    res.json({ alerts: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/marketplace-alerts', authenticate, writeLimit, async (req, res) => {
  try {
    let { keyword } = req.body
    if (!keyword || typeof keyword !== 'string') return res.status(400).json({ error: 'Missing keyword' })
    keyword = keyword.trim().toLowerCase().slice(0, 100)
    if (!keyword) return res.status(400).json({ error: 'Missing keyword' })
    const [r] = await pool.query(
      'INSERT IGNORE INTO marketplace_keyword_alerts (user_id, keyword) VALUES (?,?)',
      [req.userId, keyword]
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/me/marketplace-alerts/:id', authenticate, writeLimit, async (req, res) => {
  try {
    let { keyword } = req.body
    if (!keyword || typeof keyword !== 'string') return res.status(400).json({ error: 'Missing keyword' })
    keyword = keyword.trim().toLowerCase().slice(0, 100)
    if (!keyword) return res.status(400).json({ error: 'Missing keyword' })
    await pool.query(
      'UPDATE marketplace_keyword_alerts SET keyword=? WHERE id=? AND user_id=?',
      [keyword, req.params.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/marketplace-alerts/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM marketplace_keyword_alerts WHERE id=? AND user_id=?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/portfolio', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM user_portfolio WHERE user_id=? ORDER BY sort_order ASC, created_at DESC',
      [req.userId]
    )
    res.json({ items: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/portfolio', authenticate, writeLimit, async (req, res) => {
  try {
    const { title, description, url, image_url } = req.body
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' })
    const [[maxOrder]] = await pool.query(
      'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM user_portfolio WHERE user_id=?',
      [req.userId]
    )
    const [r] = await pool.query(
      'INSERT INTO user_portfolio (user_id, title, description, url, image_url, sort_order) VALUES (?,?,?,?,?,?)',
      [req.userId, title.trim(), description || null, url || null, image_url || null, maxOrder.next]
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/me/portfolio/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const { title, description, url, image_url } = req.body
    await pool.query(
      'UPDATE user_portfolio SET title=?, description=?, url=?, image_url=? WHERE id=? AND user_id=?',
      [title, description || null, url || null, image_url || null, req.params.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/portfolio/:id', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_portfolio WHERE id=? AND user_id=?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/business-leads', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    const [leads] = await pool.query(
      `SELECT ul.*, u.name AS sender_name, u.handle AS sender_handle, u.avatar_url AS sender_avatar
       FROM user_leads ul JOIN users u ON u.id = ul.sender_id
       WHERE ul.business_user_id = ? ORDER BY ul.created_at DESC`,
      [req.userId]
    )
    res.json({ leads })
  } catch (err) {
    console.error('GET /api/me/business-leads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/me/business-leads/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const { status } = req.body
    if (!['new', 'responded', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    await pool.query(
      'UPDATE user_leads SET status = ? WHERE id = ? AND business_user_id = ?',
      [status, req.params.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/me/business-leads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/verify-business/lookup', authenticate, async (req, res) => {
  const cvr = (req.query.cvr || '').trim().replace(/[\s\-]/g, '')
  if (!/^\d{8}$/.test(cvr) || !isValidCVRChecksum(cvr)) return res.status(400).json({ error: 'cvr_format' })
  const data = await lookupCVR(cvr)
  if (data.unavailable) return res.status(503).json({ error: 'cvr_api_unavailable', detail: { status: data.status, apiError: data.apiError } })
  res.json(data)
})


router.post('/me/verify-business', authenticate, writeLimit, async (req, res) => {
  try {
    const { cvr_number } = req.body
    if (!cvr_number?.trim()) return res.status(400).json({ error: 'CVR number required' })
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })

    const cleaned = cvr_number.trim().replace(/[\s\-]/g, '')
    if (!/^\d{8}$/.test(cleaned)) return res.status(422).json({ error: 'cvr_format' })

    // Modulo-11 checksum — rejects mathematically invalid numbers instantly
    if (!isValidCVRChecksum(cleaned)) return res.status(422).json({ error: 'cvr_format' })

    const [[taken]] = await pool.query(
      'SELECT id FROM users WHERE cvr_number = ? AND is_verified = 1 AND id != ?',
      [cleaned, req.userId]
    )
    if (taken) {
      await auditLog(req, 'cvr_verification_failed', 'user', req.userId, {
        status: 'failure',
        details: { cvr_number: cleaned, reason: 'cvr_taken' },
      })
      return res.status(409).json({ error: 'cvr_taken' })
    }

    // Best-effort registry lookup for company name — approval does NOT depend on this
    const cvrData = await lookupCVR(cleaned)
    const companyName = cvrData.unavailable ? null : (cvrData.name || null)

    if (cvrData.unavailable) {
      await pool.query('UPDATE users SET cvr_number = ?, is_verified = 0 WHERE id = ?', [cleaned, req.userId])
      await auditLog(req, 'cvr_verification_pending', 'user', req.userId, {
        status: 'success',
        details: { cvr_number: cleaned, reason: 'api_unavailable', api_status: cvrData.status, api_error: cvrData.apiError },
      })
      return res.json({ ok: true, pending: true })
    }

    await pool.query(
      'UPDATE users SET cvr_number = ?, is_verified = 1, cvr_company_name = ? WHERE id = ?',
      [cleaned, companyName, req.userId]
    )
    await auditLog(req, 'cvr_verification_success', 'user', req.userId, {
      status: 'success',
      newValue: { cvr_number: cleaned, company_name: cvrData.name, industry: cvrData.industry },
    })
    res.json({ ok: true, pending: false, companyName: cvrData.name, industry: cvrData.industry })
  } catch (err) {
    console.error('POST /api/me/verify-business error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/announcements', authenticate, writeLimit, async (req, res) => {
  try {
    const { title, body, cta_url } = req.body
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body required' })
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    if (cta_url) {
      try { new URL(cta_url) } catch { return res.status(400).json({ error: 'Invalid URL' }) }
    }
    const [result] = await pool.query(
      'INSERT INTO business_announcements (author_id, title, body, cta_url) VALUES (?, ?, ?, ?)',
      [req.userId, title.trim(), body.trim(), cta_url?.trim() || null]
    )
    // Notify followers via notifications table
    pool.query(
      `INSERT INTO notifications (user_id, type, actor_id, payload)
       SELECT bf.follower_id, 'business_announcement', ?, JSON_OBJECT('announcement_id', ?, 'title', ?)
       FROM business_follows bf WHERE bf.business_id = ?`,
      [req.userId, result.insertId, title.trim(), req.userId]
    ).catch(() => {})
    res.json({ ok: true, id: result.insertId })
  } catch (err) {
    console.error('POST /api/me/announcements error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/announcements', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM business_announcements WHERE author_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    )
    res.json({ announcements: rows })
  } catch (err) {
    console.error('GET /api/me/announcements error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/announcements/:id', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM business_announcements WHERE id = ? AND author_id = ?',
      [req.params.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/me/announcements/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/services', authenticate, async (req, res) => {
  try {
    const [services] = await pool.query(
      'SELECT * FROM business_services WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
      [req.userId]
    )
    res.json({ services })
  } catch (err) {
    console.error('GET /api/me/services error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/me/services', authenticate, writeLimit, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode !== 'business') return res.status(403).json({ error: 'Business account required' })
    const { name_da, name_en, description_da, description_en, price_from, price_to, image_url } = req.body
    if (!name_da?.trim() || !name_en?.trim()) return res.status(400).json({ error: 'Service name required in both languages' })
    const [result] = await pool.query(
      `INSERT INTO business_services (user_id, name_da, name_en, description_da, description_en, price_from, price_to, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, name_da.trim(), name_en.trim(),
       description_da?.trim() || null, description_en?.trim() || null,
       price_from ? parseFloat(price_from) : null,
       price_to ? parseFloat(price_to) : null,
       image_url?.trim() || null]
    )
    const [[svc]] = await pool.query('SELECT * FROM business_services WHERE id = ?', [result.insertId])
    res.json({ service: svc })
  } catch (err) {
    console.error('POST /api/me/services error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/me/services/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const { name_da, name_en, description_da, description_en, price_from, price_to, image_url, sort_order } = req.body
    if (!name_da?.trim() || !name_en?.trim()) return res.status(400).json({ error: 'Service name required in both languages' })
    await pool.query(
      `UPDATE business_services SET name_da=?, name_en=?, description_da=?, description_en=?,
       price_from=?, price_to=?, image_url=?, sort_order=? WHERE id=? AND user_id=?`,
      [name_da.trim(), name_en.trim(),
       description_da?.trim() || null, description_en?.trim() || null,
       price_from ? parseFloat(price_from) : null,
       price_to ? parseFloat(price_to) : null,
       image_url?.trim() || null,
       sort_order ?? 0,
       req.params.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/me/services/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/services/:id', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query('DELETE FROM business_services WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/me/services/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/analytics/follower-growth', authenticate, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const [rows] = await pool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [req.userId, days]
    )
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM business_follows WHERE business_id = ?',
      [req.userId]
    )
    res.json({ growth: rows, total })
  } catch (err) {
    console.error('GET /api/me/analytics/follower-growth error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/analytics/best-times', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DAYOFWEEK(pl.created_at) AS dow, HOUR(pl.created_at) AS hour, COUNT(*) AS engagements
       FROM post_likes pl JOIN posts p ON p.id = pl.post_id
       WHERE p.author_id = ? AND pl.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY dow, hour
       UNION ALL
       SELECT DAYOFWEEK(c.created_at) AS dow, HOUR(c.created_at) AS hour, COUNT(*) AS engagements
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE p.author_id = ? AND c.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY dow, hour`,
      [req.userId, req.userId]
    )
    // Aggregate union results
    const map = {}
    for (const r of rows) {
      const k = `${r.dow}-${r.hour}`
      map[k] = (map[k] || { dow: r.dow, hour: r.hour, engagements: 0 })
      map[k].engagements += Number(r.engagements)
    }
    res.json({ heatmap: Object.values(map) })
  } catch (err) {
    console.error('GET /api/me/analytics/best-times error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/partner-requests', authenticate, async (req, res) => {
  try {
    const [requests] = await pool.query(
      `SELECT bp.id, bp.requester_id, bp.created_at,
              u.name AS requester_name, u.handle AS requester_handle, u.avatar_url AS requester_avatar,
              u.business_category AS requester_category, u.is_verified AS requester_verified
       FROM business_partnerships bp JOIN users u ON u.id = bp.requester_id
       WHERE bp.partner_id = ? AND bp.status = 'pending'
       ORDER BY bp.created_at DESC`,
      [req.userId]
    )
    res.json({ requests })
  } catch (err) {
    console.error('GET /api/me/partner-requests error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/me/partner-requests/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const { action } = req.body
    if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action' })
    const [[req_row]] = await pool.query(
      "SELECT requester_id FROM business_partnerships WHERE id = ? AND partner_id = ? AND status = 'pending'",
      [req.params.id, req.userId]
    )
    if (!req_row) return res.status(404).json({ error: 'Request not found' })
    const newStatus = action === 'accept' ? 'accepted' : 'declined'
    await pool.query('UPDATE business_partnerships SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, req.params.id])
    if (action === 'accept') {
      pool.query(
        `INSERT INTO notifications (user_id, type, actor_id, payload)
         VALUES (?, 'partner_accepted', ?, JSON_OBJECT('partner_id', ?))`,
        [req_row.requester_id, req.userId, req.userId]
      ).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/me/partner-requests/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/me/partners', authenticate, async (req, res) => {
  try {
    const [partners] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, u.business_category, u.is_verified, u.community_score, bp.created_at AS partnered_since
       FROM business_partnerships bp
       JOIN users u ON u.id = IF(bp.requester_id = ?, bp.partner_id, bp.requester_id)
       WHERE (bp.requester_id = ? OR bp.partner_id = ?) AND bp.status = 'accepted'
       ORDER BY bp.updated_at DESC`,
      [req.userId, req.userId, req.userId]
    )
    res.json({ partners })
  } catch (err) {
    console.error('GET /api/me/partners error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/me/partners/:partnerId', authenticate, writeLimit, async (req, res) => {
  try {
    const pId = parseInt(req.params.partnerId)
    await pool.query(
      `DELETE FROM business_partnerships
       WHERE status = 'accepted' AND (
         (requester_id = ? AND partner_id = ?) OR (requester_id = ? AND partner_id = ?)
       )`,
      [req.userId, pId, pId, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/me/partners/:partnerId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/profile/:id/checkins', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.id)
  const authId = req.userId
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.place_name, p.geo_lat, p.geo_lng, p.created_at, p.text_da, p.text_en,
              (
                SELECT COUNT(DISTINCT p2.author_id)
                FROM posts p2
                JOIN friendships f ON f.friend_id = p2.author_id AND f.user_id = ?
                WHERE p2.geo_lat IS NOT NULL
                  AND p2.geo_lng IS NOT NULL
                  AND p2.scheduled_at IS NULL
                  AND ABS(p2.geo_lat - p.geo_lat) < 0.001
                  AND ABS(p2.geo_lng - p.geo_lng) < 0.0016
                  AND ABS(TIMESTAMPDIFF(MINUTE, p2.created_at, p.created_at)) <= 120
                  AND p2.author_id != p.author_id
              ) AS connection_count
       FROM posts p
       WHERE p.author_id = ?
         AND p.geo_lat IS NOT NULL
         AND p.geo_lng IS NOT NULL
         AND p.scheduled_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT 30`,
      [authId, targetId]
    )
    res.json(rows.map(r => ({
      id: r.id,
      place_name: r.place_name || null,
      geo_lat: r.geo_lat,
      geo_lng: r.geo_lng,
      created_at: r.created_at,
      text_da: r.text_da || null,
      text_en: r.text_en || null,
      connection_count: Number(r.connection_count),
    })))
  } catch (err) {
    console.error('GET /api/profile/:id/checkins error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
