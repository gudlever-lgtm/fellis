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

router.get('/jobs', authenticate, async (req, res) => {
  try {
    const { q, type, remote, company_id } = req.query
    let sql = `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color, c.logo_url AS company_logo,
                 (SELECT COUNT(*) > 0 FROM job_saves WHERE job_id = j.id AND user_id = ?) AS saved
               FROM jobs j JOIN companies c ON c.id = j.company_id
               WHERE j.active = 1`
    const params = [req.userId]
    if (q) { sql += ' AND (j.title LIKE ? OR j.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`) }
    if (type) { sql += ' AND j.type = ?'; params.push(type) }
    if (remote === '1') { sql += ' AND j.remote = 1' }
    if (company_id) { sql += ' AND j.company_id = ?'; params.push(company_id) }
    sql += ' ORDER BY j.created_at DESC LIMIT 50'
    const [rows] = await pool.query(sql, params)
    res.json({ jobs: rows })
  } catch (err) {
    console.error('GET /api/jobs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/saved', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              1 AS saved, js.track_status
       FROM jobs j JOIN companies c ON c.id = j.company_id
       JOIN job_saves js ON js.job_id = j.id AND js.user_id = ?
       ORDER BY js.saved_at DESC`,
      [req.userId]
    )
    res.json({ jobs: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/jobs/:id/track', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['not_applied', 'applied', 'interview', 'offer', 'hired', 'rejected', 'not_interested']
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    // Ensure a save row exists
    await pool.query(
      'INSERT INTO job_saves (job_id, user_id, track_status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE track_status = VALUES(track_status)',
      [req.params.id, req.userId, status || null]
    )
    res.json({ ok: true, status: status || null })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/tracked', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color,
              1 AS saved, js.track_status
       FROM jobs j JOIN companies c ON c.id = j.company_id
       JOIN job_saves js ON js.job_id = j.id AND js.user_id = ?
       WHERE js.track_status IS NOT NULL
       ORDER BY js.saved_at DESC`,
      [req.userId]
    )
    res.json({ jobs: rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/jobs', authenticate, async (req, res) => {
  try {
    const { company_id, title, location, remote, type, description, requirements, apply_link, contact_email, deadline } = req.body
    if (!company_id || !title) return res.status(400).json({ error: 'company_id and title required' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [result] = await pool.query(
      `INSERT INTO jobs (company_id, title, location, remote, type, description, requirements, apply_link, contact_email, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_id, title, location || null, remote ? 1 : 0,
        type || 'fulltime', description || null, requirements || null,
        apply_link || null, contact_email || null, deadline || null]
    )
    const [[job]] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.color AS company_color, 0 AS saved
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
      [result.insertId]
    )
    res.json(job)
  } catch (err) {
    console.error('POST /api/jobs error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.put('/jobs/:id', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ?",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const { title, location, remote, type, description, requirements, apply_link, active, contact_email, deadline } = req.body
    await pool.query(
      'UPDATE jobs SET title=?, location=?, remote=?, type=?, description=?, requirements=?, apply_link=?, active=?, contact_email=?, deadline=? WHERE id=?',
      [title, location || null, remote ? 1 : 0, type || 'fulltime',
        description || null, requirements || null, apply_link || null,
        active !== undefined ? (active ? 1 : 0) : 1,
        contact_email || null, deadline || null, req.params.id]
    )
    const [[updated]] = await pool.query(
      `SELECT j.*, c.name AS company_name, c.color AS company_color FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
      [req.params.id]
    )
    res.json(updated)
  } catch (err) {
    console.error('PUT /api/jobs/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/jobs/:id', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE jobs SET active = 0 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/jobs/:id/save', authenticate, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT track_status FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
    if (existing) {
      // Only unsave if no tracking status set (or force=true)
      if (existing.track_status && !req.body.force) {
        // Has tracking status: just clear the saved flag conceptually but keep tracking
        res.json({ saved: false, track_status: existing.track_status })
      } else {
        await pool.query('DELETE FROM job_saves WHERE job_id = ? AND user_id = ?', [req.params.id, req.userId])
        res.json({ saved: false })
      }
    } else {
      await pool.query('INSERT IGNORE INTO job_saves (job_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      res.json({ saved: true })
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/jobs/:id/apply', authenticate, uploadDoc.fields([{ name: 'cv', maxCount: 1 }, { name: 'application_letter', maxCount: 1 }]), async (req, res) => {
  try {
    const { name, email, message } = req.body
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' })
    const [[job]] = await pool.query("SELECT id FROM jobs WHERE id = ? AND status = 'open'", [req.params.id])
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const cvFile = req.files?.cv?.[0]
    const letterFile = req.files?.application_letter?.[0]
    const cvUrl = cvFile ? `/uploads/${cvFile.filename}` : null
    const letterUrl = letterFile ? `/uploads/${letterFile.filename}` : null
    await pool.query(
      'INSERT INTO job_applications (job_id, applicant_id, name, email, message, cv_url, application_letter_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, req.userId, name, email, message || null, cvUrl, letterUrl]
    )
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already applied' })
    console.error('POST /api/jobs/:id/apply error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/:id/applications', authenticate, async (req, res) => {
  try {
    const [[job]] = await pool.query('SELECT id, company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin','editor')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    const [applications] = await pool.query(
      `SELECT ja.*, u.handle AS applicant_handle
       FROM job_applications ja JOIN users u ON u.id = ja.applicant_id
       WHERE ja.job_id = ? ORDER BY ja.created_at DESC`,
      [req.params.id]
    )
    res.json({ applications })
  } catch (err) {
    console.error('GET /api/jobs/:id/applications error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.patch('/jobs/:id/applications/:appId', authenticate, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['pending', 'reviewed', 'shortlisted', 'rejected']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const [[job]] = await pool.query('SELECT id, company_id FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Not found' })
    const [[member]] = await pool.query(
      "SELECT role FROM company_members WHERE company_id = ? AND user_id = ? AND role IN ('owner','admin','editor')",
      [job.company_id, req.userId]
    )
    if (!member) return res.status(403).json({ error: 'Forbidden' })
    await pool.query('UPDATE job_applications SET status = ? WHERE id = ? AND job_id = ?', [status, req.params.appId, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/jobs/:id/applications/:appId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/jobs/:id/share', authenticate, async (req, res) => {
  try {
    const { userId: recipientId } = req.body
    if (!recipientId) return res.status(400).json({ error: 'userId required' })
    if (recipientId === req.userId) return res.status(400).json({ error: 'Cannot share with yourself' })

    // Verify job exists
    const [[job]] = await pool.query('SELECT title FROM jobs WHERE id = ?', [req.params.id])
    if (!job) return res.status(404).json({ error: 'Job not found' })

    // Verify recipient exists
    const [[recipient]] = await pool.query('SELECT id FROM users WHERE id = ?', [recipientId])
    if (!recipient) return res.status(404).json({ error: 'User not found' })

    // Get current user name for notification
    const [[currentUser]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId])
    const senderName = currentUser?.name || 'Someone'

    // Create or update share record
    try {
      await pool.query(
        `INSERT INTO shared_jobs (job_id, shared_by_user_id, shared_with_user_id)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE shared_at = NOW()`,
        [req.params.id, req.userId, recipientId]
      )
    } catch (e) {
      // Table may not exist yet, skip
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }

    // Send notification to recipient
    const jobTitle = typeof job.title === 'object' ? (job.title.da || job.title.en || job.title) : job.title
    await createNotification(
      recipientId,
      'job_shared',
      `${senderName} har delt jobbet "${jobTitle}" med dig`,
      `${senderName} shared the job "${jobTitle}" with you`,
      req.userId,
      senderName,
      null
    )

    res.json({ ok: true, jobId: req.params.id, sharedWith: recipientId })
  } catch (err) {
    console.error('POST /api/jobs/:id/share error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/jobs/:id/share/:userId', authenticate, async (req, res) => {
  try {
    try {
      await pool.query(
        'DELETE FROM shared_jobs WHERE job_id = ? AND shared_by_user_id = ? AND shared_with_user_id = ?',
        [req.params.id, req.userId, req.params.userId]
      )
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/jobs/:id/share/:userId error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/:id/shared-with', authenticate, async (req, res) => {
  try {
    let sharedWith = []
    try {
      const [rows] = await pool.query(`
        SELECT u.id, u.name, u.handle
        FROM shared_jobs sj
        JOIN users u ON sj.shared_with_user_id = u.id
        WHERE sj.job_id = ? AND sj.shared_by_user_id = ?
        ORDER BY sj.shared_at DESC
      `, [req.params.id, req.userId])
      sharedWith = rows || []
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ sharedWith })
  } catch (err) {
    console.error('GET /api/jobs/:id/shared-with error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/shared', authenticate, async (req, res) => {
  try {
    let sharedJobs = []
    try {
      const [rows] = await pool.query(`
        SELECT DISTINCT j.*, u.name as shared_by_name
        FROM jobs j
        JOIN shared_jobs sj ON j.id = sj.job_id
        JOIN users u ON sj.shared_by_user_id = u.id
        WHERE sj.shared_with_user_id = ?
        ORDER BY sj.shared_at DESC
      `, [req.userId])
      sharedJobs = rows || []
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    res.json({ jobs: sharedJobs })
  } catch (err) {
    console.error('GET /api/jobs/shared error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/jobs/mine', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT j.*, c.name AS company_name, c.handle AS company_handle, c.color AS company_color, c.logo_url AS company_logo,
             (SELECT COUNT(DISTINCT sj.shared_with_user_id) FROM shared_jobs sj JOIN users u ON sj.shared_with_user_id = u.id WHERE sj.job_id = j.id) AS share_count
      FROM jobs j
      JOIN companies c ON c.id = j.company_id
      JOIN company_members cm ON cm.company_id = j.company_id AND cm.user_id = ? AND cm.role IN ('owner','admin','editor')
      ORDER BY j.created_at DESC
    `, [req.userId])
    res.json({ jobs: rows || [] })
  } catch (err) {
    console.error('GET /api/jobs/mine error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


export default router
