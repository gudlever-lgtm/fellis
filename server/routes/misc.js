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
  formatPostTime, formatMsgTime, applySignals, autoSignalPost, SIGNAL_VALUES,
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
  BADGE_THRESHOLDS,
} from '../middleware.js'
import { requireFeature } from '../middleware/requireFeature.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from '../livestream.js'
import {
  getConversationForUser, verifySettingsMfaCode, getMollieClient,
  callMistral, buildTemplateCV, buildTemplateLetter,
  recordLoginDay, computeUserStats, generateStreamKey,
  selectAdsForUser,
} from '../helpers.js'
import { moderateContent } from '../moderation.js'

const router = express.Router()

let nominatimLastCall = 0




router.get('/health', async (_req, res) => {
  let dbOk = false
  try {
    await pool.query('SELECT 1')
    dbOk = true
  } catch {}
  const uptimeSec = Math.floor((Date.now() - SERVER_START) / 1000)
  const status = dbOk ? 200 : 503
  res.status(status).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'error',
    uptime_sec: uptimeSec,
    ts: new Date().toISOString(),
  })
})


router.post('/visit', async (req, res) => {
  try {
    const ip = (req.ip || '').replace(/^::ffff:/, '')
    const today = new Date().toISOString().slice(0, 10)
    const key = `${ip}:${today}`
    if (ip && !visitedAnonIps.has(key)) {
      visitedAnonIps.add(key)
      const ua = req.headers['user-agent'] || null
      const { browser, os } = parseBrowser(ua)
      const sessionId = getSessionIdFromRequest(req) || `anon:${ip}`
      getGeoForIp(ip).then(geo => {
        pool.query(
          `INSERT INTO site_visits (session_id, ip_address, user_agent, browser, os, country, country_code, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, ip || null, ua, browser, os, geo.country, geo.country_code, geo.city]
        ).catch(() => {})
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/skills/:userId', authenticate, async (req, res) => {
  try {
    const [skills] = await pool.query(
      `SELECT s.id, s.name,
              COUNT(e.endorser_id) AS endorsement_count,
              MAX(e.endorser_id = ?) AS endorsed_by_me
       FROM user_skills s
       LEFT JOIN skill_endorsements e ON e.skill_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id, s.name
       ORDER BY s.display_order, s.id`,
      [req.userId, req.params.userId]
    )
    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/skills/:skillId/endorsers', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM skill_endorsements e JOIN users u ON u.id = e.endorser_id
       WHERE e.skill_id = ?`,
      [req.params.skillId]
    )
    res.json({ endorsers: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/skills', authenticate, async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    const [existing] = await pool.query('SELECT COUNT(*) AS n FROM user_skills WHERE user_id = ?', [req.userId])
    if (existing[0].n >= 20) return res.status(400).json({ error: 'Max 20 skills' })
    const [result] = await pool.query(
      'INSERT INTO user_skills (user_id, name) VALUES (?, ?)',
      [req.userId, name.trim()]
    )
    res.json({ id: result.insertId, name: name.trim(), endorsement_count: 0, endorsed_by_me: false })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Skill already exists' })
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/skills/:id', authenticate, async (req, res) => {
  try {
    const [[skill]] = await pool.query('SELECT user_id FROM user_skills WHERE id = ?', [req.params.id])
    if (!skill || skill.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM skill_endorsements WHERE skill_id = ?', [req.params.id])
    await pool.query('DELETE FROM user_skills WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/skills/:id/endorse', authenticate, writeLimit, async (req, res) => {
  try {
    const [[skill]] = await pool.query('SELECT user_id FROM user_skills WHERE id = ?', [req.params.id])
    if (!skill) return res.status(404).json({ error: 'Not found' })
    if (skill.user_id === req.userId) return res.status(400).json({ error: 'Cannot endorse own skill' })
    const [[existing]] = await pool.query(
      'SELECT 1 FROM skill_endorsements WHERE skill_id = ? AND endorser_id = ?',
      [req.params.id, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM skill_endorsements WHERE skill_id = ? AND endorser_id = ?', [req.params.id, req.userId])
      res.json({ endorsed: false })
    } else {
      await pool.query('INSERT INTO skill_endorsements (skill_id, endorser_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ endorsed: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/visitor-stats', authenticate, async (req, res) => {
  try {
    const [browsers] = await pool.query(
      `SELECT browser, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND browser != 'Unknown'
       GROUP BY browser ORDER BY count DESC`
    )
    const [oses] = await pool.query(
      `SELECT os, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY os ORDER BY count DESC`
    )
    const [countries] = await pool.query(
      `SELECT country, country_code, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND country_code IS NOT NULL AND country_code != 'XX'
       GROUP BY country_code, country ORDER BY count DESC LIMIT 30`
    )
    const [daily] = await pool.query(
      `SELECT DATE(visited_at) AS date, COUNT(*) AS count FROM site_visits
       WHERE visited_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(visited_at) ORDER BY date ASC`
    )
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM site_visits')
    res.json({ browsers, oses, countries, daily, total })
  } catch (err) {
    console.error('GET /api/visitor-stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/invite/:token', async (req, res) => {
  const { token } = req.params
  try {
    const [users] = await pool.query(
      'SELECT id, name, avatar_url FROM users WHERE invite_token = ?',
      [token]
    )
    if (users.length > 0) {
      return res.json({ inviter: { name: users[0].name, avatarUrl: users[0].avatar_url } })
    }
    const [invitations] = await pool.query(
      `SELECT u.name, u.avatar_url FROM invitations i
       JOIN users u ON i.inviter_id = u.id
       WHERE i.invite_token = ? AND i.status = 'pending'`,
      [token]
    )
    if (invitations.length > 0) {
      return res.json({ inviter: { name: invitations[0].name, avatarUrl: invitations[0].avatar_url } })
    }
    res.status(404).json({ error: 'Invite not found' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invite' })
  }
})


router.get('/invites/link', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT invite_token FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    let token = users[0].invite_token
    if (!token) {
      token = crypto.randomBytes(32).toString('hex')
      await pool.query('UPDATE users SET invite_token = ? WHERE id = ?', [token, req.userId])
    }
    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get invite link' })
  }
})


router.post('/invites', authenticate, writeLimit, async (req, res) => {
  const { friends } = req.body
  if (!friends?.length) return res.status(400).json({ error: 'No friends selected' })
  try {
    // Get inviter info and their personal invite link
    const [[inviter]] = await pool.query('SELECT name, invite_token FROM users WHERE id = ?', [req.userId])
    const siteBase = process.env.SITE_URL || 'https://fellis.eu'
    const created = []
    for (const friend of friends) {
      // friend can be a string (email) or object { name, email }
      const email = typeof friend === 'string' ? friend : (friend.email || null)
      const name  = typeof friend === 'string' ? null   : (friend.name  || null)
      const token = crypto.randomBytes(32).toString('hex')
      const [insertResult] = await pool.query(
        'INSERT INTO invitations (inviter_id, invite_token, invitee_name, invitee_email) VALUES (?, ?, ?, ?)',
        [req.userId, token, name || email, email]
      )
      const inviteUrl = `${siteBase}/?invite=${inviter.invite_token || token}`
      // Send email if SMTP is configured and we have a recipient address
      if (mailer && email) {
        const fromName = inviter.name || 'Fellis'
        const fromAddr = process.env.MAIL_FROM || process.env.MAIL_USER
        await mailer.sendMail({
          from: `"${fromName} via Fellis" <${fromAddr}>`,
          to: email,
          subject: `${inviter.name || 'En ven'} har inviteret dig til Fellis`,
          text: `Hej!\n\n${inviter.name || 'En ven'} vil gerne forbindes med dig på Fellis.\n\nKlik her for at oprette din konto:\n${inviteUrl}\n\nVenlig hilsen,\nFellis`,
          html: `<p>Hej!</p><p><strong>${inviter.name || 'En ven'}</strong> vil gerne forbindes med dig på <strong>Fellis</strong>.</p><p><a href="${inviteUrl}" style="background:#2D6A4F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Opret konto og forbind</a></p><p style="color:#888;font-size:12px">Eller kopier dette link: ${inviteUrl}</p>`,
        }).catch(err => console.error('Mail send error:', err.message))
      }
      created.push({ id: insertResult.insertId, name: name || email, email, token, inviteUrl })
    }
    res.json({ invitations: created, count: created.length, emailSent: !!(mailer) })
  } catch (err) {
    console.error('POST /api/invites error:', err.message)
    res.status(500).json({ error: 'Failed to create invitations' })
  }
})


router.delete('/invites/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const [[inv]] = await pool.query('SELECT inviter_id FROM invitations WHERE id = ?', [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Not found' })
    if (inv.inviter_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM invitations WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/invites error:', err.message)
    res.status(500).json({ error: 'Failed to cancel invitation' })
  }
})


router.get('/invites', authenticate, async (req, res) => {
  try {
    const [invitations] = await pool.query(
      `SELECT i.id, i.invite_token, i.invitee_name, i.invitee_email, i.status, i.created_at,
              u.name as accepted_by_name
       FROM invitations i
       LEFT JOIN users u ON i.accepted_by = u.id
       WHERE i.inviter_id = ? AND (i.invitee_name IS NOT NULL OR i.invitee_email IS NOT NULL)
       ORDER BY i.created_at DESC`,
      [req.userId]
    )
    res.json(invitations.map(i => ({
      id: i.id,
      name: i.invitee_name || i.invitee_email || null,
      email: i.invitee_email || null,
      sentAt: i.created_at,
      status: i.status,
    })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invitations' })
  }
})


router.get('/friends', authenticate, async (req, res) => {
  try {
    const [friends] = await pool.query(
      `SELECT u.id, u.name, f.mutual_count as mutual,
              (u.last_active IS NOT NULL AND u.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) as online
       FROM friendships f JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ?
       ORDER BY u.name`,
      [req.userId]
    )
    res.json(friends.map(f => ({ ...f, online: !!f.online })))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load friends' })
  }
})


router.get('/conversations', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const [convRows] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
       WHERE (c.is_group IS NULL OR c.is_group = 0)
       ORDER BY (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) DESC,
                c.created_at DESC`, [req.userId])
    const result = []
    for (const { id } of convRows) {
      result.push(await getConversationForUser(id, req.userId, me.name))
    }
    res.json(result)
  } catch (err) {
    console.error('GET /api/conversations error:', err)
    res.status(500).json({ error: 'Failed to load conversations' })
  }
})


router.post('/conversations', authenticate, writeLimit, async (req, res) => {
  const { participantIds, name } = req.body
  if (!participantIds || !Array.isArray(participantIds) || !participantIds.length)
    return res.status(400).json({ error: 'participantIds required' })
  const validIds = participantIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0)
  if (!validIds.length) return res.status(400).json({ error: 'No valid participant IDs' })
  const allIds = [req.userId, ...validIds.filter(id => id !== req.userId)]
  try {
    // For 2-person conversations: return existing conversation if found
    if (allIds.length === 2) {
      const otherId = allIds.find(id => id !== req.userId)
      const [existing] = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
         JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
         WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
         LIMIT 1`, [req.userId, otherId])
      if (existing.length > 0) return res.json({ id: existing[0].id, exists: true })
    }
    const [r] = await pool.query(
      'INSERT INTO conversations (name, created_by) VALUES (?, ?)',
      [name || null, req.userId])
    const convId = r.insertId
    for (const uid of allIds)
      await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid])
    res.json({ id: convId, exists: false })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create conversation' })
  }
})


router.get('/search', authenticate, async (req, res) => {
  const { q } = req.query
  if (!q || q.trim().length < 2) return res.json({ posts: [], messages: [] })
  const like = `%${q.trim()}%`
  const uid = req.userId
  try {
    const [posts] = await pool.query(
      `SELECT DISTINCT p.id, u.name as author, p.text_da, p.text_en, p.time_da, p.time_en, p.created_at
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
       LEFT JOIN comments co ON co.post_id = p.id AND co.author_id = ?
       WHERE (p.author_id = ? OR pl.user_id IS NOT NULL OR co.author_id IS NOT NULL)
         AND (p.text_da LIKE ? OR p.text_en LIKE ?)
       ORDER BY p.created_at DESC LIMIT 15`,
      [uid, uid, uid, like, like]
    )
    let messages = []
    try {
      ;[messages] = await pool.query(
        `SELECT m.id, m.conversation_id, u.name as from_name, m.text_da, m.text_en, m.time,
                COALESCE(c.name, (
                  SELECT u2.name FROM users u2
                  JOIN conversation_participants cp2 ON cp2.user_id = u2.id
                  WHERE cp2.conversation_id = m.conversation_id AND u2.id != ? LIMIT 1
                )) as conv_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id IS NOT NULL
           AND (m.text_da LIKE ? OR m.text_en LIKE ?)
         ORDER BY m.created_at DESC LIMIT 15`,
        [uid, uid, like, like]
      )
    } catch {
      // Fallback: messages table may use single 'text' column (legacy schema)
      try {
        const [rows] = await pool.query(
          `SELECT m.id, m.conversation_id, u.name as from_name,
                  m.text as text_da, m.text as text_en, m.created_at as time,
                  NULL as is_group, u.name as conv_name
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.receiver_id = ? AND m.text LIKE ?
           ORDER BY m.created_at DESC LIMIT 15`,
          [uid, like]
        )
        messages = rows
      } catch { /* messages search unavailable — return empty */ }
    }
    res.json({
      posts: posts.map(p => ({
        id: p.id,
        author: p.author,
        text: { da: p.text_da, en: p.text_en },
        time: { da: p.time_da, en: p.time_en },
      })),
      messages: messages.map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        convName: m.conv_name || m.from_name,
        from: m.from_name,
        text: { da: m.text_da, en: m.text_en },
        time: m.time,
      })),
    })
  } catch (err) {
    console.error('Search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})


router.post('/gdpr/consent', authenticate, async (req, res) => {
  const { consent_types } = req.body // Array: ['data_processing']
  if (!consent_types || !Array.isArray(consent_types) || consent_types.length === 0) {
    return res.status(400).json({ error: 'consent_types array required' })
  }
  const validTypes = ['data_processing']
  for (const ct of consent_types) {
    if (!validTypes.includes(ct)) return res.status(400).json({ error: `Invalid consent type: ${ct}` })
  }

  const clientIp = req.ip || null
  const userAgent = req.headers['user-agent'] || null

  try {
    for (const ct of consent_types) {
      await recordConsent(req.userId, ct, clientIp, userAgent)
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('Consent recording error:', err)
    res.status(500).json({ error: 'Failed to record consent' })
  }
})


router.get('/gdpr/consent', authenticate, async (req, res) => {
  try {
    const [consents] = await pool.query(
      'SELECT consent_type, consent_given, created_at, withdrawn_at FROM gdpr_consent WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    )
    // Return the latest consent status per type
    const status = {}
    for (const c of consents) {
      if (!status[c.consent_type]) {
        status[c.consent_type] = {
          given: c.consent_given === 1 && !c.withdrawn_at,
          date: c.created_at,
          withdrawn_at: c.withdrawn_at,
        }
      }
    }
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: 'Failed to check consent' })
  }
})


router.post('/gdpr/consent/withdraw', authenticate, async (req, res) => {
  const { consent_type } = req.body
  if (!consent_type) return res.status(400).json({ error: 'consent_type required' })

  const clientIp = req.ip || null

  try {
    await withdrawConsent(req.userId, consent_type, clientIp)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to withdraw consent' })
  }
})


router.post('/gdpr/account/request-delete', authenticate, writeLimit, async (req, res) => {
  const { password } = req.body
  try {
    const [[user]] = await pool.query(
      'SELECT password_hash, password_plain, mfa_enabled, phone FROM users WHERE id = ?',
      [req.userId]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })

    const hasPassword = !!(user.password_hash || user.password_plain)

    // Verify password when the account has one
    if (hasPassword) {
      let passwordValid = false
      if (user.password_hash?.startsWith('$2')) {
        passwordValid = await bcrypt.compare(password || '', user.password_hash)
        if (!passwordValid) {
          const sha256hex = crypto.createHash('sha256').update(password || '').digest('hex')
          passwordValid = await bcrypt.compare(sha256hex, user.password_hash)
        }
      } else if (user.password_hash && /^[0-9a-f]{64}$/.test(user.password_hash)) {
        const sha256 = crypto.createHash('sha256').update(password || '').digest('hex')
        passwordValid = sha256 === user.password_hash
      } else if (user.password_plain) {
        passwordValid = user.password_plain === (password || '')
      }
      if (!passwordValid) return res.status(401).json({ error: 'Wrong password' })
    }

    // Send SMS MFA code if 2FA is enabled
    if (user.mfa_enabled && user.phone) {
      const rawCode = String(Math.floor(100000 + Math.random() * 900000))
      const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
      await pool.query(
        'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
        [hashedCode, req.userId]
      )
      const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
      if (!smsSent) {
        console.error(`Account delete MFA SMS failed for user ${req.userId}`)
        return res.status(503).json({ error: 'SMS service unavailable' })
      }
      return res.json({ ok: true, mfa_required: true, has_password: hasPassword })
    }

    res.json({ ok: true, mfa_required: false, has_password: hasPassword })
  } catch (err) {
    console.error('POST /api/gdpr/account/request-delete error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/gdpr/account', authenticate, async (req, res) => {
  const { password, sms_code } = req.body || {}
  const clientIp = req.ip || null

  try {
    // Re-verify credentials before deletion (defence in depth)
    const [[user]] = await pool.query(
      'SELECT password_hash, password_plain, mfa_enabled, mfa_code, mfa_code_expires FROM users WHERE id = ?',
      [req.userId]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Verify password when the account has one
    const hasPassword = !!(user.password_hash || user.password_plain)
    if (hasPassword) {
      let passwordValid = false
      if (user.password_hash?.startsWith('$2')) {
        passwordValid = await bcrypt.compare(password || '', user.password_hash)
        if (!passwordValid) {
          const sha256hex = crypto.createHash('sha256').update(password || '').digest('hex')
          passwordValid = await bcrypt.compare(sha256hex, user.password_hash)
        }
      } else if (user.password_hash && /^[0-9a-f]{64}$/.test(user.password_hash)) {
        const sha256 = crypto.createHash('sha256').update(password || '').digest('hex')
        passwordValid = sha256 === user.password_hash
      } else if (user.password_plain) {
        passwordValid = user.password_plain === (password || '')
      }
      if (!passwordValid) return res.status(401).json({ error: 'Wrong password' })
    }

    // Verify SMS MFA code when 2FA is enabled
    if (user.mfa_enabled) {
      if (!sms_code) return res.status(403).json({ error: 'SMS code required' })
      const mfaOk = await verifySettingsMfaCode(req.userId, sms_code)
      if (!mfaOk) return res.status(401).json({ error: 'Invalid or expired SMS code' })
    }

    // Log before deletion (user_id will be preserved in audit log for legal compliance)
    await auditLog(req, 'account_delete_request', null, null)

    // Delete uploaded media files owned by this user
    const [userPosts] = await pool.query('SELECT media FROM posts WHERE author_id = ?', [req.userId])
    for (const post of userPosts) {
      if (post.media) {
        try {
          const mediaArr = typeof post.media === 'string' ? JSON.parse(post.media) : post.media
          for (const m of mediaArr) {
            if (m.url?.startsWith('/uploads/')) {
              const filePath = path.join(UPLOADS_DIR, path.basename(m.url))
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            }
          }
        } catch {}
      }
    }

    // Delete avatar if it's a local upload
    const [userInfo] = await pool.query('SELECT avatar_url FROM users WHERE id = ?', [req.userId])
    if (userInfo[0]?.avatar_url?.startsWith('/uploads/')) {
      const avatarPath = path.join(UPLOADS_DIR, path.basename(userInfo[0].avatar_url))
      if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath)
    }

    // CASCADE DELETE: posts, comments, likes, messages, friendships, sessions, consent records
    // all have ON DELETE CASCADE foreign keys referencing users(id)
    await pool.query('DELETE FROM users WHERE id = ?', [req.userId])

    await auditLog(req, 'account_deleted', 'user', req.userId)

    res.json({ ok: true })
  } catch (err) {
    console.error('Account deletion error:', err)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})


router.get('/gdpr/export', authenticate, async (req, res) => {
  const clientIp = req.ip || null

  try {
    await auditLog(req.userId, 'data_export_request', null, clientIp)

    const [users] = await pool.query(
      'SELECT id, name, handle, email, bio_da, bio_en, location, join_date, created_at FROM users WHERE id = ?',
      [req.userId]
    )
    const [posts] = await pool.query(
      'SELECT id, text_da, text_en, time_da, time_en, likes, source, created_at FROM posts WHERE author_id = ?',
      [req.userId]
    )
    const [comments] = await pool.query(
      'SELECT c.id, c.post_id, c.text_da, c.text_en, c.created_at FROM comments c WHERE c.author_id = ?',
      [req.userId]
    )
    const [friends] = await pool.query(
      'SELECT u.name, f.source, f.created_at FROM friendships f JOIN users u ON f.friend_id = u.id WHERE f.user_id = ?',
      [req.userId]
    )
    const [messages] = await pool.query(
      `SELECT u.name as partner, m.text_da, m.text_en, m.time, m.created_at,
              CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END as direction
       FROM messages m JOIN users u ON (CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) = u.id
       WHERE m.sender_id = ? OR m.receiver_id = ?`,
      [req.userId, req.userId, req.userId, req.userId]
    )
    const [consents] = await pool.query(
      'SELECT consent_type, consent_given, created_at, withdrawn_at FROM gdpr_consent WHERE user_id = ?',
      [req.userId]
    )

    const exportData = {
      export_date: new Date().toISOString(),
      export_format: 'GDPR Art. 20 Data Portability Export',
      user: users[0] || null,
      posts,
      comments,
      friends,
      messages,
      consent_history: consents,
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="fellis-data-export-${req.userId}-${Date.now()}.json"`)
    res.json(exportData)
  } catch (err) {
    console.error('Data export error:', err)
    res.status(500).json({ error: 'Failed to export data' })
  }
})


router.get('/companies', authenticate, async (req, res) => {
  try {
    const [owned] = await pool.query(
      `SELECT c.*, 'owner' AS role, 'owner' AS member_role, 1 AS is_following,
              (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count
       FROM companies c
       JOIN company_members cm ON cm.company_id = c.id AND cm.user_id = ? AND cm.role = 'owner'`,
      [req.userId]
    )
    const [following] = await pool.query(
      `SELECT c.*, 'following' AS role, NULL AS member_role, 1 AS is_following,
              (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count
       FROM companies c
       JOIN company_follows cf ON cf.company_id = c.id AND cf.user_id = ?
       WHERE c.id NOT IN (SELECT company_id FROM company_members WHERE user_id = ? AND role = 'owner')`,
      [req.userId, req.userId]
    )
    res.json({ companies: [...owned, ...following] })
  } catch (err) {
    console.error('GET /api/companies error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/all', authenticate, async (req, res) => {
  try {
    const { q } = req.query
    let sql = `SELECT c.*,
                 (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count,
                 (SELECT COUNT(*) > 0 FROM company_follows WHERE company_id = c.id AND user_id = ?) AS is_following,
                 (SELECT COUNT(*) > 0 FROM company_members WHERE company_id = c.id AND user_id = ? AND role = 'owner') AS is_owner
               FROM companies c`
    const params = [req.userId, req.userId]
    if (q) { sql += ' WHERE c.name LIKE ? OR c.tagline LIKE ? OR c.industry LIKE ?'; params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
    sql += ' ORDER BY followers_count DESC LIMIT 50'
    const [rows] = await pool.query(sql, params)
    res.json({ companies: rows })
  } catch (err) {
    console.error('GET /api/companies/all error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies', authenticate, async (req, res) => {
  try {
    const { name, handle, tagline, description, industry, size, website, color,
            cvr, company_type, address, phone, email, linkedin, founded_year, logo_url } = req.body
    if (!name || !handle) return res.status(400).json({ error: 'name and handle required' })
    const safeHandle = handle.startsWith('@') ? handle : `@${handle}`
    const [result] = await pool.query(
      `INSERT INTO companies (owner_id, name, handle, tagline, description, industry, size, website, color,
         cvr, company_type, address, phone, email, linkedin, founded_year, logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, name, safeHandle, tagline || null, description || null,
        industry || null, size || null, website || null, color || '#1877F2',
        cvr || null, company_type || null, address || null, phone || null,
        email || null, linkedin || null, founded_year || null, logo_url || null]
    )
    const companyId = result.insertId
    await pool.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES (?, ?, ?)',
      [companyId, req.userId, 'owner']
    )
    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [companyId])
    res.json({ ...company, role: 'owner', followers_count: 0 })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Handle already taken' })
    console.error('POST /api/companies error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id', authenticate, async (req, res) => {
  try {
    const [[company]] = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM company_follows WHERE company_id = c.id) AS followers_count,
         (SELECT COUNT(*) > 0 FROM company_follows WHERE company_id = c.id AND user_id = ?) AS is_following,
         (SELECT role FROM company_members WHERE company_id = c.id AND user_id = ?) AS member_role
       FROM companies c WHERE c.id = ?`,
      [req.userId, req.userId, req.params.id]
    )
    if (!company) return res.status(404).json({ error: 'Not found' })

    const [posts] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id = ? ORDER BY cp.created_at DESC LIMIT 20`,
      [req.userId, req.params.id]
    )

    const [jobs] = await pool.query(
      `SELECT j.*,
              (SELECT COUNT(*) > 0 FROM job_saves WHERE job_id = j.id AND user_id = ?) AS saved,
              (SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.job_id = j.id) AS share_count
       FROM jobs j
       WHERE j.company_id = ? AND j.active = 1
       ORDER BY j.created_at DESC`,
      [req.userId, req.params.id]
    )

    res.json({ company, posts, jobs })
  } catch (err) {
    console.error('GET /api/companies/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/companies/:id', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { name, tagline, description, industry, size, website, color,
            cvr, company_type, address, phone, email, linkedin, founded_year } = req.body
    await pool.query(
      `UPDATE companies SET name=?, tagline=?, description=?, industry=?, size=?, website=?, color=?,
         cvr=?, company_type=?, address=?, phone=?, email=?, linkedin=?, founded_year=? WHERE id=?`,
      [name, tagline || null, description || null, industry || null, size || null, website || null, color || '#1877F2',
       cvr || null, company_type || null, address || null, phone || null,
       email || null, linkedin || null, founded_year || null, req.params.id]
    )
    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.params.id])
    res.json(company)
  } catch (err) {
    console.error('PUT /api/companies/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/companies/:id', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role = 'owner'",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })

    // Delete company and all related data
    await pool.query('DELETE FROM company_members WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM company_follows WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM jobs WHERE company_id = ?', [req.params.id])
    await pool.query('DELETE FROM companies WHERE id = ?', [req.params.id])

    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/companies/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/follow', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      'SELECT 1 FROM company_follows WHERE company_id = ? AND user_id = ?',
      [req.params.id, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM company_follows WHERE company_id = ? AND user_id = ?', [req.params.id, req.userId])
      res.json({ following: false })
    } else {
      await pool.query('INSERT IGNORE INTO company_follows (company_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ following: true })
    }
  } catch (err) {
    console.error('POST /api/companies/:id/follow error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/members', authenticate, async (req, res) => {
  try {
    const [members] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url,
              cm.role,
              (SELECT COUNT(*) > 0 FROM friendships WHERE user_id = ? AND friend_id = u.id) AS is_friend,
              (SELECT COUNT(*) > 0 FROM friend_requests WHERE from_user_id = ? AND to_user_id = u.id AND status = 'pending') AS request_sent
       FROM company_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = ?
       ORDER BY FIELD(cm.role, 'owner', 'admin', 'editor'), u.name`,
      [req.userId, req.userId, req.params.id]
    )
    res.json({ members })
  } catch (err) {
    console.error('GET /api/companies/:id/members error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/members', authenticate, requireFeature('multi_admin'), async (req, res) => {
  try {
    // Check if requester is owner or admin
    const [[isOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' })

    const { user_id, role } = req.body
    if (!user_id || !role) return res.status(400).json({ error: 'Missing user_id or role' })

    // Find user by ID or email
    let [[user]] = await pool.query('SELECT id FROM users WHERE id = ? OR email = ?', [user_id, user_id])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Add member
    await pool.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = ?',
      [req.params.id, user.id, role, role]
    )

    // Return member with info
    const [[member]] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, cm.role
       FROM company_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.company_id = ? AND cm.user_id = ?`,
      [req.params.id, user.id]
    )
    res.json(member)
  } catch (err) {
    console.error('POST /api/companies/:id/members error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/companies/:id/members/:userId', authenticate, async (req, res) => {
  try {
    // Check if requester is owner or admin
    const [[isOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' })

    // Don't allow removing the owner
    const [[isTargetOwner]] = await pool.query(
      "SELECT 1 FROM company_members WHERE company_id = ? AND user_id = ? AND role = 'owner'",
      [req.params.id, req.params.userId]
    )
    if (isTargetOwner) return res.status(400).json({ error: 'Cannot remove owner' })

    // Remove member
    await pool.query(
      'DELETE FROM company_members WHERE company_id = ? AND user_id = ?',
      [req.params.id, req.params.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/companies/:id/members/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/followers', authenticate, async (req, res) => {
  try {
    const [followers] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM company_follows cf JOIN users u ON u.id = cf.user_id
       WHERE cf.company_id = ?
       ORDER BY u.name ASC LIMIT 100`,
      [req.params.id]
    )
    res.json({ followers })
  } catch (err) {
    console.error('GET /api/companies/:id/followers error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/posts', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const offset = parseInt(req.query.offset) || 0
    const [posts] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle,
              (SELECT COUNT(*) > 0 FROM company_post_likes WHERE post_id = cp.id AND user_id = ?) AS liked,
              (SELECT COUNT(*) FROM company_post_comments WHERE post_id = cp.id) AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id
       WHERE cp.company_id = ? AND (cp.mod_status IS NULL OR cp.mod_status != 'removed')
       ORDER BY cp.created_at DESC LIMIT ? OFFSET ?`,
      [req.userId, req.params.id, limit, offset]
    )
    res.json({ posts })
  } catch (err) {
    console.error('GET /api/companies/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/posts', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { text_da, text_en } = req.body
    if (!text_da?.trim()) return res.status(400).json({ error: 'text_da required' })
    const [result] = await pool.query(
      'INSERT INTO company_posts (company_id, author_id, text_da, text_en) VALUES (?, ?, ?, ?)',
      [req.params.id, req.userId, text_da.trim(), (text_en || text_da).trim()]
    )
    const [[post]] = await pool.query(
      `SELECT cp.*, u.name AS author_name, u.handle AS author_handle, 0 AS liked, 0 AS comment_count
       FROM company_posts cp JOIN users u ON u.id = cp.author_id WHERE cp.id = ?`,
      [result.insertId]
    )
    res.json(post)
    moderateContent({ table: 'company_posts', id: result.insertId, text: text_da || '', userId: req.userId }).catch(err => console.error('moderation error:', err))
  } catch (err) {
    console.error('POST /api/companies/:id/posts error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/posts/:postId/like', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      'SELECT 1 FROM company_post_likes WHERE post_id = ? AND user_id = ?',
      [req.params.postId, req.userId]
    )
    if (existing) {
      await pool.query('DELETE FROM company_post_likes WHERE post_id = ? AND user_id = ?', [req.params.postId, req.userId])
      await pool.query('UPDATE company_posts SET likes = GREATEST(likes - 1, 0) WHERE id = ?', [req.params.postId])
      res.json({ liked: false })
    } else {
      const reaction = req.body.reaction || '❤️'
      await pool.query('INSERT IGNORE INTO company_post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)', [req.params.postId, req.userId, reaction])
      await pool.query('UPDATE company_posts SET likes = likes + 1 WHERE id = ?', [req.params.postId])
      res.json({ liked: true })
    }
  } catch (err) {
    console.error('POST company post like error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/posts/:postId/comments', authenticate, async (req, res) => {
  try {
    const [comments] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle
       FROM company_post_comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [req.params.postId]
    )
    res.json({ comments })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/posts/:postId/comments', authenticate, async (req, res) => {
  try {
    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ error: 'text required' })
    const [result] = await pool.query(
      'INSERT INTO company_post_comments (post_id, author_id, text) VALUES (?, ?, ?)',
      [req.params.postId, req.userId, text.trim()]
    )
    const [[comment]] = await pool.query(
      `SELECT c.*, u.name AS author_name, u.handle AS author_handle
       FROM company_post_comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
      [result.insertId]
    )
    res.json(comment)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/contact-notes/:userId', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT note, updated_at FROM contact_notes WHERE author_id = ? AND contact_id = ?',
      [req.userId, req.params.userId]
    )
    res.json({ note: row?.note || '', updatedAt: row?.updated_at || null })
  } catch (err) {
    console.error('GET /api/contact-notes/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/contact-notes/:userId', authenticate, async (req, res) => {
  try {
    const { note } = req.body
    if (note === undefined) return res.status(400).json({ error: 'note required' })
    if (!note.trim()) {
      await pool.query('DELETE FROM contact_notes WHERE author_id = ? AND contact_id = ?', [req.userId, req.params.userId])
      return res.json({ ok: true })
    }
    await pool.query(
      `INSERT INTO contact_notes (author_id, contact_id, note) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE note = VALUES(note), updated_at = NOW()`,
      [req.userId, req.params.userId, note.trim()]
    )
    const [[row]] = await pool.query(
      'SELECT updated_at FROM contact_notes WHERE author_id = ? AND contact_id = ?',
      [req.userId, req.params.userId]
    )
    res.json({ ok: true, updatedAt: row?.updated_at || null })
  } catch (err) {
    console.error('PUT /api/contact-notes/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/contact-notes', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cn.contact_id, cn.note, cn.updated_at, u.name AS contact_name, u.handle AS contact_handle, u.avatar_url AS contact_avatar
       FROM contact_notes cn JOIN users u ON u.id = cn.contact_id
       WHERE cn.author_id = ? AND cn.note != '' ORDER BY cn.updated_at DESC`,
      [req.userId]
    )
    res.json({ notes: rows })
  } catch (err) {
    console.error('GET /api/contact-notes error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/leads', authenticate, writeLimit, async (req, res) => {
  try {
    const { name, email, topic, message } = req.body
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email required' })
    const [[company]] = await pool.query('SELECT id FROM companies WHERE id = ?', [req.params.id])
    if (!company) return res.status(404).json({ error: 'Company not found' })
    await pool.query(
      'INSERT INTO company_leads (company_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, name.trim(), email.trim(), topic?.trim() || null, message?.trim() || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/companies/:id/leads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/leads', authenticate, async (req, res) => {
  try {
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [leads] = await pool.query(
      'SELECT * FROM company_leads WHERE company_id = ? ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json({ leads })
  } catch (err) {
    console.error('GET /api/companies/:id/leads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/companies/:id/leads/:leadId', authenticate, writeLimit, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['new', 'responded', 'archived']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE company_leads SET status = ? WHERE id = ? AND company_id = ?', [status, req.params.leadId, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/companies/:id/leads/:leadId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/ads', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  const { title, body, image_url, target_url, placement = 'feed', start_date, end_date, budget, target_interests } = req.body
  if (!title || !target_url) return res.status(400).json({ error: 'title and target_url required' })
  try {
    // Snapshot current CPM rate at ad creation time
    const [[settings]] = await pool.query('SELECT ad_price_cpm FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const cpmRate = parseFloat(settings?.ad_price_cpm) || 50
    const budgetVal = budget ? parseFloat(budget) : null
    const interestsVal = target_interests ? JSON.stringify(target_interests) : null
    const [result] = await pool.query(
      'INSERT INTO ads (advertiser_id, title, body, image_url, target_url, placement, start_date, end_date, budget, cpm_rate, target_interests) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.userId, title, body || null, image_url || null, target_url, placement, start_date || null, end_date || null, budgetVal, cpmRate, interestsVal]
    )
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [result.insertId])
    res.status(201).json({ ad })
  } catch (err) {
    console.error('POST /api/ads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/ads', authenticate, async (req, res) => {
  try {
    let rows
    if (req.query.admin === '1') {
      // Admin listing — requires admin
      const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.userId])
      if (!user || req.userId !== 1) return res.status(403).json({ error: 'Admin only' })
      ;[rows] = await pool.query(
        `SELECT a.*, u.name AS advertiser_name FROM ads a JOIN users u ON u.id = a.advertiser_id ORDER BY a.created_at DESC`
      )
    } else if (req.query.serve === '1') {
      // Serve ads — fetch enabled ad for placement (respects ads_enabled setting)
      const [[settings]] = await pool.query('SELECT ads_enabled, max_ads_feed, max_ads_sidebar, max_ads_stories, refresh_interval_seconds FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
      if (!settings || !settings.ads_enabled) return res.json({ ads: [] })
      // Check if user is ads_free for today (period-based, not stale column)
      const todayAd = new Date().toISOString().split('T')[0]
      const [[adFreeRow]] = await pool.query(`
        SELECT (
          (SELECT COUNT(*) FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
          (SELECT COUNT(*) FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
        ) AS total
      `, [req.userId, todayAd, todayAd, req.userId, todayAd, todayAd]).catch(() => [[{ total: 0 }]])
      if ((adFreeRow?.total ?? 0) > 0) return res.json({ ads: [], ads_free: true })
      const placement = req.query.placement || 'feed'
      // All ads run across all placements — no placement filter
      const limitMap = { feed: settings.max_ads_feed, sidebar: settings.max_ads_sidebar, stories: settings.max_ads_stories, reels: settings.max_ads_feed }
      const limit = limitMap[placement] || 1
      rows = await selectAdsForUser(req.userId, limit)
      return res.json({ ads: rows, refresh_interval: settings.refresh_interval_seconds })
    } else {
      // Business user's own ads
      ;[rows] = await pool.query('SELECT * FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC', [req.userId])
    }
    res.json({ ads: rows })
  } catch (err) {
    console.error('GET /api/ads error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/ads/mine', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    let rows
    try {
      ;[rows] = await pool.query(
        `SELECT id, title, body, image_url, target_url, placement, status, start_date, end_date,
                budget, spent, cpm_rate, reach, impressions, clicks, boosted_post_id,
                target_interests, payment_status, paid_until, created_at
         FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC`,
        [req.userId]
      )
    } catch {
      // Phase 3 migration not yet applied — fall back without new columns
      ;[rows] = await pool.query(
        `SELECT id, title, body, image_url, target_url, placement, status, start_date, end_date,
                NULL AS budget, 0 AS spent, NULL AS cpm_rate, 0 AS reach,
                impressions, clicks, NULL AS boosted_post_id,
                NULL AS target_interests, payment_status, paid_until, created_at
         FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC`,
        [req.userId]
      )
    }
    res.json({ ads: rows })
  } catch (err) {
    console.error('GET /api/ads/mine error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/ads/price', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT ad_price_cpm, ad_recurring_pct, boost_price, currency FROM admin_ad_settings WHERE id = 1')
    const adPrice = parseFloat(row?.ad_price_cpm) || 50
    const adRecurringPct = parseInt(row?.ad_recurring_pct ?? 100)
    const adRecurringPrice = Math.round(adPrice * adRecurringPct / 100 * 100) / 100
    const boostPrice = parseFloat(row?.boost_price) || 9
    res.json({ ad_price_cpm: adPrice, ad_recurring_price: adRecurringPrice, ad_recurring_pct: adRecurringPct, boost_price: boostPrice, currency: row?.currency || 'EUR' })
  } catch (err) {
    console.error('GET /api/ads/price error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/ads/banner', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT mode FROM users WHERE id = ?', [req.userId])
    if (user?.mode === 'business') return res.status(204).end()
    const today = new Date().toISOString().split('T')[0]
    const [rows] = await pool.query(
      `SELECT id, title, image_url, link_url FROM platform_ads
       WHERE status = 'active'
         AND (start_date IS NULL OR start_date <= ?)
         AND (end_date IS NULL OR end_date >= ?)
       ORDER BY RAND()
       LIMIT 1`,
      [today, today]
    )
    if (!rows.length) return res.status(204).end()
    const ad = rows[0]
    res.json({ ad_id: ad.id, image_url: ad.image_url, link_url: ad.link_url, label: ad.title })
  } catch (err) {
    console.error('GET /api/ads/banner error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/ads/campaign', authenticate, requireFeature('ad_campaigns'), async (req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})


router.get('/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    res.json({ ad })
  } catch (err) {
    console.error('GET /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    const { title, body, image_url, target_url, status, placement, start_date, end_date } = req.body
    const VALID_STATUS = ['draft', 'active', 'paused', 'archived']
    const VALID_PLACEMENT = ['feed', 'sidebar', 'stories']
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    if (placement && !VALID_PLACEMENT.includes(placement)) return res.status(400).json({ error: 'Invalid placement' })
    // Block date changes when ad is within its paid period (prevents circumventing payment)
    const isPaidAndActive = ad.paid_until && new Date(ad.paid_until) > new Date()
    if (isPaidAndActive && (start_date !== undefined || end_date !== undefined)) {
      return res.status(403).json({ error: 'Cannot change dates while ad is within paid period' })
    }
    // Allow reactivation of a paid ad without requiring payment (server trusts paid_until)
    await pool.query(
      'UPDATE ads SET title=COALESCE(?,title), body=COALESCE(?,body), image_url=COALESCE(?,image_url), target_url=COALESCE(?,target_url), status=COALESCE(?,status), placement=COALESCE(?,placement), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date) WHERE id=?',
      [title||null, body||null, image_url||null, target_url||null, status||null, placement||null, start_date||null, end_date||null, req.params.id]
    )
    const [[updated]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    res.json({ ad: updated })
  } catch (err) {
    console.error('PUT /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    const { title, body, image_url, target_url, start_date, end_date, budget, target_interests } = req.body
    // placement and cpm_rate cannot be changed via PATCH — use PUT for admin changes
    await pool.query(
      `UPDATE ads SET
        title = COALESCE(?,title), body = COALESCE(?,body),
        image_url = COALESCE(?,image_url), target_url = COALESCE(?,target_url),
        start_date = COALESCE(?,start_date), end_date = COALESCE(?,end_date),
        budget = COALESCE(?,budget),
        target_interests = COALESCE(?,target_interests)
       WHERE id = ?`,
      [title||null, body||null, image_url||null, target_url||null,
       start_date||null, end_date||null,
       budget != null ? parseFloat(budget) : null,
       target_interests ? JSON.stringify(target_interests) : null,
       req.params.id]
    )
    const [[updated]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    res.json({ ad: updated })
  } catch (err) {
    console.error('PATCH /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/ads/:id', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId && req.userId !== 1) return res.status(403).json({ error: 'Forbidden' })
    if (ad.status !== 'draft' && req.userId !== 1) return res.status(409).json({ error: 'Only draft ads can be deleted' })
    await pool.query('DELETE FROM ads WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/ads/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/ads/:id/pay', authenticate, attachUserMode, requireBusiness, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const [[ad]] = await pool.query('SELECT * FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    if (ad.advertiser_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })

    const [[settings]] = await pool.query('SELECT ad_price_cpm, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    const pricePerDay = parseFloat(settings?.ad_price_cpm) || 50
    const currency = settings?.currency || 'EUR'

    // Calculate duration in days from the ad's date range; fall back to 30 days
    let days = 30
    if (ad.start_date && ad.end_date) {
      const diff = Math.round((new Date(ad.end_date) - new Date(ad.start_date)) / 86400000) + 1
      if (diff >= 1) days = diff
    }
    const amount = (days * pricePerDay).toFixed(2)
    const paidUntil = ad.end_date ? new Date(ad.end_date) : new Date(Date.now() + days * 86400000)

    const mollie = await getMollieClient()
    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
    if (!mollie) {
      // Dev fallback: immediately activate without payment
      await pool.query(
        "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = ? WHERE id = ?",
        [paidUntil, adId]
      )
      await pool.query(
        'INSERT INTO subscriptions (user_id, plan, status, ad_id) VALUES (?, ?, ?, ?)',
        [req.userId, 'ad_activation', 'paid', adId]
      )
      return res.json({ activated: true, checkout_url: null })
    }

    const siteUrl = process.env.SITE_URL || 'https://fellis.eu'
    const payment = await mollie.payments.create({
      amount: { currency, value: amount },
      description: `fellis.eu — annonce aktivering #${adId} (${days} dage)`,
      redirectUrl: `${origin}/?mollie_payment=success&plan=ad_activation&ad_id=${adId}`,
      webhookUrl: `${siteUrl}/api/mollie/payment/webhook`,
      metadata: { user_id: String(req.userId), plan: 'ad_activation', ad_id: String(adId) },
    })
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, payment.id, 'ad_activation', payment.status, adId]
    )
    res.json({ checkout_url: payment.getCheckoutUrl(), activated: false })
  } catch (err) {
    console.error('POST /api/ads/:id/pay error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/ads/:id/impression', authenticate, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const [[ad]] = await pool.query('SELECT id, cpm_rate, budget, spent, status FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })

    // Dedup: one impression per user per ad per hour (graceful if migration not yet run)
    let isDuplicate = false
    try {
      const hourBucket = new Date()
      hourBucket.setMinutes(0, 0, 0)
      try {
        await pool.query(
          'INSERT INTO ad_impressions (ad_id, user_id, hour_bucket) VALUES (?, ?, ?)',
          [adId, req.userId, hourBucket]
        )
      } catch (dupErr) {
        if (dupErr.code === 'ER_DUP_ENTRY') { isDuplicate = true }
        else if (dupErr.code !== 'ER_NO_SUCH_TABLE') throw dupErr
      }
      if (isDuplicate) return res.json({ ok: true, duplicate: true })

      // reach = count distinct users who have seen this ad
      const [[{ rc }]] = await pool.query('SELECT COUNT(DISTINCT user_id) AS rc FROM ad_impressions WHERE ad_id = ?', [adId])
      await pool.query('UPDATE ads SET reach = ? WHERE id = ?', [rc, adId])
    } catch { /* ad_impressions table not yet migrated — skip dedup and reach */ }

    // Increment impressions
    await pool.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [adId])

    // CPM spend deduction
    if (ad.cpm_rate && ad.cpm_rate > 0) {
      const costPerImpression = parseFloat(ad.cpm_rate) / 1000
      await pool.query(
        'UPDATE ads SET spent = spent + ? WHERE id = ?',
        [costPerImpression, adId]
      )
      // Autopause when spent >= budget
      if (ad.budget && ad.budget > 0) {
        const newSpent = parseFloat(ad.spent) + costPerImpression
        if (newSpent >= parseFloat(ad.budget)) {
          await pool.query("UPDATE ads SET status = 'paused' WHERE id = ? AND status = 'active'", [adId])
        }
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/impression error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/ads/:id/click', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT id FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Ad not found' })
    await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/ads/:id/click error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/content', authenticate, async (req, res) => {
  try {
    const [[settings]] = await pool.query('SELECT ads_enabled, max_ads_feed, max_ads_sidebar, max_ads_stories, refresh_interval_seconds FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    if (!settings || !settings.ads_enabled) return res.json({ ads: [] })
    const todayAd = new Date().toISOString().split('T')[0]
    const [[adFreeRow]] = await pool.query(`
      SELECT (
        (SELECT COUNT(*) FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
        (SELECT COUNT(*) FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
      ) AS total
    `, [req.userId, todayAd, todayAd, req.userId, todayAd, todayAd]).catch(() => [[{ total: 0 }]])
    if ((adFreeRow?.total ?? 0) > 0) return res.json({ ads: [], ads_free: true })
    const section = req.query.section || 'feed'
    const limitMap = { feed: settings.max_ads_feed, sidebar: settings.max_ads_sidebar, stories: settings.max_ads_stories, reels: settings.max_ads_feed }
    const limit = Math.max(1, parseInt(limitMap[section], 10) || 1)
    const rows = await selectAdsForUser(req.userId, limit).catch(err => {
      console.error('GET /api/content selectAdsForUser:', err.code, err.message)
      return []
    })
    res.json({ ads: rows, refresh_interval: settings.refresh_interval_seconds })
  } catch (err) {
    console.error('GET /api/content error:', err.code, err.message, err.stack)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/content/:id/view', authenticate, async (req, res) => {
  try {
    const adId = parseInt(req.params.id)
    const [[ad]] = await pool.query('SELECT id, cpm_rate, budget, spent, status FROM ads WHERE id = ?', [adId])
    if (!ad) return res.status(404).json({ error: 'Not found' })
    let isDuplicate = false
    try {
      const hourBucket = new Date()
      hourBucket.setMinutes(0, 0, 0)
      try {
        await pool.query('INSERT INTO ad_impressions (ad_id, user_id, hour_bucket) VALUES (?, ?, ?)', [adId, req.userId, hourBucket])
      } catch (dupErr) {
        if (dupErr.code === 'ER_DUP_ENTRY') { isDuplicate = true }
        else if (dupErr.code !== 'ER_NO_SUCH_TABLE') throw dupErr
      }
      if (isDuplicate) return res.json({ ok: true, duplicate: true })
      const [[{ rc }]] = await pool.query('SELECT COUNT(DISTINCT user_id) AS rc FROM ad_impressions WHERE ad_id = ?', [adId])
      await pool.query('UPDATE ads SET reach = ? WHERE id = ?', [rc, adId])
    } catch { /* ad_impressions not yet migrated */ }
    await pool.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [adId])
    if (ad.cpm_rate && ad.cpm_rate > 0) {
      const costPerImpression = parseFloat(ad.cpm_rate) / 1000
      await pool.query('UPDATE ads SET spent = spent + ? WHERE id = ?', [costPerImpression, adId])
      if (ad.budget && ad.budget > 0) {
        const newSpent = parseFloat(ad.spent) + costPerImpression
        if (newSpent >= parseFloat(ad.budget)) {
          await pool.query("UPDATE ads SET status = 'paused' WHERE id = ? AND status = 'active'", [adId])
        }
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/content/:id/view error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/content/:id/open', authenticate, async (req, res) => {
  try {
    const [[ad]] = await pool.query('SELECT id FROM ads WHERE id = ?', [req.params.id])
    if (!ad) return res.status(404).json({ error: 'Not found' })
    await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/content/:id/open error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/analytics', authenticate, requireFeature('analytics'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90)

    // Profile views per day (sparse rows — gaps filled client-side)
    const [viewRows] = await pool.query(
      `SELECT DATE(viewed_at) as date, COUNT(*) as count
       FROM profile_views
       WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(viewed_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // New connections per day
    const [connRows] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM friendships
       WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // Top posts by engagement (likes + comments)
    const [topPosts] = await pool.query(
      `SELECT p.id,
              SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 60) as text,
              p.likes,
              COUNT(DISTINCT c.id) as comment_count,
              (p.likes + COUNT(DISTINCT c.id)) as engagement
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY p.id ORDER BY engagement DESC LIMIT 5`,
      [req.userId]
    )

    // Engagement received in period
    const [[engStats]] = await pool.query(
      `SELECT COALESCE(SUM(p.likes), 0) as likes_received,
              COUNT(DISTINCT c.id) as comments_received,
              COUNT(DISTINCT p.id) as post_count
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
         AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       WHERE p.author_id = ? AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days, req.userId, days]
    )

    // Engagement trend per day (comments on user's posts)
    const [engTrendRows] = await pool.query(
      `SELECT DATE(c.created_at) as date, COUNT(*) as count
       FROM comments c JOIN posts p ON c.post_id = p.id
       WHERE p.author_id = ? AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(c.created_at) ORDER BY date ASC`,
      [req.userId, days]
    )

    // Funnel: profile views → friend requests received → new connections
    const [[funnel]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM profile_views WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as views,
        (SELECT COUNT(*) FROM friend_requests WHERE to_user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as requests,
        (SELECT COUNT(*) FROM friendships WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) as connections`,
      [req.userId, days, req.userId, days, req.userId, days]
    )

    // Total connections
    const [[{ total_connections }]] = await pool.query(
      'SELECT COUNT(*) as total_connections FROM friendships WHERE user_id = ?',
      [req.userId]
    )

    // Post type split: text-only vs with-media
    const [[postTypes]] = await pool.query(
      `SELECT
        SUM(CASE WHEN media IS NULL OR media = '[]' THEN 1 ELSE 0 END) as text_count,
        SUM(CASE WHEN media IS NOT NULL AND media != '[]' THEN 1 ELSE 0 END) as media_count
       FROM posts WHERE author_id = ?`,
      [req.userId]
    )

    // Best time to post: engagement (likes + comments) per day-of-week × hour
    // MOD(DAYOFWEEK+5,7) maps Sun=1→6, Mon=2→0, …, Sat=7→5
    const [heatmapRows] = await pool.query(
      `SELECT MOD(DAYOFWEEK(p.created_at) + 5, 7) AS day_idx,
              HOUR(p.created_at) AS hour_idx,
              SUM(p.likes) + COUNT(DISTINCT c.id) AS weight
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY day_idx, hour_idx`,
      [req.userId]
    )
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
    heatmapRows.forEach(r => { heatmap[r.day_idx][r.hour_idx] = Number(r.weight) })

    // Hashtag performance: parse hashtags from post text, sum engagement
    const [postTextsForTags] = await pool.query(
      `SELECT COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), '') AS text,
              p.likes + COUNT(DISTINCT c.id) AS engagement
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE p.author_id = ?
       GROUP BY p.id`,
      [req.userId]
    )
    const hashtagMap = {}
    const tagRe = /#[\w\u00C0-\u024F]+/g
    postTextsForTags.forEach(row => {
      const tags = (row.text || '').match(tagRe) || []
      tags.forEach(tag => {
        const key = tag.toLowerCase()
        hashtagMap[key] = (hashtagMap[key] || 0) + Number(row.engagement)
      })
    })
    const hashtagPerformance = Object.entries(hashtagMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    // Audience locations: locations of the user's connections
    const [locationRows] = await pool.query(
      `SELECT u.location, COUNT(*) AS count
       FROM friendships f
       JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
       WHERE (f.user_id = ? OR f.friend_id = ?)
         AND u.location IS NOT NULL AND u.location != ''
       GROUP BY u.location ORDER BY count DESC LIMIT 5`,
      [req.userId, req.userId, req.userId]
    )
    const locTotal = locationRows.reduce((s, r) => s + Number(r.count), 0) || 1
    const audienceLocations = locationRows.map(r => ({
      label: r.location,
      pct: Math.round((Number(r.count) / locTotal) * 100),
    }))

    // Audience growth source: invite-based vs. organic connections
    const [[growthStats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM friendships WHERE user_id = ?) AS total_conns,
        (SELECT COUNT(*) FROM invitations WHERE inviter_id = ? AND status = 'accepted') AS via_invite`,
      [req.userId, req.userId]
    )
    const totalC = Number(growthStats.total_conns)
    const viaInvite = Math.min(Number(growthStats.via_invite), totalC)
    const organic = totalC - viaInvite

    // Industry distribution of connections (requires migrate-audience-insights.sql)
    let industryDist = []
    try {
      const [industryRows] = await pool.query(
        `SELECT u.industry, COUNT(*) AS count
         FROM friendships f
         JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
         WHERE (f.user_id = ? OR f.friend_id = ?)
           AND u.industry IS NOT NULL AND u.industry != ''
         GROUP BY u.industry ORDER BY count DESC LIMIT 8`,
        [req.userId, req.userId, req.userId]
      )
      const indTotal = industryRows.reduce((s, r) => s + Number(r.count), 0) || 1
      industryDist = industryRows.map(r => ({
        label: r.industry,
        pct: Math.round((Number(r.count) / indTotal) * 100),
      }))
    } catch { /* column not yet added */ }

    // Seniority distribution of connections (requires migrate-audience-insights.sql)
    let seniorityDist = []
    try {
      const [seniorityRows] = await pool.query(
        `SELECT u.seniority, COUNT(*) AS count
         FROM friendships f
         JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
         WHERE (f.user_id = ? OR f.friend_id = ?)
           AND u.seniority IS NOT NULL AND u.seniority != ''
         GROUP BY u.seniority ORDER BY count DESC`,
        [req.userId, req.userId, req.userId]
      )
      const senTotal = seniorityRows.reduce((s, r) => s + Number(r.count), 0) || 1
      seniorityDist = seniorityRows.map(r => ({
        label: r.seniority,
        pct: Math.round((Number(r.count) / senTotal) * 100),
      }))
    } catch { /* column not yet added */ }

    // Posts driving profile visits (requires migrate-audience-insights.sql)
    let postsDrivingVisits = []
    try {
      const [drivingRows] = await pool.query(
        `SELECT p.id,
                SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 50) AS text,
                COUNT(*) AS visits
         FROM profile_views pv
         JOIN posts p ON p.id = pv.source_post_id
         WHERE pv.profile_id = ?
           AND pv.source_post_id IS NOT NULL
           AND pv.viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY pv.source_post_id ORDER BY visits DESC LIMIT 5`,
        [req.userId, days]
      )
      postsDrivingVisits = drivingRows.map(r => ({
        label: (r.text || '').trim().slice(0, 40) || `Post #${r.id}`,
        value: Number(r.visits),
      }))
    } catch { /* column not yet added */ }

    // Platform average new connections per user per day (for competitor benchmarking)
    let platformAvgConnGrowth = []
    try {
      const [platformRows] = await pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS total_new
         FROM friendships
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [days]
      )
      const [[{ user_count }]] = await pool.query('SELECT COUNT(*) AS user_count FROM users')
      const uc = Math.max(Number(user_count), 1)
      platformAvgConnGrowth = platformRows.map(r => ({
        date: r.date.toISOString().slice(0, 10),
        value: Math.round((Number(r.total_new) / uc) * 10) / 10,
      }))
    } catch { /* ignore */ }

    // Business-specific stats (only for business mode users)
    let businessStats = null
    try {
      const [[userMode]] = await pool.query('SELECT mode, follower_count, community_score FROM users WHERE id = ?', [req.userId])
      if (userMode?.mode === 'business') {
        // Follower growth per day + 7d/30d aggregates
        const [followerGrowth] = await pool.query(
          `SELECT DATE(created_at) AS date, COUNT(*) AS new_followers
           FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY DATE(created_at) ORDER BY date ASC`,
          [req.userId, days]
        ).catch(() => [[]])

        const [[follower7d]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        const [[follower30d]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        const [[totalFollowers]] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM business_follows WHERE business_id = ?',
          [req.userId]
        ).catch(() => [[{ cnt: 0 }]])

        // Ad performance summary (with paid_until and is_active)
        const [adPerf] = await pool.query(
          `SELECT id, title, status, impressions, clicks, reach, spent, budget, cpm_rate, boosted_post_id, paid_until, created_at
           FROM ads WHERE advertiser_id = ? ORDER BY created_at DESC LIMIT 10`,
          [req.userId]
        ).catch(() => [[]])

        // Post boost aggregate stats
        const [[boostAgg]] = await pool.query(
          `SELECT
            SUM(CASE WHEN status = 'active' AND (paid_until IS NULL OR paid_until > NOW()) THEN 1 ELSE 0 END) AS active_count,
            COALESCE(SUM(impressions), 0) AS total_impressions
           FROM ads WHERE advertiser_id = ? AND boosted_post_id IS NOT NULL`,
          [req.userId]
        ).catch(() => [[{ active_count: 0, total_impressions: 0 }]])

        // Post boost per-item list
        const [boostStats] = await pool.query(
          `SELECT a.id, a.boosted_post_id, a.impressions, a.clicks, a.reach, a.spent, a.status, a.paid_until,
                  SUBSTRING(COALESCE(NULLIF(p.text_da,''), NULLIF(p.text_en,''), ''), 1, 50) AS post_text
           FROM ads a LEFT JOIN posts p ON p.id = a.boosted_post_id
           WHERE a.advertiser_id = ? AND a.boosted_post_id IS NOT NULL
           ORDER BY a.created_at DESC LIMIT 5`,
          [req.userId]
        ).catch(() => [[]])

        businessStats = {
          followerCount: Number(totalFollowers?.cnt || userMode.follower_count || 0),
          communityScore: Number(userMode.community_score || 0),
          followerGrowth,
          followerStats: {
            total_followers: Number(totalFollowers?.cnt || 0),
            new_followers_7d: Number(follower7d?.cnt || 0),
            new_followers_30d: Number(follower30d?.cnt || 0),
          },
          adPerformance: (Array.isArray(adPerf) ? adPerf : []).map(a => ({
            id: a.id,
            title: a.title,
            status: a.status,
            impressions: Number(a.impressions || 0),
            clicks: Number(a.clicks || 0),
            reach: Number(a.reach || 0),
            spent: parseFloat(a.spent || 0),
            budget: a.budget ? parseFloat(a.budget) : null,
            ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0,
            paid_until: a.paid_until ? new Date(a.paid_until).toISOString() : null,
            is_active: a.status === 'active' && (!a.paid_until || new Date(a.paid_until) > new Date()),
            isBoostedPost: !!a.boosted_post_id,
          })),
          postBoostStats: {
            boosted_posts_active: Number(boostAgg?.active_count || 0),
            total_boosted_impressions: Number(boostAgg?.total_impressions || 0),
            items: (Array.isArray(boostStats) ? boostStats : []).map(b => ({
              adId: b.id,
              postId: b.boosted_post_id,
              postText: b.post_text || `Post #${b.boosted_post_id}`,
              impressions: Number(b.impressions || 0),
              clicks: Number(b.clicks || 0),
              reach: Number(b.reach || 0),
              spent: parseFloat(b.spent || 0),
              status: b.status,
              paid_until: b.paid_until ? new Date(b.paid_until).toISOString() : null,
            })),
          },
        }
      }
    } catch { /* business stats are non-critical */ }

    res.json({
      days,
      views: viewRows,
      connections: connRows,
      topPosts: topPosts.map(p => ({
        label: (p.text || '').trim().slice(0, 50) || `Post #${p.id}`,
        value: Number(p.engagement),
      })),
      engagement: {
        likes: Number(engStats.likes_received),
        comments: Number(engStats.comments_received),
        posts: Number(engStats.post_count),
      },
      engTrend: engTrendRows,
      funnel: { views: Number(funnel.views), requests: Number(funnel.requests), connections: Number(funnel.connections) },
      totalConnections: Number(total_connections),
      postTypes: { text: Number(postTypes.text_count || 0), media: Number(postTypes.media_count || 0) },
      heatmap,
      hashtagPerformance,
      audienceLocations,
      growthSource: { viaInvite, organic, total: totalC },
      industryDist,
      seniorityDist,
      postsDrivingVisits,
      platformAvgConnGrowth,
      businessStats,
    })
  } catch (err) {
    console.error('GET /api/analytics error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/analytics/post/:postId', authenticate, requireFeature('analytics'), async (req, res) => {
  try {
    const postId = parseInt(req.params.postId)
    if (!postId) return res.status(400).json({ error: 'Invalid post ID' })
    const [[post]] = await pool.query('SELECT id, user_id FROM posts WHERE id = ?', [postId])
    if (!post) return res.status(404).json({ error: 'Not found' })
    if (post.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    const [[likes]] = await pool.query('SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?', [postId])
    const [[views]] = await pool.query('SELECT COUNT(*) AS count FROM post_views WHERE post_id = ?', [postId])
    const [[comments]] = await pool.query('SELECT COUNT(*) AS count FROM comments WHERE post_id = ?', [postId])
    res.json({ post_id: postId, likes: Number(likes.count), views: Number(views.count), comments: Number(comments.count) })
  } catch (err) {
    console.error('GET /api/analytics/post/:postId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/analytics/visitor-stats', authenticate, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90)

    // site_visits queries — may fail if table not yet created (race on startup)
    let browsers = [], oses = [], countries = [], daily = [], total = 0
    try {
      ;[browsers] = await pool.query(
        `SELECT browser, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND browser != 'Unknown'
         GROUP BY browser ORDER BY count DESC`,
        [days]
      )
      ;[oses] = await pool.query(
        `SELECT os, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY os ORDER BY count DESC`,
        [days]
      )
      ;[countries] = await pool.query(
        `SELECT country, country_code, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND country_code IS NOT NULL AND country_code != 'XX'
         GROUP BY country_code, country ORDER BY count DESC LIMIT 30`,
        [days]
      )
      ;[daily] = await pool.query(
        `SELECT DATE(visited_at) AS date, COUNT(*) AS count FROM site_visits
         WHERE visited_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(visited_at) ORDER BY date ASC`,
        [days]
      )
      ;[[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM site_visits')
    } catch (e) {
      console.error('visitor-stats site_visits query error:', e.message)
    }

    // profile_views queries — separate try/catch so site stats still work if table missing
    let myProfileViews = 0, myProfileViewsDaily = []
    try {
      ;[[{ myProfileViews }]] = await pool.query(
        'SELECT COUNT(*) AS myProfileViews FROM profile_views WHERE profile_id = ?',
        [req.userId]
      )
      ;[myProfileViewsDaily] = await pool.query(
        `SELECT DATE(viewed_at) AS date, COUNT(*) AS count FROM profile_views
         WHERE profile_id = ? AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(viewed_at) ORDER BY date ASC`,
        [req.userId, days]
      )
    } catch (e) {
      console.error('visitor-stats profile_views query error:', e.message)
    }

    res.json({ browsers, oses, countries, daily, total, myProfileViews, myProfileViewsDaily })
  } catch (err) {
    console.error('GET /api/analytics/visitor-stats error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/interest-categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, da, en, icon FROM interest_categories WHERE active = 1 ORDER BY sort_order, da'
    )
    res.json({ categories: rows })
  } catch {
    res.json({ categories: [] })
  }
})


router.get('/calendar/events', authenticate, async (req, res) => {
  try {
    // Get birthday of friends + the current user
    const [birthdayRows] = await pool.query(
      `SELECT u.id, u.name, u.initials, u.avatar_url, u.birthday
       FROM users u
       WHERE u.birthday IS NOT NULL
         AND (
           u.id = ?
           OR u.id IN (
             SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END
             FROM friendships WHERE user_id = ? OR friend_id = ?
           )
         )`,
      [req.userId, req.userId, req.userId, req.userId]
    )
    const birthdays = birthdayRows.map(u => {
      let dateStr = u.birthday instanceof Date
        ? `${u.birthday.getFullYear()}-${String(u.birthday.getMonth() + 1).padStart(2,'0')}-${String(u.birthday.getDate()).padStart(2,'0')}`
        : String(u.birthday).slice(0, 10)
      return { userId: u.id, name: u.name, initials: u.initials, avatarUrl: u.avatar_url, date: dateStr }
    })

    // Add manually tracked personal birthdays (privat mode feature)
    const [personalRows] = await pool.query(
      'SELECT id, name, birthday, relation FROM personal_birthdays WHERE user_id = ?',
      [req.userId]
    ).catch(() => [[]])
    personalRows.forEach(pb => {
      let dateStr = String(pb.birthday).slice(0, 10)
      if (pb.birthday instanceof Date) {
        dateStr = `${pb.birthday.getFullYear()}-${String(pb.birthday.getMonth() + 1).padStart(2, '0')}-${String(pb.birthday.getDate()).padStart(2, '0')}`
      }
      birthdays.push({ personalId: pb.id, userId: null, name: pb.name, initials: pb.name.slice(0, 2).toUpperCase(), avatarUrl: null, date: dateStr, relation: pb.relation })
    })

    // Get platform events
    const [eventRows] = await pool.query(
      `SELECT e.id, e.title, e.date, e.location, e.event_type,
        (SELECT r.status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS my_rsvp
       FROM events e ORDER BY e.date ASC`,
      [req.userId]
    )
    const events = eventRows.map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      location: e.location,
      eventType: e.event_type,
      myRsvp: e.my_rsvp || null,
    }))

    res.json({ birthdays, events })
  } catch (err) {
    console.error('GET /api/calendar/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/calendar/reminders', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, date, title, note FROM calendar_reminders WHERE user_id = ? ORDER BY date',
      [req.userId]
    )
    const reminders = rows.map(r => {
      let dateStr = String(r.date).slice(0, 10)
      if (r.date instanceof Date) {
        dateStr = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`
      }
      return { ...r, date: dateStr }
    })
    res.json({ reminders })
  } catch (err) {
    console.error('GET /api/calendar/reminders error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/calendar/reminders', authenticate, async (req, res) => {
  const { date, title, note } = req.body
  if (!date || !title || !title.trim()) return res.status(400).json({ error: 'date and title are required' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format' })
  try {
    const [result] = await pool.query(
      'INSERT INTO calendar_reminders (user_id, date, title, note) VALUES (?, ?, ?, ?)',
      [req.userId, date, title.trim().slice(0, 255), (note || '').trim().slice(0, 1000) || null]
    )
    res.json({ id: result.insertId, date, title: title.trim(), note: (note || '').trim() || null })
  } catch (err) {
    console.error('POST /api/calendar/reminders error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/calendar/reminders/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid id' })
  try {
    const [result] = await pool.query(
      'DELETE FROM calendar_reminders WHERE id = ? AND user_id = ?',
      [id, req.userId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/calendar/reminders/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/calendar/birthdays', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, birthday, relation FROM personal_birthdays WHERE user_id = ? ORDER BY DATE_FORMAT(birthday, "%m-%d")',
      [req.userId]
    )
    const birthdays = rows.map(r => {
      let dateStr = String(r.birthday).slice(0, 10)
      if (r.birthday instanceof Date) {
        dateStr = `${r.birthday.getFullYear()}-${String(r.birthday.getMonth() + 1).padStart(2, '0')}-${String(r.birthday.getDate()).padStart(2, '0')}`
      }
      return { id: r.id, name: r.name, birthday: dateStr, relation: r.relation }
    })
    res.json({ birthdays })
  } catch (err) {
    console.error('GET /api/calendar/birthdays error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/calendar/birthdays', authenticate, writeLimit, async (req, res) => {
  const { name, birthday, relation } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' })
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' })
  const validRelations = ['self', 'family', 'friend', 'other']
  const rel = validRelations.includes(relation) ? relation : 'family'
  try {
    const [result] = await pool.query(
      'INSERT INTO personal_birthdays (user_id, name, birthday, relation) VALUES (?, ?, ?, ?)',
      [req.userId, name.trim().slice(0, 255), birthday, rel]
    )
    res.json({ id: result.insertId, name: name.trim(), birthday, relation: rel })
  } catch (err) {
    console.error('POST /api/calendar/birthdays error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/calendar/birthdays/:id', authenticate, writeLimit, async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid id' })
  const { name, birthday, relation } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' })
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' })
  const validRelations = ['self', 'family', 'friend', 'other']
  const rel = validRelations.includes(relation) ? relation : 'family'
  try {
    const [result] = await pool.query(
      'UPDATE personal_birthdays SET name = ?, birthday = ?, relation = ? WHERE id = ? AND user_id = ?',
      [name.trim().slice(0, 255), birthday, rel, id, req.userId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true, id, name: name.trim(), birthday, relation: rel })
  } catch (err) {
    console.error('PUT /api/calendar/birthdays/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/calendar/birthdays/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid id' })
  try {
    const [result] = await pool.query(
      'DELETE FROM personal_birthdays WHERE id = ? AND user_id = ?',
      [id, req.userId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/calendar/birthdays/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/referrals/dashboard', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    // Referral stats
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?) as total_accepted,
        (SELECT COUNT(*) FROM invitations WHERE inviter_id = ?) as total_invited,
        (SELECT referral_count FROM users WHERE id = ?) as referral_count,
        (SELECT reputation_score FROM users WHERE id = ?) as reputation_score`,
      [req.userId, req.userId, req.userId, req.userId]
    )

    // Earned badges with reward details
    const [badges] = await pool.query(
      `SELECT ub.reward_type, ub.earned_at,
              r.icon, r.title_da, r.title_en, r.description_da, r.description_en, r.threshold, r.reward_points
       FROM user_badges ub JOIN rewards r ON r.type = ub.reward_type
       WHERE ub.user_id = ?
       ORDER BY r.threshold ASC`,
      [req.userId]
    )

    // Recent successful referrals (who joined via this user's invite)
    const [recent] = await pool.query(
      `SELECT u.name, u.handle, u.avatar_url, r.converted_at, r.invite_source
       FROM referrals r JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = ?
       ORDER BY r.converted_at DESC LIMIT 10`,
      [req.userId]
    )

    // Next milestone
    const referralCount = Number(stats.referral_count || 0)
    const nextMilestone = BADGE_THRESHOLDS.find(b => b.threshold > referralCount) || null
    const conversionRate = stats.total_invited > 0
      ? Math.round((referralCount / Number(stats.total_invited)) * 100)
      : 0

    res.json({
      totalInvited: Number(stats.total_invited || 0),
      totalAccepted: referralCount,
      conversionRate,
      reputationScore: Number(stats.reputation_score || 0),
      badges: badges.map(b => ({
        type: b.reward_type,
        icon: b.icon,
        title: lang === 'da' ? b.title_da : b.title_en,
        description: lang === 'da' ? b.description_da : b.description_en,
        earnedAt: b.earned_at,
        threshold: b.threshold,
        points: b.reward_points,
      })),
      recentReferrals: recent.map(r => ({
        name: r.name,
        handle: r.handle,
        avatarUrl: r.avatar_url,
        joinedAt: r.converted_at,
        source: r.invite_source,
      })),
      nextMilestone: nextMilestone
        ? { type: nextMilestone.type, target: nextMilestone.threshold, current: referralCount, remaining: nextMilestone.threshold - referralCount }
        : null,
    })
  } catch (err) {
    console.error('GET /api/referrals/dashboard error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/referrals/leaderboard', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url, u.referral_count, u.reputation_score,
              (SELECT ub.reward_type FROM user_badges ub JOIN rewards r ON r.type = ub.reward_type
               WHERE ub.user_id = u.id ORDER BY r.threshold DESC LIMIT 1) as top_badge_type,
              (SELECT r2.icon FROM rewards r2 WHERE r2.type = (
               SELECT ub2.reward_type FROM user_badges ub2 JOIN rewards r3 ON r3.type = ub2.reward_type
               WHERE ub2.user_id = u.id ORDER BY r3.threshold DESC LIMIT 1)) as top_badge_icon
       FROM users u
       WHERE u.referral_count > 0
       ORDER BY u.referral_count DESC, u.reputation_score DESC
       LIMIT 20`
    )
    res.json(rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      name: r.name,
      handle: r.handle,
      avatarUrl: r.avatar_url,
      referralCount: Number(r.referral_count),
      reputationScore: Number(r.reputation_score),
      topBadge: r.top_badge_type ? { type: r.top_badge_type, icon: r.top_badge_icon } : null,
      isMe: r.id === req.userId,
    })))
  } catch (err) {
    console.error('GET /api/referrals/leaderboard error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/badges', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [all] = await pool.query('SELECT * FROM rewards ORDER BY threshold ASC')
    const [earned] = await pool.query('SELECT reward_type, earned_at FROM user_badges WHERE user_id = ?', [req.userId])
    const earnedMap = new Map(earned.map(e => [e.reward_type, e.earned_at]))
    const [[user]] = await pool.query('SELECT referral_count FROM users WHERE id = ?', [req.userId])
    const referralCount = Number(user?.referral_count || 0)
    res.json(all.map(r => ({
      type: r.type,
      icon: r.icon,
      title: lang === 'da' ? r.title_da : r.title_en,
      description: lang === 'da' ? r.description_da : r.description_en,
      threshold: r.threshold,
      points: r.reward_points,
      earned: earnedMap.has(r.type),
      earnedAt: earnedMap.get(r.type) || null,
      progress: Math.min(referralCount, r.threshold),
    })))
  } catch (err) {
    console.error('GET /api/badges error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/share/track', authenticate, async (req, res) => {
  const { shareType, targetId, platform, utmCampaign } = req.body
  const validTypes = ['post', 'profile', 'invite']
  if (!validTypes.includes(shareType)) return res.status(400).json({ error: 'Invalid share type' })
  try {
    await pool.query(
      'INSERT INTO share_events (user_id, share_type, target_id, platform, utm_campaign) VALUES (?, ?, ?, ?, ?)',
      [req.userId, shareType, targetId || null, platform || null, utmCampaign || null]
    )
    // Increment post share count if applicable
    if (shareType === 'post' && targetId) {
      await pool.query('UPDATE posts SET share_count = share_count + 1 WHERE id = ? AND author_id = ?', [targetId, req.userId])
      autoSignalPost(req.userId, targetId, 'share')
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/config', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM admin_settings WHERE key_name IN ('media_max_files','marketplace_max_photos','feedback_placement')"
    )
    const cfg = {}
    for (const r of rows) cfg[r.key_name] = r.key_value
    if (cfg.media_max_files) cfg.mediaMaxFiles = parseInt(cfg.media_max_files, 10) || 4
    if (cfg.marketplace_max_photos) cfg.marketplaceMaxPhotos = parseInt(cfg.marketplace_max_photos, 10) || 4
    cfg.feedbackPlacement = cfg.feedback_placement || 'floating'
    res.json({ config: cfg })
  } catch { res.json({ config: {} }) }
})


const CHANGELOG_ENTRIES = [
  { date: '2026-04', icon: '📰', da: 'Offentlig blog med AI-oversættelse — redaktører kan publicere nyheder og blogindlæg med automatisk dansk/engelsk-oversættelse via Mistral', en: 'Public blog with AI translation — editors can publish news and blog posts with automatic Danish/English translation via Mistral' },
  { date: '2026-04', icon: '🔀', da: 'Feed-opdeling — skift mellem Fællesskab- og Erhvervsfeed med ét klik; hvert opslag husker hvilken tilstand det blev skrevet i', en: 'Feed separation — switch between Community and Business feeds with one click; each post remembers which mode it was written in' },
  { date: '2026-04', icon: '👥', da: 'Følgere og du følger — se hvem der følger dig og hvem du følger under Forbindelser', en: 'Followers and following — see who follows you and who you follow under Connections' },
  { date: '2026-04', icon: '🎥', da: 'Automatisk videokonvertering — uploadede videoer transskodes til H.264/AAC MP4 for universel browserkompatibilitet', en: 'Automatic video conversion — uploaded videos are transcoded to H.264/AAC MP4 for universal browser compatibility' },
  { date: '2026-04', icon: '🛍️', da: 'Nøgleordsbeskeder på markedspladsen — modtag notifikation, når et nyt opslag matcher dine gemte søgeord', en: 'Marketplace keyword alerts — get notified when a new listing matches your saved keywords' },
  { date: '2026-04', icon: '🔍', da: 'Opdag nye forbindelser — discoverykortet i feedet foreslår nye venner og virksomheder baseret på fælles interesser', en: 'Discover new connections — the discovery card in the feed suggests new friends and businesses based on shared interests' },
  { date: '2026-04', icon: '💬', da: 'Brugerfeedback — rapportér fejl, manglende funktioner og forslag direkte fra "Om Fellis"-siden', en: 'User feedback — report bugs, missing features and suggestions directly from the About page' },
  { date: '2026-03', icon: '📡', da: 'RTMP livestreaming via mediamtx — stream live med OBS eller Streamlabs direkte til fellis.eu. Optagelsen gemmes automatisk som et reel, når du stopper.', en: 'RTMP livestreaming via mediamtx — go live with OBS or Streamlabs directly to fellis.eu. The recording is automatically saved as a reel when you stop.' },
  { date: '2026-03', icon: '📄', da: 'CV-profil og jobansøgning — tilføj erhvervserfaring, uddannelse og sprog til din profil og vedhæft CV og ansøgningsbrev direkte i jobopslag. AI-assistance via Mistral hjælper dig med at skrive dem.', en: 'CV profile and job applications — add work experience, education and languages to your profile and attach a CV and cover letter directly in job listings. AI assistance via Mistral helps you write them.' },
  { date: '2026-03', icon: '🌍', da: 'Flersproget infrastruktur — sitet er klar til nye sprog', en: 'Multi-language infrastructure — site is ready for new languages' },
  { date: '2026-03', icon: '💳', da: 'Mollie betalingsgateway — betal for reklamefrit abonnement via MobilePay, Visa, Mastercard m.fl.', en: 'Mollie payment gateway — pay for ad-free subscription via MobilePay, Visa, Mastercard etc.' },
  { date: '2026-03', icon: '🕰️', da: 'Memories — "På denne dag": se dine opslag fra tidligere år', en: 'Memories — "On this day": see your posts from previous years' },
  { date: '2026-02', icon: '🏢', da: 'Business-tilstand — skift til businesskonto og få adgang til ekstra funktioner', en: 'Business mode — switch to a business account and unlock extra features' },
  { date: '2026-02', icon: '💼', da: 'Stillingsopslag — businessbrugere kan oprette og administrere jobs direkte på platformen', en: 'Job listings — business users can create and manage job posts directly on the platform' },
  { date: '2026-02', icon: '📅', da: 'Planlagte opslag — opret opslag og planlæg dem til fremtidig publicering', en: 'Scheduled posts — create posts and schedule them for future publishing' },
  { date: '2026-02', icon: '🤝', da: 'CRM-noter — tilføj private noter til dine forbindelser', en: 'CRM notes — add private notes to your connections' },
  { date: '2026-01', icon: '🖼️', da: 'Medier i beskeder — send billeder og filer direkte i samtaler', en: 'Media in messages — send images and files directly in conversations' },
  { date: '2026-01', icon: '📊', da: 'Analytics-dashboard — businessbrugere får indsigt i profilvisninger og engagement', en: 'Analytics dashboard — business users get insights into profile views and engagement' },
  { date: '2025-12', icon: '🛡️', da: 'Moderationssystem — rapportér indhold, keywordfiltre og moderatorroller', en: 'Moderation system — report content, keyword filters and moderator roles' },
  { date: '2025-12', icon: '🔔', da: 'In-app notifikationer og email-notifikationer ved vigtige hændelser', en: 'In-app and email notifications for important events' },
  { date: '2025-11', icon: '🏷️', da: 'Feed-kategorier — kategorisér opslag og filtrer feedet efter kategori', en: 'Feed categories — categorise posts and filter the feed by category' },
]

router.get('/changelog', authenticate, async (req, res) => {
  const lang = req.query.lang || 'da'
  const entries = CHANGELOG_ENTRIES.map(e => ({
    date: e.date,
    icon: e.icon,
    text: lang === 'en' ? e.en : e.da,
  }))
  res.json({ entries })
})


router.get('/cv/profile', authenticate, async (req, res) => {
  try {
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, sort_order ASC, start_date DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY sort_order ASC, start_year DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const me = await pool.query(
      'SELECT job_title, company, industry, seniority, skills, bio_da, bio_en, name, location FROM users WHERE id = ?',
      [req.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    // cv_public fetched separately — column may not exist on all installs yet
    const cvPublic = await pool.query('SELECT cv_public FROM users WHERE id = ?', [req.userId])
      .then(([[row]]) => row?.cv_public ?? 0).catch(() => 0)
    res.json({ experience, education: edu, languages, profile: { ...me, cv_public: cvPublic } })
  } catch (err) {
    console.error('GET /api/cv/profile error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/cv/profile/:userId', authenticate, async (req, res) => {
  try {
    const [[owner]] = await pool.query(
      'SELECT id FROM users WHERE id = ?', [req.params.userId]
    )
    if (!owner) return res.status(404).json({ error: 'Not found' })
    const cvPublic = await pool.query('SELECT cv_public FROM users WHERE id = ?', [req.params.userId])
      .then(([[row]]) => row?.cv_public ?? 0).catch(() => 0)
    if (!cvPublic && req.userId !== Number(req.params.userId)) {
      return res.status(403).json({ error: 'Profile not public' })
    }
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, sort_order ASC, start_date DESC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY sort_order ASC, start_year DESC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC',
      [req.params.userId]
    ).then(([rows]) => rows).catch(() => [])
    const profile = await pool.query(
      'SELECT job_title, company, industry, seniority, skills, bio_da, bio_en, name, location FROM users WHERE id = ?',
      [req.params.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    res.json({ experience, education: edu, languages, profile: { ...profile, cv_public: cvPublic } })
  } catch (err) {
    console.error('GET /api/cv/profile/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/cv/visibility', authenticate, async (req, res) => {
  try {
    const { cv_public } = req.body
    await pool.query('UPDATE users SET cv_public = ? WHERE id = ?', [cv_public ? 1 : 0, req.userId])
    res.json({ ok: true, cv_public: !!cv_public })
  } catch (err) {
    console.error('PATCH /api/cv/visibility error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/cv/experience', authenticate, async (req, res) => {
  try {
    const { company, title, start_date, end_date, is_current, description, sort_order } = req.body
    if (!company || !title) return res.status(400).json({ error: 'Company and title required' })
    const [result] = await pool.query(
      'INSERT INTO work_experience (user_id, company, title, start_date, end_date, is_current, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, company, title, start_date || null, (is_current ? null : end_date || null), is_current ? 1 : 0, description || null, sort_order || 0]
    )
    const [[entry]] = await pool.query('SELECT * FROM work_experience WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    console.error('POST /api/cv/experience error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/cv/experience/:id', authenticate, async (req, res) => {
  try {
    const { company, title, start_date, end_date, is_current, description, sort_order } = req.body
    if (!company || !title) return res.status(400).json({ error: 'Company and title required' })
    await pool.query(
      'UPDATE work_experience SET company=?, title=?, start_date=?, end_date=?, is_current=?, description=?, sort_order=? WHERE id=? AND user_id=?',
      [company, title, start_date || null, (is_current ? null : end_date || null), is_current ? 1 : 0, description || null, sort_order || 0, req.params.id, req.userId]
    )
    const [[entry]] = await pool.query('SELECT * FROM work_experience WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) {
    console.error('PUT /api/cv/experience/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/cv/experience/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM work_experience WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/experience/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/cv/education', authenticate, async (req, res) => {
  try {
    const { institution, degree, field, start_year, end_year, description, sort_order } = req.body
    if (!institution) return res.status(400).json({ error: 'Institution required' })
    const [result] = await pool.query(
      'INSERT INTO education (user_id, institution, degree, field, start_year, end_year, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, institution, degree || null, field || null, start_year || null, end_year || null, description || null, sort_order || 0]
    )
    const [[entry]] = await pool.query('SELECT * FROM education WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    console.error('POST /api/cv/education error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/cv/education/:id', authenticate, async (req, res) => {
  try {
    const { institution, degree, field, start_year, end_year, description, sort_order } = req.body
    if (!institution) return res.status(400).json({ error: 'Institution required' })
    await pool.query(
      'UPDATE education SET institution=?, degree=?, field=?, start_year=?, end_year=?, description=?, sort_order=? WHERE id=? AND user_id=?',
      [institution, degree || null, field || null, start_year || null, end_year || null, description || null, sort_order || 0, req.params.id, req.userId]
    )
    const [[entry]] = await pool.query('SELECT * FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) {
    console.error('PUT /api/cv/education/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/cv/education/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/education/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/cv/languages', authenticate, async (req, res) => {
  try {
    const [languages] = await pool.query('SELECT * FROM user_languages WHERE user_id = ? ORDER BY created_at ASC', [req.userId])
    res.json({ languages })
  } catch (err) {
    console.error('GET /api/cv/languages error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/cv/languages', authenticate, async (req, res) => {
  try {
    const { language, proficiency } = req.body
    if (!language) return res.status(400).json({ error: 'Language required' })
    const valid = ['basic', 'conversational', 'professional', 'fluent', 'native']
    const prof = valid.includes(proficiency) ? proficiency : 'conversational'
    const [result] = await pool.query(
      'INSERT INTO user_languages (user_id, language, proficiency) VALUES (?, ?, ?)',
      [req.userId, language.trim(), prof]
    )
    const [[entry]] = await pool.query('SELECT * FROM user_languages WHERE id = ?', [result.insertId])
    res.json(entry)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Language already added' })
    console.error('POST /api/cv/languages error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/cv/languages/:id', authenticate, async (req, res) => {
  try {
    const { proficiency } = req.body
    const valid = ['basic', 'conversational', 'professional', 'fluent', 'native']
    if (!valid.includes(proficiency)) return res.status(400).json({ error: 'Invalid proficiency' })
    await pool.query('UPDATE user_languages SET proficiency = ? WHERE id = ? AND user_id = ?', [proficiency, req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/cv/languages/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/cv/languages/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_languages WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/cv/languages/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/cv/generate', authenticate, async (req, res) => {
  try {
    const { job_id, type } = req.body // type: 'cv' | 'letter' | 'both'
    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = ? ORDER BY is_current DESC, start_date DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const edu = await pool.query(
      'SELECT * FROM education WHERE user_id = ? ORDER BY start_year DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const languages = await pool.query(
      'SELECT language, proficiency FROM user_languages WHERE user_id = ? ORDER BY proficiency DESC',
      [req.userId]
    ).then(([rows]) => rows).catch(() => [])
    const me = await pool.query(
      'SELECT name, job_title, company, industry, seniority, skills, bio_da, bio_en, location FROM users WHERE id = ?',
      [req.userId]
    ).then(([[row]]) => row || {}).catch(() => ({}))
    let job = null
    if (job_id) {
      const [[j]] = await pool.query('SELECT title, description, requirements, company_id FROM jobs WHERE id = ?', [job_id]).catch(() => [[null]])
      if (j) {
        const [[c]] = await pool.query('SELECT name FROM companies WHERE id = ?', [j.company_id]).catch(() => [[null]])
        job = { ...j, company_name: c?.name || '' }
      }
    }

    const skillsList = me.skills ? me.skills.split(',').map(s => s.trim()).filter(Boolean) : []
    const langList = languages.map(l => `${l.language} (${l.proficiency})`).join(', ')
    const hasProfile = !!(experience.length || edu.length || skillsList.length)

    // ── Build structured profile summary (used by both AI and template paths) ──
    const profileSummary = [
      `Name: ${me.name || ''}`,
      me.location ? `Location: ${me.location}` : '',
      me.job_title ? `Current title: ${[me.seniority, me.job_title].filter(Boolean).join(' ')}` : '',
      me.company ? `Current company: ${me.company}` : '',
      me.industry ? `Industry: ${me.industry}` : '',
      (me.bio_da || me.bio_en) ? `Bio: ${me.bio_da || me.bio_en}` : '',
      skillsList.length ? `Skills: ${skillsList.join(', ')}` : '',
      langList ? `Languages: ${langList}` : '',
      experience.length ? '\nWork experience:\n' + experience.map(e => {
        const from = e.start_date ? new Date(e.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : ''
        const to = e.is_current ? 'present' : (e.end_date ? new Date(e.end_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '')
        return `  - ${e.title} at ${e.company}${from || to ? ` (${[from, to].filter(Boolean).join(' – ')})` : ''}${e.description ? ': ' + e.description : ''}`
      }).join('\n') : '',
      edu.length ? '\nEducation:\n' + edu.map(e =>
        `  - ${[e.degree, e.field].filter(Boolean).join(', ')}${e.degree || e.field ? ' at ' : ''}${e.institution}${e.start_year || e.end_year ? ` (${[e.start_year, e.end_year].filter(Boolean).join('–')})` : ''}`
      ).join('\n') : '',
    ].filter(Boolean).join('\n')

    const jobContext = job ? [
      `Job title: ${typeof job.title === 'string' ? job.title : job.title?.da || ''}`,
      `Company: ${job.company_name}`,
      job.description ? `Description: ${job.description}` : '',
      job.requirements ? `Requirements: ${job.requirements}` : '',
    ].filter(Boolean).join('\n') : ''

    let cvText = ''
    let letterText = ''

    // ── CV generation ─────────────────────────────────────────────────────────
    if (!type || type === 'cv' || type === 'both') {
      if (MISTRAL_API_KEY && hasProfile) {
        const system = `You are a professional CV writer. Write a clean, concise, professional CV in the same language as the user's profile (use Danish if bio/name suggests Danish, otherwise English). Format in plain text with clear sections. Be specific and impactful, not generic. Output only the CV text, nothing else.`
        const prompt = `Write a professional CV for this person:\n\n${profileSummary}${jobContext ? `\n\nTargeted at this job:\n${jobContext}` : ''}`
        const aiResult = await callMistral(system, prompt)
        cvText = aiResult || buildTemplateCV(me, experience, edu, skillsList, langList)
      } else {
        cvText = buildTemplateCV(me, experience, edu, skillsList, langList)
      }
    }

    // ── Cover letter generation ───────────────────────────────────────────────
    if (type === 'letter' || type === 'both') {
      if (MISTRAL_API_KEY && hasProfile) {
        const jobTitle = job ? (typeof job.title === 'string' ? job.title : job.title?.da || '') : ''
        const companyName = job?.company_name || ''
        const system = `You are an expert cover letter writer. Write a compelling, personalized cover letter in Danish (always use Danish unless the job posting is clearly in English). It should be warm, confident, and specific — not generic. 3–4 paragraphs. Output only the letter text, nothing else.`
        const prompt = [
          `Write a cover letter for this applicant:`,
          profileSummary,
          jobContext ? `\nThey are applying for:\n${jobContext}` : '',
          `\nToday's date: ${new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          `Address it to: ${companyName || 'the hiring team'}`,
          jobTitle ? `Position applied for: ${jobTitle}` : '',
        ].filter(Boolean).join('\n')
        const aiResult = await callMistral(system, prompt)
        letterText = aiResult || buildTemplateLetter(me, experience, skillsList, langList, job)
      } else {
        letterText = buildTemplateLetter(me, experience, skillsList, langList, job)
      }
    }

    res.json({ cv: cvText, letter: letterText, hasProfile, aiPowered: !!(MISTRAL_API_KEY && hasProfile) })
  } catch (err) {
    console.error('POST /api/cv/generate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/reports', authenticate, async (req, res) => {
  const { target_type, target_id, reason, details } = req.body
  if (!['post', 'group', 'reel', 'comment', 'user', 'reel_comment', 'message'].includes(target_type)) return res.status(400).json({ error: 'Invalid target_type' })
  if (!target_id || !reason) return res.status(400).json({ error: 'target_id and reason required' })
  try {
    // Prevent duplicate reports from same user on same target
    const [existing] = await pool.query(
      'SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = "pending"',
      [req.userId, target_type, target_id]
    )
    if (existing.length > 0) return res.json({ ok: true, duplicate: true })
    await pool.query(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)',
      [req.userId, target_type, target_id, reason, details || null]
    )

    // Notify group moderators/admins when a group post is reported
    if (target_type === 'post') {
      const [[post]] = await pool.query(
        'SELECT group_id, author_id FROM posts WHERE id = ?', [target_id]
      ).catch(() => [[null]])
      if (post?.group_id) {
        const [mods] = await pool.query(
          `SELECT user_id FROM conversation_participants
           WHERE conversation_id = ? AND role IN ('admin','moderator') AND status = 'active' AND user_id != ?`,
          [post.group_id, req.userId]
        ).catch(() => [[]])
        const [[grp]] = await pool.query(
          'SELECT name, slug, created_by FROM conversations WHERE id = ?', [post.group_id]
        ).catch(() => [[null]])
        if (grp) {
          const targets = new Set(mods.map(m => m.user_id))
          targets.add(grp.created_by)
          targets.delete(req.userId)
          for (const uid of targets) {
            await createNotification(
              uid, 'group_report',
              `Et opslag i gruppen "${grp.name}" er blevet anmeldt`,
              `A post in the group "${grp.name}" has been reported`,
              req.userId, grp.slug
            ).catch(() => {})
          }
        }
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/reports error:', err)
    res.status(500).json({ error: 'Failed to submit report' })
  }
})


router.get('/moderation/my-request', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT is_moderator, moderator_candidate, moderator_candidate_note, moderator_candidate_at FROM users WHERE id = ?',
      [req.userId]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    const isModerator = !!user.is_moderator
    let request = null
    if (user.moderator_candidate) {
      const note = user.moderator_candidate_note || ''
      const isDenied = note.startsWith('[denied]')
      request = {
        status: isDenied ? 'denied' : 'pending',
        note: isDenied ? note.replace(/^\[denied\]\s*/, '') : note,
        submitted_at: user.moderator_candidate_at
      }
    }
    res.json({ request, isModerator })
  } catch (err) {
    console.error('GET /api/moderation/my-request error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/moderation/request', authenticate, async (req, res) => {
  const { reason } = req.body
  try {
    await pool.query(
      'UPDATE users SET moderator_candidate = 1, moderator_candidate_note = ?, moderator_candidate_at = NOW() WHERE id = ?',
      [reason || '', req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/moderation/request', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET moderator_candidate = 0, moderator_candidate_note = NULL, moderator_candidate_at = NULL WHERE id = ?',
      [req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.all('/stub/:fn', authenticate, (req, res) => res.json({ ok: true }))


router.post('/easter-eggs/event', authenticate, async (req, res) => {
  try {
    const { eggId, event = 'activated' } = req.body || {}
    if (!eggId) return res.status(400).json({ error: 'Missing eggId' })
    const validEvents = ['discovered', 'activated']
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Invalid event' })
    await pool.query(
      'INSERT INTO easter_egg_events (user_id, egg_id, event) VALUES (?, ?, ?)',
      [req.userId, eggId, event]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/easter-eggs/event error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/easter-eggs', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT egg_id,
              SUM(IF(event='discovered',1,0)) AS discovered_count,
              SUM(1) AS activation_count,
              MIN(IF(event='discovered', activated_at, NULL)) AS first_discovered_at
       FROM easter_egg_events WHERE user_id = ?
       GROUP BY egg_id`,
      [req.userId]
    )
    const eggs = {}
    for (const r of rows) {
      eggs[r.egg_id] = {
        discovered: r.discovered_count > 0,
        activationCount: Number(r.activation_count),
        firstDiscoveredAt: r.first_discovered_at || null,
      }
    }
    res.json({ eggs })
  } catch (err) {
    console.error('GET /api/easter-eggs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/easter-eggs/hints', async (req, res) => {
  const DEFAULT_HINTS = [
    { id: 'chuck',    hint: '↑↑↓↓←→←→ — klassisk!' },
    { id: 'matrix',   hint: 'Følg den hvide kanin' },
    { id: 'flip',     hint: 'Verden set fra en anden vinkel' },
    { id: 'retro',    hint: 'Tilbage til rødderne' },
    { id: 'gravity',  hint: 'Newton havde ret om feeds' },
    { id: 'party',    hint: 'Festen venter på dig' },
    { id: 'rickroll', hint: 'Nysgerrighed har en pris' },
    { id: 'watcher',  hint: 'Hvem kigger på hvem?' },
    { id: 'riddler',  hint: 'Spørgsmålet er svaret' },
    { id: 'phantom',  hint: 'Ikke alle besøgende er synlige' },
  ]
  try {
    const [[row]] = await pool.query(
      "SELECT key_value FROM admin_settings WHERE key_name = 'easter_egg_config'"
    ).catch(() => [[null]])
    const cfg = row ? JSON.parse(row.key_value || '{}') : {}
    const hints = []
    for (const [eggId, ec] of Object.entries(cfg)) {
      if (ec.hintsEnabled && ec.hintText?.trim()) {
        hints.push({ id: eggId, hint: ec.hintText.trim() })
      }
    }
    res.json({ hints: hints.length ? hints : DEFAULT_HINTS })
  } catch (err) {
    console.error('GET /api/easter-eggs/hints error:', err.message)
    res.json({ hints: DEFAULT_HINTS })
  }
})


router.post('/badges/evaluate', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    await recordLoginDay(userId)

    const stats = await computeUserStats(userId)
    if (!stats) return res.json({ newBadges: [] })

    // Get already-earned badge IDs
    const [earnedRows] = await pool.query(
      'SELECT badge_id FROM earned_badges WHERE user_id = ?', [userId]
    )
    const earnedIds = earnedRows.map(r => r.badge_id)

    // Get disabled badge IDs
    const [disabledRows] = await pool.query(
      'SELECT badge_id FROM badge_config WHERE enabled = 0'
    )
    const disabledIds = disabledRows.map(r => r.badge_id)

    const newIds = evaluateBadges(stats, earnedIds, disabledIds)
    if (!newIds.length) return res.json({ newBadges: [] })

    const lang = req.lang || 'da'
    const now = new Date()
    const newBadges = []

    for (const badgeId of newIds) {
      try {
        await pool.query(
          'INSERT IGNORE INTO earned_badges (user_id, badge_id, awarded_at) VALUES (?, ?, ?)',
          [userId, badgeId, now]
        )
        const def = BADGE_BY_ID[badgeId]
        if (def) {
          const badge = {
            id: badgeId,
            name: def.name[lang] || def.name.da,
            description: def.description[lang] || def.description.da,
            tier: def.tier,
            category: def.category,
            icon: def.icon,
            awardedAt: now,
          }

          // Award ad-free days if this badge has a day value
          const daysToAward = BADGE_AD_FREE_DAYS[badgeId] || 0
          if (daysToAward > 0) {
            await pool.query(
              `INSERT INTO adfree_days_bank (user_id, days_banked, last_updated)
               VALUES (?, ?, NOW())
               ON DUPLICATE KEY UPDATE
               days_banked = days_banked + VALUES(days_banked),
               last_updated = NOW()`,
              [userId, daysToAward]
            )
            badge.adfreeAdded = daysToAward
          }

          newBadges.push(badge)

          // Create a persistent notification so the user sees it in their notification feed
          const nameDa = def.name.da || def.name.en
          const nameEn = def.name.en || def.name.da
          await createNotification(
            userId,
            'badge',
            `Du har optjent badgen ${def.icon} ${nameDa}!`,
            `You earned the ${def.icon} ${nameEn} badge!`
          )
        }
      } catch { /* INSERT IGNORE handles duplicates */ }
    }

    res.json({ newBadges })
  } catch (err) {
    console.error('POST /api/badges/evaluate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/badges/earned', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [rows] = await pool.query(
      'SELECT badge_id, awarded_at FROM earned_badges WHERE user_id = ? ORDER BY awarded_at ASC',
      [req.userId]
    )
    const badges = rows.map(r => {
      const def = BADGE_BY_ID[r.badge_id]
      if (!def) return null
      return {
        id: r.badge_id,
        name: def.name[lang] || def.name.da,
        description: def.description[lang] || def.description.da,
        tier: def.tier,
        category: def.category,
        icon: def.icon,
        awardedAt: r.awarded_at,
      }
    }).filter(Boolean)
    res.json({ badges })
  } catch (err) {
    console.error('GET /api/badges/earned error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/badges/all', authenticate, async (req, res) => {
  try {
    const lang = req.lang || 'da'
    const [disabledRows] = await pool.query('SELECT badge_id FROM badge_config WHERE enabled = 0')
    const disabledSet = new Set(disabledRows.map(r => r.badge_id))
    const defs = BADGES.map(b => ({
      id: b.id,
      name: b.name[lang] || b.name.da,
      description: b.description[lang] || b.description.da,
      tier: b.tier,
      category: b.category,
      icon: b.icon,
      enabled: !disabledSet.has(b.id),
    }))
    res.json({ badges: defs })
  } catch (err) {
    console.error('GET /api/badges/all error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/geocode', async (req, res) => {
  const q = req.query.q
  const lang = req.query.lang || 'da'
  if (!q || q.length < 2) return res.json([])
  const now = Date.now()
  const wait = 1100 - (now - nominatimLastCall)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  nominatimLastCall = Date.now()
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=${lang}`
    const r = await fetch(url, { headers: { 'User-Agent': 'fellis.eu/1.0 (contact@fellis.eu)' } })
    if (!r.ok) return res.status(r.status).json([])
    const data = await r.json()
    res.json(data)
  } catch {
    res.status(502).json([])
  }
})


router.get('/geocode/reverse', async (req, res) => {
  const lat = parseFloat(req.query.lat)
  const lng = parseFloat(req.query.lng)
  const lang = req.query.lang || 'da'
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Invalid coordinates' })
  const now = Date.now()
  const wait = 1100 - (now - nominatimLastCall)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  nominatimLastCall = Date.now()
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1&accept-language=${lang}`
    const r = await fetch(url, { headers: { 'User-Agent': 'fellis.eu/1.0 (contact@fellis.eu)' } })
    if (!r.ok) return res.status(r.status).json({ error: 'Reverse geocode failed' })
    const data = await r.json()
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Reverse geocode failed' })
  }
})


router.post('/upload/file', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const header = Buffer.alloc(16)
    const fd = fs.openSync(req.file.path, 'r')
    fs.readSync(fd, header, 0, 16, 0)
    fs.closeSync(fd)
    if (!validateMagicBytes(header, req.file.mimetype)) {
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ error: 'File content does not match declared type' })
    }
    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
    res.json({ url: `/uploads/${req.file.filename}`, type, mime: req.file.mimetype })
  } catch (err) {
    console.error('POST /api/upload/file error:', err.message)
    res.status(500).json({ error: 'Upload failed' })
  }
})


router.post('/signals', authenticate, async (req, res) => {
  try {
    const raw = req.body.signals
    if (!Array.isArray(raw) || raw.length === 0) return res.json({ ok: true, processed: 0 })
    if (raw.length > 100) return res.status(400).json({ error: 'Too many signals per batch (max 100)' })

    const expanded = []
    for (const s of raw) {
      if (!SIGNAL_VALUES[s.signal_type] && SIGNAL_VALUES[s.signal_type] !== 0) continue
      let slugs = Array.isArray(s.interest_slugs) ? s.interest_slugs : []
      if (slugs.length === 0 && s.source_type === 'post' && s.source_id) {
        try {
          const [[post]] = await pool.query('SELECT categories FROM posts WHERE id=?', [parseInt(s.source_id)])
          if (post?.categories) slugs = JSON.parse(post.categories) || []
        } catch {}
      }
      const ctx = ['professional', 'hobby', 'purchase'].includes(s.context) ? s.context : 'hobby'
      const sv = SIGNAL_VALUES[s.signal_type]
      for (const slug of slugs) {
        expanded.push({
          user_id: req.userId, interest_slug: slug, signal_type: s.signal_type,
          signal_value: sv, context: ctx,
          source_type: s.source_type || null, source_id: s.source_id ? parseInt(s.source_id) : null,
        })
      }
    }

    if (expanded.length > 0) {
      const values = expanded.map(s => [
        s.user_id, s.interest_slug, s.signal_type, s.signal_value, s.context, s.source_type, s.source_id
      ])
      await pool.query(
        'INSERT INTO interest_signals (user_id, interest_slug, signal_type, signal_value, context, source_type, source_id) VALUES ?',
        [values]
      )
      await applySignals(req.userId, expanded)
    }

    res.json({ ok: true, processed: expanded.length })
  } catch (err) {
    console.error('POST /api/signals error:', err.message)
    res.status(500).json({ error: 'Failed to ingest signals' })
  }
})


router.get('/livestream/status', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      "SELECT key_value FROM admin_settings WHERE key_name = 'livestream_enabled'"
    )
    res.json({ enabled: row?.key_value === '1' })
  } catch {
    res.json({ enabled: false })
  }
})


router.post('/stream/auth', async (req, res) => {
  try {
    // mediamtx may also pass Authorization header; support both sources
    const streamKey = req.body?.name || req.body?.key || null
    if (!streamKey) return res.status(401).json({ error: 'Missing stream key' })

    // Look up the user owning this stream key
    const [rows] = await pool.query(
      'SELECT id, mode, streaming_access FROM users WHERE stream_key = ? AND status = "active"',
      [streamKey]
    ).catch(() =>
      // Fallback if streaming_access column does not yet exist
      pool.query(
        'SELECT id, mode FROM users WHERE stream_key = ? AND status = "active"',
        [streamKey]
      )
    )

    if (rows.length === 0) return res.status(401).json({ error: 'Invalid stream key' })

    const user = rows[0]

    // Business accounts: check optional streaming_access flag
    if (user.mode === 'business' && user.streaming_access === 0) {
      return res.status(401).json({ error: 'Streaming access not enabled' })
    }

    // Record the stream start in livestreams table (best-effort)
    await pool.query(
      `INSERT INTO livestreams (user_id, stream_key, status, started_at)
       VALUES (?, ?, 'live', NOW())
       ON DUPLICATE KEY UPDATE status = 'live', started_at = NOW()`,
      [user.id, streamKey]
    ).catch(() =>
      pool.query(
        `INSERT INTO livestreams (user_id, status, started_at) VALUES (?, 'live', NOW())`,
        [user.id]
      ).catch(() => {})
    )

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('POST /api/stream/auth error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/stream/end', async (req, res) => {
  const streamKey = req.body?.name || req.body?.key || null
  if (!streamKey) return res.status(400).json({ error: 'Missing stream key' })

  // Acknowledge to mediamtx immediately — encoding happens async
  res.status(200).json({ ok: true })

  try {
    // Find the user and the livestream record
    const [userRows] = await pool.query(
      'SELECT id FROM users WHERE stream_key = ?',
      [streamKey]
    )
    if (userRows.length === 0) return
    const userId = userRows[0].id

    // Update livestreams: mark ended
    const [lsRows] = await pool.query(
      `UPDATE livestreams SET status = 'ended', ended_at = NOW()
       WHERE user_id = ? AND status = 'live'
       ORDER BY id DESC LIMIT 1`,
      [userId]
    ).catch(() => [[]])

    // Derive the livestream row id for reel linking
    const [[lsRow]] = await pool.query(
      'SELECT id FROM livestreams WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    ).catch(() => [[null]])
    const livestreamId = lsRow?.id ?? null

    // Encode recording: /var/recordings/<streamKey>.flv → uploads/reels/<streamKey>.mp4
    const flvPath = path.join(RECORDINGS_DIR, `${streamKey}.flv`)
    const reelsDir = path.join(UPLOADS_DIR, 'reels')
    if (!fs.existsSync(reelsDir)) fs.mkdirSync(reelsDir, { recursive: true })
    const mp4Path = path.join(reelsDir, `${streamKey}.mp4`)

    if (!fs.existsSync(flvPath)) {
      console.log(`[stream/end] No recording found at ${flvPath}, skipping reel creation`)
      return
    }

    // Convert FLV → MP4
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)

    try {
      await execFileAsync('ffmpeg', [
        '-y', '-i', flvPath,
        '-c:v', 'copy', '-c:a', 'aac',
        '-movflags', '+faststart',
        mp4Path,
      ])
    } catch (ffErr) {
      console.error('[stream/end] ffmpeg FLV→MP4 failed:', ffErr.message)
      return
    }

    // Delete .flv after successful encode
    fs.unlink(flvPath, err => {
      if (err) console.warn('[stream/end] Could not delete FLV:', err.message)
    })

    // Create reel entry (handles trimming + DB insert via shared livestream.js logic)
    await createReelFromLivestream({
      userId,
      livestreamId,
      recordingPath: mp4Path,
      uploadsDir: UPLOADS_DIR,
      pool,
    })
  } catch (err) {
    console.error('POST /api/stream/end async error:', err.message)
  }
})


router.get('/stream/active', authenticate, async (req, res) => {
  try {
    const paths = await listActivePaths()

    // Only paths that have an active publisher
    const active = paths.filter(p => p.ready === true || p.readyTime != null)

    if (active.length === 0) return res.json({ streams: [] })

    // Resolve stream keys → user info
    const keys = active.map(p => p.name).filter(Boolean)
    let userMap = {}
    if (keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',')
      const [userRows] = await pool.query(
        `SELECT id, name, handle, avatar_url, stream_key
         FROM users WHERE stream_key IN (${placeholders})`,
        keys
      ).catch(() => [[]])
      for (const u of userRows) userMap[u.stream_key] = u
    }

    const streams = active.map(p => ({
      path: p.name,
      readyTime: p.readyTime,
      bytesReceived: p.bytesReceived ?? 0,
      user: userMap[p.name]
        ? {
            id: userMap[p.name].id,
            name: userMap[p.name].name,
            handle: userMap[p.name].handle,
            avatar_url: userMap[p.name].avatar_url,
          }
        : null,
    }))

    res.json({ streams })
  } catch (err) {
    console.error('GET /api/stream/active error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/stream/key', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT stream_key FROM users WHERE id = ?',
      [req.userId]
    )

    let key = user?.stream_key
    if (!key) {
      key = generateStreamKey()
      await pool.query('UPDATE users SET stream_key = ? WHERE id = ?', [key, req.userId])
    }

    res.json({ stream_key: key })
  } catch (err) {
    console.error('GET /api/stream/key error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/stream/key/regenerate', authenticate, async (req, res) => {
  try {
    const key = generateStreamKey()
    await pool.query('UPDATE users SET stream_key = ? WHERE id = ?', [key, req.userId])
    res.json({ stream_key: key })
  } catch (err) {
    console.error('POST /api/stream/key/regenerate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/reviews', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cr.*, u.name AS reviewer_name, u.handle AS reviewer_handle, u.avatar_url AS reviewer_avatar
       FROM company_reviews cr JOIN users u ON u.id=cr.user_id
       WHERE cr.company_id=? ORDER BY cr.created_at DESC`,
      [req.params.id]
    )
    const [[stats]] = await pool.query(
      'SELECT COUNT(*) AS total, AVG(rating) AS avg_rating FROM company_reviews WHERE company_id=?',
      [req.params.id]
    )
    res.json({ reviews: rows, stats })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/reviews', authenticate, writeLimit, async (req, res) => {
  try {
    const { rating, title, body } = req.body
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1–5 required' })
    await pool.query(
      `INSERT INTO company_reviews (company_id, user_id, rating, title, body)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE rating=VALUES(rating), title=VALUES(title), body=VALUES(body), updated_at=NOW()`,
      [req.params.id, req.userId, rating, title || null, body || null]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/companies/:id/reviews', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM company_reviews WHERE company_id=? AND user_id=?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/hours', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM company_business_hours WHERE company_id=? ORDER BY day_of_week',
      [req.params.id]
    )
    res.json({ hours: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/companies/:id/hours', authenticate, async (req, res) => {
  try {
    const { hours } = req.body // array of { day_of_week, open_time, close_time, is_closed }
    // Verify user is member of company
    const [[member]] = await pool.query(
      'SELECT role FROM company_members WHERE company_id=? AND user_id=?',
      [req.params.id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Not a company member' })
    await pool.query('DELETE FROM company_business_hours WHERE company_id=?', [req.params.id])
    for (const h of (hours || [])) {
      await pool.query(
        'INSERT INTO company_business_hours (company_id, day_of_week, open_time, close_time, is_closed) VALUES (?,?,?,?,?)',
        [req.params.id, h.day_of_week, h.open_time || null, h.close_time || null, h.is_closed ? 1 : 0]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/companies/:id/qa', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cq.*,
              a.name AS asker_name, a.avatar_url AS asker_avatar,
              ab.name AS answerer_name
       FROM company_qa cq
       JOIN users a ON a.id=cq.asker_id
       LEFT JOIN users ab ON ab.id=cq.answered_by
       WHERE cq.company_id=?
       ORDER BY cq.created_at DESC`,
      [req.params.id]
    )
    res.json({ questions: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/companies/:id/qa', authenticate, writeLimit, async (req, res) => {
  try {
    const { question } = req.body
    if (!question?.trim()) return res.status(400).json({ error: 'Question required' })
    const [r] = await pool.query(
      'INSERT INTO company_qa (company_id, asker_id, question) VALUES (?,?,?)',
      [req.params.id, req.userId, question.trim()]
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/companies/:companyId/qa/:qaId/answer', authenticate, async (req, res) => {
  try {
    const { answer } = req.body
    if (!answer?.trim()) return res.status(400).json({ error: 'Answer required' })
    const [[member]] = await pool.query(
      'SELECT role FROM company_members WHERE company_id=? AND user_id=?',
      [req.params.companyId, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Not a company member' })
    await pool.query(
      'UPDATE company_qa SET answer=?, answered_by=?, answered_at=NOW() WHERE id=? AND company_id=?',
      [answer.trim(), req.userId, req.params.qaId, req.params.companyId]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/companies/:companyId/qa/:qaId', authenticate, async (req, res) => {
  try {
    const [[qa]] = await pool.query('SELECT asker_id FROM company_qa WHERE id=? AND company_id=?', [req.params.qaId, req.params.companyId])
    if (!qa) return res.status(404).json({ error: 'Not found' })
    // Only asker or company member can delete
    const [[member]] = await pool.query('SELECT role FROM company_members WHERE company_id=? AND user_id=?', [req.params.companyId, req.userId])
    if (qa.asker_id !== req.userId && !member)
      return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM company_qa WHERE id=?', [req.params.qaId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/blog', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.slug, p.title_da, p.title_en, p.summary_da, p.summary_en,
              p.cover_image, p.published_at, p.created_at,
              u.name AS author_name
       FROM blog_posts p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.published = 1
       ORDER BY COALESCE(p.published_at, p.created_at) DESC`
    )
    res.json({ posts: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/blog/:slug', async (req, res) => {
  try {
    const [[post]] = await pool.query(
      `SELECT p.*, u.name AS author_name
       FROM blog_posts p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug = ? AND p.published = 1`,
      [req.params.slug]
    )
    if (!post) return res.status(404).json({ error: 'Not found' })
    res.json(post)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/announcements', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ba.*, u.name AS author_name, u.handle AS author_handle, u.avatar_url AS author_avatar, u.is_verified
       FROM business_announcements ba
       JOIN users u ON u.id = ba.author_id
       JOIN business_follows bf ON bf.business_id = ba.author_id AND bf.follower_id = ?
       ORDER BY ba.created_at DESC LIMIT 30`,
      [req.userId]
    )
    res.json({ announcements: rows })
  } catch (err) {
    console.error('GET /api/announcements error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Company profile (user-centric, for mode=business users) ──────────────────

router.post('/company/profile', authenticate, attachUserMode, async (req, res) => {
  if (req.userMode !== 'business') return res.status(403).json({ error: 'Business account required' })
  const { company_name, cvr, description, category, logo_url, website } = req.body
  if (!company_name || !String(company_name).trim()) {
    return res.status(400).json({ error: 'company_name is required' })
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO company_profiles (user_id, company_name, cvr, description, category, logo_url, website)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         company_name = VALUES(company_name),
         cvr = VALUES(cvr),
         description = VALUES(description),
         category = VALUES(category),
         logo_url = VALUES(logo_url),
         website = VALUES(website)`,
      [req.userId, String(company_name).trim().slice(0, 255),
       cvr ? String(cvr).slice(0, 20) : null,
       description || null, category ? String(category).slice(0, 100) : null,
       logo_url ? String(logo_url).slice(0, 500) : null,
       website ? String(website).slice(0, 500) : null]
    )
    const insertId = result.insertId || null
    const [[profile]] = await pool.query(
      'SELECT * FROM company_profiles WHERE user_id = ?', [req.userId]
    )
    res.json({ success: true, profile })
  } catch (err) {
    console.error('POST /api/company/profile error:', err.message)
    res.status(500).json({ error: 'Failed to save company profile' })
  }
})

router.get('/company/profile/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10)
  if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' })
  try {
    const [[profile]] = await pool.query(
      'SELECT * FROM company_profiles WHERE user_id = ?', [userId]
    )
    if (!profile) return res.status(404).json({ error: 'Company profile not found' })
    res.json(profile)
  } catch (err) {
    console.error('GET /api/company/profile/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
