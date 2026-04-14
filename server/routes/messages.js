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
  parseBrowser, getGeoForIp, parseBrowser,
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

router.get('/conversations/:id/messages', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const [msgs] = await pool.query(
      `SELECT u.name as from_name, m.text_da, m.text_en, m.time, m.created_at, m.media
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 50`,
      [convId])
    msgs.reverse()
    res.json({ messages: msgs.map(m => ({
      from: m.from_name,
      text: { da: m.text_da, en: m.text_en },
      time: m.created_at ? formatMsgTime(m.created_at) : m.time,
      media: (() => { try { return m.media ? JSON.parse(m.media) : null } catch { return null } })(),
    })) })
  } catch (err) {
    console.error('GET /api/conversations/:id/messages error:', err)
    res.status(500).json({ error: 'Failed to load messages' })
  }
})


router.get('/conversations/:id/messages/older', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  const limit = Math.min(parseInt(req.query.limit) || 20, 50)
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const [msgs] = await pool.query(
      `SELECT u.name as from_name, m.text_da, m.text_en, m.time, m.created_at
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [convId, limit, offset])
    msgs.reverse()
    res.json({ messages: msgs.map(m => ({ from: m.from_name, text: { da: m.text_da, en: m.text_en }, time: m.created_at ? formatMsgTime(m.created_at) : m.time })) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' })
  }
})


router.get('/sse', authenticate, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  })
  res.flushHeaders()
  res.write(': connected\n\n')
  sseAdd(req.userId, res)
  // Heartbeat every 25 s to keep the connection alive
  const hb = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(hb) }
  }, 25_000)
  req.on('close', () => {
    clearInterval(hb)
    sseRemove(req.userId, res)
  })
})


router.post('/conversations/:id/messages', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { text, media } = req.body
  if (!text && !media?.length) return res.status(400).json({ error: 'Message text or media required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    // Check if sender is admin-muted (column may not exist on older installs)
    const [muteCheck] = await pool.query(
      'SELECT admin_muted_until FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId]
    ).catch(() => [[{}]])
    if (muteCheck[0]?.admin_muted_until && new Date(muteCheck[0].admin_muted_until) > new Date())
      return res.status(403).json({ error: 'You are muted in this conversation', mutedUntil: muteCheck[0].admin_muted_until })
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const [participants] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [convId])
    const receiverId = participants.find(p => p.user_id !== req.userId)?.user_id ?? req.userId
    const mediaJson = media?.length ? JSON.stringify(media) : null
    const [ins] = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, receiver_id, text_da, text_en, time, media) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [convId, req.userId, receiverId, text || '', text || '', time, mediaJson])
    const [[user]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const msg = { id: ins.insertId, from: user.name, text: { da: text || '', en: text || '' }, media: media || null, time: formatMsgTime(now), createdAtRaw: now.toISOString() }
    // Push the new message to all other participants via SSE + create notification
    const [[conv]] = await pool.query('SELECT name, is_group FROM conversations WHERE id = ?', [convId]).catch(() => [[null]])
    for (const { user_id } of participants) {
      if (user_id !== req.userId) {
        sseBroadcast(user_id, { type: 'message', convId, msg })
        const msgDa = conv?.is_group && conv?.name
          ? `${user.name} sendte en besked i ${conv.name}`
          : `${user.name} sendte dig en besked`
        const msgEn = conv?.is_group && conv?.name
          ? `${user.name} sent a message in ${conv.name}`
          : `${user.name} sent you a message`
        createNotification(user_id, 'new_message', msgDa, msgEn, req.userId, user.name, convId)
      }
    }
    res.json(msg)
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' })
  }
})


router.post('/conversations/:id/read', authenticate, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    await pool.query(
      'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?',
      [convId, req.userId])
    await pool.query(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [convId, req.userId]
    ).catch(() => {}) // column may not exist on older installs — safe to ignore
    // Push read receipt to other participants via SSE so they see ✓✓ instantly
    const [participants] = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [convId])
    const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    for (const { user_id } of participants) {
      if (user_id !== req.userId) {
        sseBroadcast(user_id, {
          type: 'read_receipt',
          convId,
          userId: req.userId,
          name: me.name,
          lastReadAt: new Date().toISOString(),
        })
      }
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' })
  }
})


router.post('/conversations/:id/invite', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { userIds } = req.body
  if (!userIds || !Array.isArray(userIds) || !userIds.length)
    return res.status(400).json({ error: 'userIds required' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    for (const uid of userIds)
      await pool.query('INSERT IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid])
    // Promote to group if adding to a 1:1
    await pool.query('UPDATE conversations SET is_group = 1 WHERE id = ? AND is_group = 0', [convId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to invite participants' })
  }
})


router.post('/conversations/:id/mute', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { minutes } = req.body
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    const clampedMinutes = Math.min(Math.max(0, parseInt(minutes) || 0), 10080) // max 7 days
    const mutedUntil = clampedMinutes > 0 ? new Date(Date.now() + clampedMinutes * 60 * 1000) : null
    await pool.query(
      'UPDATE conversation_participants SET muted_until = ? WHERE conversation_id = ? AND user_id = ?',
      [mutedUntil, convId, req.userId])
    res.json({ ok: true, mutedUntil })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mute conversation' })
  }
})


router.delete('/conversations/:id/leave', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  try {
    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave conversation' })
  }
})


router.patch('/conversations/:id', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  if (typeof name !== 'string' || name.trim().length > 100)
    return res.status(400).json({ error: 'name must be 100 characters or fewer' })
  try {
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, req.userId])
    if (!check.length) return res.status(403).json({ error: 'Not a participant' })
    await pool.query('UPDATE conversations SET name = ? WHERE id = ?', [name.trim(), convId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename conversation' })
  }
})


router.delete('/conversations/:id/participants/:userId', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId) || targetId === req.userId)
    return res.status(400).json({ error: 'Invalid target user' })
  try {
    const [[conv]] = await pool.query('SELECT created_by FROM conversations WHERE id = ?', [convId])
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    if (conv.created_by != null && conv.created_by !== req.userId) return res.status(403).json({ error: 'Only the conversation creator can remove members' })
    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, targetId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove participant' })
  }
})


router.post('/conversations/:id/participants/:userId/mute', authenticate, writeLimit, async (req, res) => {
  const convId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId) || targetId === req.userId)
    return res.status(400).json({ error: 'Invalid target user' })
  const { minutes } = req.body
  try {
    const [[conv]] = await pool.query('SELECT created_by FROM conversations WHERE id = ?', [convId])
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    if (conv.created_by != null && conv.created_by !== req.userId) return res.status(403).json({ error: 'Only the conversation creator can mute members' })
    const [check] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [convId, targetId])
    if (!check.length) return res.status(404).json({ error: 'User is not a participant' })
    const clampedAdminMinutes = Math.min(Math.max(0, parseInt(minutes) || 0), 10080) // max 7 days
    const adminMutedUntil = clampedAdminMinutes > 0 ? new Date(Date.now() + clampedAdminMinutes * 60 * 1000) : null
    await pool.query(
      'UPDATE conversation_participants SET admin_muted_until = ? WHERE conversation_id = ? AND user_id = ?',
      [adminMutedUntil, convId, targetId])
    res.json({ ok: true, adminMutedUntil })
  } catch (err) {
    res.status(500).json({ error: 'Failed to mute participant' })
  }
})


router.post('/messages/:id/react', authenticate, writeLimit, async (req, res) => {
  try {
    const { emoji } = req.body
    if (!emoji) return res.status(400).json({ error: 'Emoji required' })
    // Verify user is participant in the conversation
    const [[msg]] = await pool.query('SELECT conversation_id FROM messages WHERE id=?', [req.params.id])
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    const [[member]] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id=? AND user_id=?',
      [msg.conversation_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query(
      'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?) ON DUPLICATE KEY UPDATE emoji=VALUES(emoji)',
      [req.params.id, req.userId, emoji]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/messages/:id/react', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM message_reactions WHERE message_id=? AND user_id=?', [req.params.id, req.userId])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
