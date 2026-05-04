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

const router = express.Router()

router.get('/notifications', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, type, message_da, message_en, actor_id, actor_name, post_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    )
    res.json({ notifications: rows })
  } catch (err) {
    console.error('[GET /api/notifications]', err.message)
    res.json({ notifications: [] })
  }
})


router.post('/notifications/test', authenticate, async (req, res) => {
  const steps = []
  try {
    // 1. Check table exists
    const [[tbl]] = await pool.query("SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notifications'")
    steps.push({ step: 'table_exists', ok: tbl.c > 0 })
    if (!tbl.c) {
      return res.json({ ok: false, steps, error: 'notifications table does not exist — run migrate-notifications.sql' })
    }
    // 2. Insert test notification
    const [ins] = await pool.query(
      'INSERT INTO notifications (user_id, type, message_da, message_en, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, 'test', '🔔 Test notifikation — virker!', '🔔 Test notification — works!', req.userId, 'Test']
    )
    steps.push({ step: 'insert', ok: true, insertId: ins.insertId })
    // 3. Read it back
    const [[row]] = await pool.query('SELECT id, type, message_da FROM notifications WHERE id = ?', [ins.insertId])
    steps.push({ step: 'readback', ok: !!row, row })
    // 4. Broadcast SSE
    sseBroadcast(req.userId, { type: 'notification' })
    steps.push({ step: 'sse_broadcast', ok: true, sseClients: sseClients.get(req.userId)?.size ?? 0 })
    res.json({ ok: true, steps })
  } catch (err) {
    steps.push({ step: 'error', message: err.message })
    res.json({ ok: false, steps, error: err.message })
  }
})


router.get('/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.userId]
    )
    res.json({ count: Number(row.count) })
  } catch {
    res.json({ count: 0 })
  }
})


router.get('/notifications/count', authenticate, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.userId]
    )
    res.json({ count: Number(row.count) })
  } catch {
    res.json({ count: 0 })
  }
})


router.post('/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.userId]).catch(() => {})
  res.json({ ok: true })
})


router.post('/notifications/read-all', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.userId]).catch(() => {})
  res.json({ ok: true })
})


export default router
