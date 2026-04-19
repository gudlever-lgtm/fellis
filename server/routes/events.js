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

router.get('/events', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, u.name AS organizer_name,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'maybe') AS maybe_count,
        (SELECT GROUP_CONCAT(u2.name ORDER BY r2.created_at SEPARATOR ',')
          FROM event_rsvps r2 JOIN users u2 ON r2.user_id = u2.id
          WHERE r2.event_id = e.id AND r2.status = 'going') AS going_names,
        (SELECT GROUP_CONCAT(u3.name ORDER BY r3.created_at SEPARATOR ',')
          FROM event_rsvps r3 JOIN users u3 ON r3.user_id = u3.id
          WHERE r3.event_id = e.id AND r3.status = 'maybe') AS maybe_names,
        (SELECT r4.status FROM event_rsvps r4 WHERE r4.event_id = e.id AND r4.user_id = ?) AS my_rsvp
       FROM events e JOIN users u ON e.organizer_id = u.id
       ORDER BY e.date ASC`,
      [req.userId]
    )
    const events = rows.map(e => ({
      id: e.id,
      title: e.title,
      description: e.description,
      date: e.date,
      location: e.location,
      organizer: e.organizer_name,
      organizerId: e.organizer_id,
      eventType: e.event_type,
      ticketUrl: e.ticket_url,
      cap: e.cap,
      recipients: e.recipients || 'all',
      going: e.going_names ? e.going_names.split(',') : [],
      maybe: e.maybe_names ? e.maybe_names.split(',') : [],
      myRsvp: e.my_rsvp || null,
      createdAt: e.created_at,
    }))
    res.json({ events })
  } catch (err) {
    console.error('GET /api/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/events', authenticate, async (req, res) => {
  try {
    const { title, description, date, location, eventType, ticketUrl, cap, coverUrl, recipients } = req.body
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' })
    const validRecipients = ['all', 'family', 'close_friends']
    const safeRecipients = validRecipients.includes(recipients) ? recipients : 'all'
    const [result] = await pool.query(
      `INSERT INTO events (organizer_id, title, description, date, location, event_type, ticket_url, cap, cover_url, recipients) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, title, description || null, date, location || null, eventType || null, ticketUrl || null, cap || null, coverUrl || null, safeRecipients]
    )
    const [[event]] = await pool.query(
      `SELECT e.*, u.name AS organizer_name FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.id = ?`,
      [result.insertId]
    )
    res.json({
      id: event.id, title: event.title, description: event.description,
      date: event.date, location: event.location, organizer: event.organizer_name,
      organizerId: event.organizer_id, eventType: event.event_type,
      ticketUrl: event.ticket_url, cap: event.cap, coverUrl: event.cover_url,
      recipients: event.recipients || 'all',
      going: [], maybe: [], myRsvp: null,
    })
  } catch (err) {
    console.error('POST /api/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/events/:id/rsvp', authenticate, async (req, res) => {
  try {
    const { status, dietary, plusOne } = req.body
    const [[event]] = await pool.query('SELECT id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (status === null || status === undefined) {
      await pool.query('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?', [req.params.id, req.userId])
    } else {
      await pool.query(
        `INSERT INTO event_rsvps (event_id, user_id, status, dietary, plus_one) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), dietary = VALUES(dietary), plus_one = VALUES(plus_one)`,
        [req.params.id, req.userId, status, dietary || null, plusOne ? 1 : 0]
      )
      if (status === 'going' || status === 'maybe') {
        const [[ev]] = await pool.query('SELECT organizer_id, title FROM events WHERE id = ?', [req.params.id]).catch(() => [[null]])
        if (ev && ev.organizer_id !== req.userId) {
          const [[rsvper]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]).catch(() => [[null]])
          if (rsvper) {
            const statusDa = status === 'going' ? 'deltager' : 'måske deltager'
            const statusEn = status === 'going' ? 'is going' : 'might attend'
            createNotification(ev.organizer_id, 'event_rsvp',
              `${rsvper.name} ${statusDa} til "${ev.title}"`,
              `${rsvper.name} ${statusEn} "${ev.title}"`,
              req.userId, rsvper.name
            )
          }
        }
      }
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/events/:id/rsvp error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/events/:id', authenticate, async (req, res) => {
  try {
    const [[event]] = await pool.query('SELECT organizer_id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (event.organizer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    const { title, description, date, location, eventType, ticketUrl, cap, recipients } = req.body
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' })
    const validRecipients = ['all', 'family', 'close_friends']
    const safeRecipients = validRecipients.includes(recipients) ? recipients : 'all'
    await pool.query(
      `UPDATE events SET title=?, description=?, date=?, location=?, event_type=?, ticket_url=?, cap=?, recipients=? WHERE id=?`,
      [title, description || null, date, location || null, eventType || null, ticketUrl || null, cap || null, safeRecipients, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/events/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/events/:id', authenticate, async (req, res) => {
  try {
    const [[event]] = await pool.query('SELECT organizer_id FROM events WHERE id = ?', [req.params.id])
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (event.organizer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/events/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/events/:id/ics', authenticate, async (req, res) => {
  try {
    const [[event]] = await pool.query(
      `SELECT e.*, u.name AS organizer_name
       FROM events e JOIN users u ON u.id=e.organizer_id
       WHERE e.id=?`,
      [req.params.id]
    )
    if (!event) return res.status(404).json({ error: 'Event not found' })

    const dtStart = new Date(event.date)
    const dtEnd = new Date(dtStart.getTime() + 2 * 3600_000) // default 2hr duration

    function fmtDt(d) {
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    }

    const uid = `fellis-event-${event.id}@fellis.eu`
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//fellis.eu//Fellis//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${fmtDt(dtStart)}`,
      `DTEND:${fmtDt(dtEnd)}`,
      `SUMMARY:${event.title.replace(/\n/g, ' ')}`,
      event.description ? `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}` : '',
      event.location ? `LOCATION:${event.location}` : '',
      `ORGANIZER;CN="${event.organizer_name}":mailto:noreply@fellis.eu`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n')

    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="event-${event.id}.ics"`)
    res.send(ics)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
