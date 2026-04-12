/**
 * Facebook Data Import routes — mounted at /api/auth/facebook
 *
 * This is NOT Facebook Login. Users authenticate with Fellis normally.
 * Facebook is used only as a data source to enrich the user's profile.
 *
 * Routes:
 *   GET  /api/auth/facebook              — start OAuth flow (requires Fellis session)
 *   GET  /api/auth/facebook/callback     — OAuth callback from Facebook
 *   GET  /api/auth/facebook/data         — fetch fresh data from Graph API
 *   POST /api/auth/facebook/import       — apply selected fields to user profile
 *   POST /api/auth/facebook/disconnect   — revoke & clear FB token
 *   POST /api/auth/facebook/deauthorize  — webhook: FB deauth callback
 *   POST /api/auth/facebook/delete       — webhook: GDPR data-deletion callback
 */

import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = express.Router()

// ── Config ────────────────────────────────────────────────────────────────────
const FB_APP_ID      = process.env.FB_APP_ID
const FB_APP_SECRET  = process.env.FB_APP_SECRET
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://fellis.eu/api/auth/facebook/callback'
const UPLOADS_DIR    = process.env.UPLOADS_DIR || '/var/www/fellis.eu/uploads'
const SITE_URL       = (process.env.SITE_URL || 'https://fellis.eu').replace(/\/$/, '')
const COOKIE_NAME    = 'fellis_sid'

// Derive a 32-byte AES key from FB_TOKEN_SECRET (SHA-256 so any length input works)
const FB_TOKEN_SECRET = process.env.FB_TOKEN_SECRET || crypto.randomBytes(32).toString('hex')
const ENC_KEY = crypto.createHash('sha256').update(FB_TOKEN_SECRET).digest()

// ── OAuth state store: nonce → {userId, createdAt} ───────────────────────────
const fbOauthStates = new Map()
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [k, v] of fbOauthStates) {
    if (v.createdAt < cutoff) fbOauthStates.delete(k)
  }
}, 10 * 60 * 1000).unref()

// ── Token encryption (AES-256-GCM) ───────────────────────────────────────────
function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

function decryptToken(stored) {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid token format')
  const [ivHex, tagHex, dataHex] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(dataHex, 'hex'), null, 'utf8') + decipher.final('utf8')
}

// ── Session helper ────────────────────────────────────────────────────────────
function getSessionId(req) {
  const fromHeader = req.headers['x-session-id']
  if (fromHeader && fromHeader !== 'null' && fromHeader !== 'undefined') return fromHeader
  const cookies = req.headers.cookie
  if (cookies) {
    const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE_NAME}=`))
    if (match) return match.split('=').slice(1).join('=')
  }
  return null
}

async function requireAuth(req, res, next) {
  const sessionId = getSessionId(req)
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const [rows] = await pool.query(
      'SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()',
      [sessionId]
    )
    if (!rows.length) return res.status(401).json({ error: 'Session expired' })
    req.userId = rows[0].user_id
    next()
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
}

// ── Facebook signed_request verifier (for webhooks) ───────────────────────────
function parseSignedRequest(signedRequest) {
  if (!FB_APP_SECRET || !signedRequest) return null
  const dot = signedRequest.indexOf('.')
  if (dot === -1) return null
  const encodedSig = signedRequest.slice(0, dot)
  const payload    = signedRequest.slice(dot + 1)
  try {
    const sig      = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const expected = crypto.createHmac('sha256', FB_APP_SECRET).update(payload).digest()
    if (sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(sig, expected)) return null
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    )
  } catch {
    return null
  }
}

// ── GET / — initiate OAuth (requires active Fellis session) ───────────────────
router.get('/', requireAuth, (req, res) => {
  if (!FB_APP_ID) return res.status(503).json({ error: 'Facebook not configured' })

  const nonce = crypto.randomBytes(16).toString('hex')
  fbOauthStates.set(nonce, { userId: req.userId, createdAt: Date.now() })

  // Encode userId + nonce as base64url state
  const state = Buffer.from(JSON.stringify({ nonce, userId: req.userId })).toString('base64url')

  const params = new URLSearchParams({
    client_id:     FB_APP_ID,
    redirect_uri:  FB_REDIRECT_URI,
    response_type: 'code',
    state,
    scope: [
      'public_profile', 'email',
      'user_birthday', 'user_hometown', 'user_location',
      'user_gender', 'user_age_range',
      'user_likes', 'user_photos', 'user_videos',
    ].join(','),
  })

  res.redirect(`https://www.facebook.com/v22.0/dialog/oauth?${params}`)
})

