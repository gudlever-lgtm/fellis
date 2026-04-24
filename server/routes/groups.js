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

const router = express.Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getMemberRole(groupId, userId) {
  const [[row]] = await pool.query(
    'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [groupId, userId]
  )
  return row ? row.role : null
}

async function isAdminOrMod(groupId, userId) {
  const role = await getMemberRole(groupId, userId)
  return role === 'admin' || role === 'moderator'
}

// ── Group Suggestions ────────────────────────────────────────────────────────

router.get('/groups/suggestions', authenticate, async (req, res) => {
  try {
    const [suggestions] = await pool.query(
      `SELECT c.id, c.name, c.category, c.description_da, c.description_en,
              COUNT(DISTINCT cp2.user_id) AS shared_members,
              (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) AS member_count
       FROM conversations c
       JOIN conversation_participants cp2 ON cp2.conversation_id = c.id
       WHERE c.is_public = 1
         AND c.is_group = 1
         AND c.id NOT IN (
           SELECT conversation_id FROM conversation_participants WHERE user_id = ?
         )
         AND cp2.user_id IN (
           SELECT cp3.user_id FROM conversation_participants cp3
           WHERE cp3.conversation_id IN (
             SELECT conversation_id FROM conversation_participants WHERE user_id = ?
           )
           AND cp3.user_id != ?
         )
       GROUP BY c.id
       ORDER BY shared_members DESC, member_count DESC
       LIMIT 5`,
      [req.userId, req.userId, req.userId]
    )

    if (suggestions.length === 0) {
      const [popular] = await pool.query(
        `SELECT c.id, c.name, c.category, c.description_da, c.description_en,
                0 AS shared_members,
                COUNT(cp.user_id) AS member_count
         FROM conversations c
         LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
         WHERE c.is_public = 1
           AND c.is_group = 1
           AND c.id NOT IN (
             SELECT conversation_id FROM conversation_participants WHERE user_id = ?
           )
         GROUP BY c.id
         ORDER BY member_count DESC
         LIMIT 5`,
        [req.userId]
      )
      return res.json({ suggestions: popular })
    }

    res.json({ suggestions })
  } catch (err) {
    console.error('GET /api/groups/suggestions error:', err)
    res.status(500).json({ error: 'Failed to load group suggestions' })
  }
})

// ── Membership ────────────────────────────────────────────────────────────────

// POST /api/groups/:id/join — auto-approve public, request for private
router.post('/groups/:id/join', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id, visibility, is_group FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const existing = await getMemberRole(groupId, req.userId)
    if (existing) return res.status(409).json({ error: 'Already a member' })

    const visibility = group.visibility || 'public'

    if (visibility === 'public') {
      await pool.query(
        'INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, req.userId, 'member']
      )
      await pool.query(
        'UPDATE conversations SET member_count = member_count + 1 WHERE id = ?',
        [groupId]
      )
      return res.json({ ok: true, status: 'joined' })
    }

    // private / hidden — create join request
    const [[pending]] = await pool.query(
      'SELECT id, status FROM group_join_requests WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    )
    if (pending) return res.status(409).json({ error: 'Join request already pending', status: pending.status })

    await pool.query(
      'INSERT INTO group_join_requests (group_id, user_id) VALUES (?, ?)',
      [groupId, req.userId]
    )
    res.json({ ok: true, status: 'pending' })
  } catch (err) {
    console.error('POST /api/groups/:id/join error:', err)
    res.status(500).json({ error: 'Failed to join group' })
  }
})

// POST /api/groups/:id/leave
router.post('/groups/:id/leave', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const role = await getMemberRole(groupId, req.userId)
    if (!role) return res.status(404).json({ error: 'Not a member' })

    if (role === 'admin') {
      const [[adminCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ? AND role = 'admin'",
        [groupId]
      )
      if (adminCount.n <= 1) {
        return res.status(400).json({ error: 'Cannot leave: you are the last admin' })
      }
    }

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, req.userId]
    )
    await pool.query(
      'UPDATE conversations SET member_count = GREATEST(member_count - 1, 0) WHERE id = ?',
      [groupId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/leave error:', err)
    res.status(500).json({ error: 'Failed to leave group' })
  }
})