// ── GET /callback — OAuth callback from Facebook ───────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query

  if (error || !code || !state) {
    return res.redirect('/?error=fb_denied')
  }

  // Decode and verify state
  let stateData
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
  } catch {
    return res.redirect('/?error=fb_state_invalid')
  }

  const { nonce, userId } = stateData
  if (!nonce || !userId) return res.redirect('/?error=fb_state_invalid')

  const stored = fbOauthStates.get(nonce)
  if (!stored || stored.userId !== userId || Date.now() - stored.createdAt > 10 * 60 * 1000) {
    fbOauthStates.delete(nonce)
    return res.redirect('/?error=fb_state_invalid')
  }
  fbOauthStates.delete(nonce)

  if (!FB_APP_ID || !FB_APP_SECRET) return res.redirect('/?error=fb_not_configured')

  try {
    // Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token?${new URLSearchParams({
        client_id:     FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri:  FB_REDIRECT_URI,
        code,
      })}`
    )
    if (!tokenRes.ok) return res.redirect('/?error=fb_token_failed')
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return res.redirect('/?error=fb_token_failed')

    const accessToken = tokenData.access_token

    // Fetch core user data from Graph API in a single call
    const userRes = await fetch(
      `https://graph.facebook.com/v22.0/me?${new URLSearchParams({
        fields: 'id,name,email,birthday,gender,age_range,hometown,location,picture.type(large),link',
        access_token: accessToken,
      })}`
    )
    if (!userRes.ok) return res.redirect('/?error=fb_data_failed')
    const fbUser = await userRes.json()

    // Encrypt token and persist — never log access tokens
    const encrypted = encryptToken(accessToken)
    await pool.query(
      `UPDATE users
         SET fb_user_id = ?, fb_access_token = ?, fb_connected = 1, fb_connected_at = NOW()
       WHERE id = ?`,
      [fbUser.id || null, encrypted, userId]
    )

    res.redirect('/?fb=connected')
  } catch (err) {
    console.error('Facebook OAuth callback error:', err.message)
    res.redirect('/?error=fb_error')
  }
})

// ── GET /data — fetch fresh data from Graph API ───────────────────────────────
router.get('/data', requireAuth, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT fb_connected, fb_access_token, fb_user_id, fb_connected_at FROM users WHERE id = ?',
      [req.userId]
    )
    if (!user || !user.fb_connected || !user.fb_access_token) {
      return res.status(400).json({ error: 'Facebook not connected' })
    }

    let accessToken
    try {
      accessToken = decryptToken(user.fb_access_token)
    } catch {
      return res.status(500).json({ error: 'Token decryption failed' })
    }

    // Core user fields
    const userRes = await fetch(
      `https://graph.facebook.com/v22.0/me?${new URLSearchParams({
        fields: 'id,name,email,birthday,gender,age_range,hometown,location,picture.type(large),link',
        access_token: accessToken,
      })}`
    )
    if (!userRes.ok) {
      const errBody = await userRes.json().catch(() => ({}))
      return res.status(502).json({ error: 'Facebook API error', detail: errBody?.error?.message })
    }
    const fbUser = await userRes.json()

    // User likes (first 10 pages) — best-effort, ignore errors
    let likes = []
    try {
      const likesRes = await fetch(
        `https://graph.facebook.com/v22.0/me/likes?${new URLSearchParams({
          limit: '10',
          access_token: accessToken,
        })}`
      )
      if (likesRes.ok) {
        const likesData = await likesRes.json()
        likes = likesData.data || []
      }
    } catch {}

    // User photos (first 10) — best-effort
    let photos = []
    try {
      const photosRes = await fetch(
        `https://graph.facebook.com/v22.0/me/photos?${new URLSearchParams({
          limit: '10',
          access_token: accessToken,
        })}`
      )
      if (photosRes.ok) {
        const photosData = await photosRes.json()
        photos = photosData.data || []
      }
    } catch {}

    res.json({ ...fbUser, likes, photos, connected_at: user.fb_connected_at })
  } catch (err) {
    console.error('Facebook /data error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── POST /import — apply selected fields to user profile ─────────────────────
router.post('/import', requireAuth, async (req, res) => {
  const { fields } = req.body
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'fields array required' })
  }

  // Whitelist of importable fields
  const ALLOWED = new Set(['name', 'picture', 'birthday', 'location', 'hometown', 'gender'])
  const requested = fields.filter(f => ALLOWED.has(f))
  if (requested.length === 0) return res.status(400).json({ error: 'No valid fields requested' })

  try {
    const [[user]] = await pool.query(
      'SELECT fb_connected, fb_access_token FROM users WHERE id = ?',
      [req.userId]
    )
    if (!user || !user.fb_connected || !user.fb_access_token) {
      return res.status(400).json({ error: 'Facebook not connected' })
    }

    let accessToken
    try {
      accessToken = decryptToken(user.fb_access_token)
    } catch {
      return res.status(500).json({ error: 'Token decryption failed' })
    }

    // Fetch current data from Facebook
    const userRes = await fetch(
      `https://graph.facebook.com/v22.0/me?${new URLSearchParams({
        fields: 'id,name,email,birthday,gender,age_range,hometown,location,picture.type(large)',
        access_token: accessToken,
      })}`
    )
    if (!userRes.ok) return res.status(502).json({ error: 'Facebook API error' })
    const fbUser = await userRes.json()

    // Build SQL update from requested fields
    const updates = {}

    for (const field of requested) {
      if (field === 'name' && fbUser.name) {
        updates.name = fbUser.name

      } else if (field === 'birthday' && fbUser.birthday) {
        // FB returns MM/DD/YYYY or YYYY-MM-DD depending on permissions
        const bd = fbUser.birthday
        if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
          updates.birthday = bd
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(bd)) {
          const [mm, dd, yyyy] = bd.split('/')
          updates.birthday = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
        }

      } else if (field === 'gender' && fbUser.gender) {
        updates.gender = fbUser.gender

      } else if (field === 'location' && fbUser.location?.name) {
        updates.location = fbUser.location.name

      } else if (field === 'hometown' && fbUser.hometown?.name && !updates.location) {
        // Only fall back to hometown if location wasn't already set
        updates.location = fbUser.hometown.name

      } else if (field === 'picture' && fbUser.picture?.data?.url) {
        try {
          const imgRes = await fetch(fbUser.picture.data.url)
          if (imgRes.ok) {
            const imgBuf = Buffer.from(await imgRes.arrayBuffer())
            const filename = `${crypto.randomUUID()}.jpg`
            const filepath = path.join(UPLOADS_DIR, filename)
            fs.writeFileSync(filepath, imgBuf)
            updates.avatar_url = `/uploads/${filename}`
          }
        } catch (imgErr) {
          console.error('FB profile picture download failed:', imgErr.message)
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No importable data found for the selected fields' })
    }

    // Safe column update — keys come from our own whitelist, not user input
    const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`)
    const values = [...Object.values(updates), req.userId]
    await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, values)

    const [[updated]] = await pool.query(
      'SELECT id, name, avatar_url, birthday, gender, location FROM users WHERE id = ?',
      [req.userId]
    )
    res.json({ ok: true, user: updated })
  } catch (err) {
    console.error('Facebook /import error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── POST /disconnect — revoke app access and clear token ─────────────────────
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT fb_user_id, fb_access_token FROM users WHERE id = ?',
      [req.userId]
    )

    // Revoke app permissions on Facebook's side (best-effort)
    if (user?.fb_user_id && user?.fb_access_token) {
      try {
        const accessToken = decryptToken(user.fb_access_token)
        await fetch(
          `https://graph.facebook.com/v22.0/${encodeURIComponent(user.fb_user_id)}/permissions`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        )
      } catch {}
    }

    await pool.query(
      `UPDATE users
         SET fb_access_token = NULL, fb_connected = 0,
             fb_user_id = NULL, fb_connected_at = NULL
       WHERE id = ?`,
      [req.userId]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('Facebook /disconnect error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── POST /deauthorize — Facebook deauthorization webhook (public) ─────────────
// Called by Facebook when a user removes the app from their FB settings.
router.post('/deauthorize', async (req, res) => {
  const { signed_request } = req.body
  const payload = parseSignedRequest(signed_request)
  if (!payload) return res.status(400).json({ error: 'Invalid signed_request' })

  const fbUserId = payload.user_id
  if (fbUserId) {
    try {
      await pool.query(
        'UPDATE users SET fb_access_token = NULL, fb_connected = 0 WHERE fb_user_id = ?',
        [fbUserId]
      )
    } catch {}
  }

  res.status(200).send('')
})

// ── POST /delete — GDPR data-deletion webhook (public) ───────────────────────
// Called by Facebook when a user requests their data be deleted.
router.post('/delete', async (req, res) => {
  const { signed_request } = req.body
  const payload = parseSignedRequest(signed_request)
  if (!payload) return res.status(400).json({ error: 'Invalid signed_request' })

  const fbUserId = payload.user_id
  if (fbUserId) {
    try {
      await pool.query(
        `UPDATE users
           SET fb_access_token = NULL, fb_connected = 0,
               fb_user_id = NULL, fb_connected_at = NULL
         WHERE fb_user_id = ?`,
        [fbUserId]
      )
    } catch {}
  }

  const confirmationCode = crypto.randomBytes(8).toString('hex')
  res.json({
    url: `${SITE_URL}/facebook-data-deleted`,
    confirmation_code: confirmationCode,
  })
})

export default router