// GET /api/groups/:id/members
router.get('/groups/:id/members', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id, visibility FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const visibility = group.visibility || 'public'
    if (visibility !== 'public') {
      const role = await getMemberRole(groupId, req.userId)
      if (!role) return res.status(403).json({ error: 'Members only' })
    }

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.avatar, cp.role, cp.joined_at
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = ?
       ORDER BY FIELD(cp.role, 'admin', 'moderator', 'member'), u.name`,
      [groupId]
    )
    res.json({ members })
  } catch (err) {
    console.error('GET /api/groups/:id/members error:', err)
    res.status(500).json({ error: 'Failed to load members' })
  }
})

// PUT /api/groups/:id/members/:userId/role — change role (admin/mod only)
router.put('/groups/:id/members/:userId/role', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(groupId) || isNaN(targetId)) return res.status(400).json({ error: 'Invalid ID' })

  const { role } = req.body
  if (!['moderator', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be moderator or member' })
  }

  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const callerRole = await getMemberRole(groupId, req.userId)
    if (callerRole !== 'admin' && callerRole !== 'moderator') {
      return res.status(403).json({ error: 'Admin or moderator required' })
    }

    const targetRole = await getMemberRole(groupId, targetId)
    if (!targetRole) return res.status(404).json({ error: 'Target user is not a member' })

    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Cannot change your own role' })
    }

    // Prevent demoting another admin unless you're also admin
    if (targetRole === 'admin' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change another admin\'s role' })
    }

    await pool.query(
      'UPDATE conversation_participants SET role = ? WHERE conversation_id = ? AND user_id = ?',
      [role, groupId, targetId]
    )
    res.json({ ok: true, role })
  } catch (err) {
    console.error('PUT /api/groups/:id/members/:userId/role error:', err)
    res.status(500).json({ error: 'Failed to update role' })
  }
})

// DELETE /api/groups/:id/members/:userId — remove member (admin/mod only)
router.delete('/groups/:id/members/:userId', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(groupId) || isNaN(targetId)) return res.status(400).json({ error: 'Invalid ID' })

  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const callerRole = await getMemberRole(groupId, req.userId)
    if (callerRole !== 'admin' && callerRole !== 'moderator') {
      return res.status(403).json({ error: 'Admin or moderator required' })
    }

    const targetRole = await getMemberRole(groupId, targetId)
    if (!targetRole) return res.status(404).json({ error: 'Target user is not a member' })

    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Cannot remove yourself — use leave instead' })
    }

    // Prevent removing the last admin
    if (targetRole === 'admin') {
      const [[adminCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ? AND role = 'admin'",
        [groupId]
      )
      if (adminCount.n <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' })
      }
      if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'Only admins can remove another admin' })
      }
    }

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, targetId]
    )
    await pool.query(
      'UPDATE conversations SET member_count = GREATEST(member_count - 1, 0) WHERE id = ?',
      [groupId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:id/members/:userId error:', err)
    res.status(500).json({ error: 'Failed to remove member' })
  }
})

// ── Posts / Feed ──────────────────────────────────────────────────────────────

// POST /api/groups/:id/posts — create post (members only)
router.post('/groups/:id/posts', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id, visibility FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const role = await getMemberRole(groupId, req.userId)
    if (!role) return res.status(403).json({ error: 'Members only' })

    const { content, media } = req.body
    if (!content && !media) return res.status(400).json({ error: 'content or media required' })

    const mediaJson = media ? JSON.stringify(media) : null
    const [result] = await pool.query(
      'INSERT INTO group_posts (group_id, user_id, content, media) VALUES (?, ?, ?, ?)',
      [groupId, req.userId, content || null, mediaJson]
    )
    await pool.query(
      'UPDATE conversations SET post_count = post_count + 1 WHERE id = ?',
      [groupId]
    )
    res.status(201).json({ ok: true, postId: result.insertId })
  } catch (err) {
    console.error('POST /api/groups/:id/posts error:', err)
    res.status(500).json({ error: 'Failed to create post' })
  }
})

// GET /api/groups/:id/posts — group feed (members only for private/hidden)
router.get('/groups/:id/posts', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id, visibility FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const visibility = group.visibility || 'public'
    if (visibility !== 'public') {
      const role = await getMemberRole(groupId, req.userId)
      if (!role) return res.status(403).json({ error: 'Members only' })
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    const [posts] = await pool.query(
      `SELECT gp.id, gp.content, gp.media, gp.is_pinned, gp.created_at,
              u.id AS user_id, u.name AS user_name, u.avatar AS user_avatar,
              cp.role AS author_role,
              (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', r.type, 'count', r.n))
               FROM (SELECT type, COUNT(*) AS n FROM group_post_reactions WHERE post_id = gp.id GROUP BY type) r
              ) AS reactions,
              (SELECT type FROM group_post_reactions WHERE post_id = gp.id AND user_id = ? LIMIT 1) AS my_reaction
       FROM group_posts gp
       JOIN users u ON u.id = gp.user_id
       LEFT JOIN conversation_participants cp ON cp.conversation_id = gp.group_id AND cp.user_id = gp.user_id
       WHERE gp.group_id = ?
       ORDER BY gp.is_pinned DESC, gp.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, groupId, limit, offset]
    )

    res.json({ posts: posts.map(p => ({
      ...p,
      media: (() => { try { return p.media ? JSON.parse(p.media) : null } catch { return null } })(),
    })) })
  } catch (err) {
    console.error('GET /api/groups/:id/posts error:', err)
    res.status(500).json({ error: 'Failed to load posts' })
  }
})

// DELETE /api/groups/:id/posts/:postId — delete own post, or mod/admin can delete any
router.delete('/groups/:id/posts/:postId', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'Invalid ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const [[post]] = await pool.query(
      'SELECT id, user_id FROM group_posts WHERE id = ? AND group_id = ?',
      [postId, groupId]
    )
    if (!post) return res.status(404).json({ error: 'Post not found' })

    const callerRole = await getMemberRole(groupId, req.userId)
    if (!callerRole) return res.status(403).json({ error: 'Members only' })

    const isOwner = post.user_id === req.userId
    const isMod = callerRole === 'admin' || callerRole === 'moderator'
    if (!isOwner && !isMod) return res.status(403).json({ error: 'Cannot delete this post' })

    await pool.query('DELETE FROM group_post_reactions WHERE post_id = ?', [postId])
    await pool.query('DELETE FROM group_posts WHERE id = ?', [postId])
    await pool.query(
      'UPDATE conversations SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?',
      [groupId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:id/posts/:postId error:', err)
    res.status(500).json({ error: 'Failed to delete post' })
  }
})

// POST /api/groups/:id/posts/:postId/pin — pin/unpin post (mod/admin only)
router.post('/groups/:id/posts/:postId/pin', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'Invalid ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const callerRole = await getMemberRole(groupId, req.userId)
    if (callerRole !== 'admin' && callerRole !== 'moderator') {
      return res.status(403).json({ error: 'Admin or moderator required' })
    }

    const [[post]] = await pool.query(
      'SELECT id, is_pinned FROM group_posts WHERE id = ? AND group_id = ?',
      [postId, groupId]
    )
    if (!post) return res.status(404).json({ error: 'Post not found' })

    const newPinned = post.is_pinned ? 0 : 1
    await pool.query('UPDATE group_posts SET is_pinned = ? WHERE id = ?', [newPinned, postId])
    res.json({ ok: true, is_pinned: newPinned === 1 })
  } catch (err) {
    console.error('POST /api/groups/:id/posts/:postId/pin error:', err)
    res.status(500).json({ error: 'Failed to pin post' })
  }
})

// POST /api/groups/:id/posts/:postId/react — react to post
router.post('/groups/:id/posts/:postId/react', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'Invalid ID' })

  const { type } = req.body
  if (!['like', 'love', 'insightful'].includes(type)) {
    return res.status(400).json({ error: 'type must be like, love, or insightful' })
  }

  try {
    const [[group]] = await pool.query(
      'SELECT id, visibility FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const visibility = group.visibility || 'public'
    if (visibility !== 'public') {
      const role = await getMemberRole(groupId, req.userId)
      if (!role) return res.status(403).json({ error: 'Members only' })
    }

    const [[post]] = await pool.query(
      'SELECT id FROM group_posts WHERE id = ? AND group_id = ?',
      [postId, groupId]
    )
    if (!post) return res.status(404).json({ error: 'Post not found' })

    const [[existing]] = await pool.query(
      'SELECT id, type FROM group_post_reactions WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    )

    if (existing) {
      if (existing.type === type) {
        // Toggle off
        await pool.query('DELETE FROM group_post_reactions WHERE post_id = ? AND user_id = ?', [postId, req.userId])
        return res.json({ ok: true, action: 'removed' })
      }
      await pool.query(
        'UPDATE group_post_reactions SET type = ? WHERE post_id = ? AND user_id = ?',
        [type, postId, req.userId]
      )
      return res.json({ ok: true, action: 'updated', type })
    }

    await pool.query(
      'INSERT INTO group_post_reactions (post_id, user_id, type) VALUES (?, ?, ?)',
      [postId, req.userId, type]
    )
    res.json({ ok: true, action: 'added', type })
  } catch (err) {
    console.error('POST /api/groups/:id/posts/:postId/react error:', err)
    res.status(500).json({ error: 'Failed to react to post' })
  }
})

export default router
