import express from 'express'
import pool from '../db.js'
import crypto from 'crypto'
import {
  authenticate, writeLimit,
  requireAdmin,
  createNotification,
  getSessionIdFromRequest,
} from '../middleware.js'

const router = express.Router()

// Returns the group_members row for a given (group, user) pair, or null.
async function getMembership(groupId, userId) {
  const [[row]] = await pool.query(
    'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  )
  return row || null
}

// ── Platform admin ────────────────────────────────────────────────────────────

router.get('/groups/admin/pending', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.*, u.name AS creator_name
       FROM \`groups\` g JOIN users u ON g.created_by = u.id
       WHERE g.status = 'pending'
       ORDER BY g.created_at ASC`
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error('GET /api/groups/admin/pending error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups/admin/approve/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id, created_by, name FROM `groups` WHERE id = ? AND status = 'pending'",
      [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Pending group not found' })
    await pool.query("UPDATE `groups` SET status = 'active' WHERE id = ?", [req.params.id])
    createNotification(
      group.created_by, 'group_approved',
      `Din gruppe "${group.name}" er godkendt og aktiv`,
      `Your group "${group.name}" has been approved and is now active`,
      req.userId
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/admin/approve/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups/admin/reject/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body
    const [[group]] = await pool.query(
      "SELECT id, created_by, name FROM `groups` WHERE id = ? AND status = 'pending'",
      [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Pending group not found' })
    await pool.query("UPDATE `groups` SET status = 'rejected' WHERE id = ?", [req.params.id])
    createNotification(
      group.created_by, 'group_rejected',
      `Din gruppe "${group.name}" blev ikke godkendt${reason ? `: ${reason}` : ''}`,
      `Your group "${group.name}" was not approved${reason ? `: ${reason}` : ''}`,
      req.userId
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/admin/reject/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/groups/admin/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id FROM `groups` WHERE id = ?", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    await pool.query("UPDATE `groups` SET status = 'suspended' WHERE id = ?", [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/admin/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Static paths — must precede /:slug ───────────────────────────────────────

router.get('/groups/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.*, gm.role AS my_role, gm.joined_at
       FROM \`groups\` g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ? AND g.status = 'active'
       ORDER BY gm.joined_at DESC`,
      [req.userId]
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error('GET /api/groups/me error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// Kept for api.js compat (apiGetGroupSuggestions); updated to use groups table.
router.get('/groups/suggestions', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.name, g.slug, g.description, g.category,
              g.cover_image, g.member_count, g.post_count
       FROM \`groups\` g
       WHERE g.status = 'active' AND g.type = 'public'
         AND g.id NOT IN (
           SELECT group_id FROM group_members WHERE user_id = ?
         )
       ORDER BY g.member_count DESC, g.post_count DESC
       LIMIT 5`,
      [req.userId]
    )
    res.json({ suggestions: rows })
  } catch (err) {
    console.error('GET /api/groups/suggestions error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Group CRUD ────────────────────────────────────────────────────────────────

router.get('/groups', authenticate, async (req, res) => {
  try {
    const { category, search, sort } = req.query
    const whereParts = ["g.status = 'active'", "g.type IN ('public', 'private')"]
    const params = [req.userId]

    if (category) {
      whereParts.push('g.category = ?')
      params.push(category)
    }
    if (search) {
      whereParts.push('(g.name LIKE ? OR g.description LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (sort === 'trending') {
      whereParts.push(`(
        g.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        OR g.id IN (
          SELECT DISTINCT group_id FROM group_posts
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        )
      )`)
    }

    let orderBy = 'g.created_at DESC'
    if (sort === 'trending') orderBy = 'g.post_count DESC, g.member_count DESC'
    else if (sort === 'members') orderBy = 'g.member_count DESC'

    const [rows] = await pool.query(
      `SELECT g.*, u.name AS creator_name,
              (SELECT gm2.role FROM group_members gm2
               WHERE gm2.group_id = g.id AND gm2.user_id = ?) AS my_role
       FROM \`groups\` g JOIN users u ON g.created_by = u.id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 50`,
      params
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error('GET /api/groups error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups', authenticate, writeLimit, async (req, res) => {
  try {
    const { name, slug, description, type, category, tags, coverImage } = req.body
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' })
    const safeType = ['public', 'private', 'hidden'].includes(type) ? type : 'public'
    const [result] = await pool.query(
      `INSERT INTO \`groups\`
         (name, slug, description, type, category, tags, cover_image,
          created_by, status, member_count, post_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0)`,
      [name, slug, description || null, safeType, category || null,
       tags ? JSON.stringify(tags) : null, coverImage || null, req.userId]
    )
    const groupId = result.insertId
    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
      [groupId, req.userId]
    )
    await pool.query(
      "UPDATE `groups` SET member_count = member_count + 1 WHERE id = ?", [groupId]
    )
    const [[group]] = await pool.query("SELECT * FROM `groups` WHERE id = ?", [groupId])
    res.status(201).json({ group })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Slug already taken' })
    console.error('POST /api/groups error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/groups/:slug', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      `SELECT g.*, u.name AS creator_name
       FROM \`groups\` g JOIN users u ON g.created_by = u.id
       WHERE g.slug = ? AND g.status = 'active'`,
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const membership = await getMembership(group.id, req.userId)
    if (group.type === 'hidden' && !membership) {
      return res.status(403).json({ error: 'Access denied' })
    }
    res.json({ group: { ...group, myRole: membership?.role || null } })
  } catch (err) {
    console.error('GET /api/groups/:slug error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/groups/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id FROM `groups` WHERE id = ?", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Group admin only' })
    }
    const { name, description, type, category, tags, coverImage } = req.body
    const safeType = ['public', 'private', 'hidden'].includes(type) ? type : null
    await pool.query(
      `UPDATE \`groups\` SET
         name        = COALESCE(?, name),
         description = COALESCE(?, description),
         type        = COALESCE(?, type),
         category    = COALESCE(?, category),
         tags        = COALESCE(?, tags),
         cover_image = COALESCE(?, cover_image)
       WHERE id = ?`,
      [name || null, description || null, safeType,
       category || null, tags ? JSON.stringify(tags) : null,
       coverImage || null, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/groups/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/groups/:id', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id FROM `groups` WHERE id = ?", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const membership = await getMembership(req.params.id, req.userId)
    const isPlatformAdmin = req.adminRole &&
      ['super_admin', 'admin'].includes(req.adminRole)
    if (!isPlatformAdmin && (!membership || membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await pool.query("DELETE FROM `groups` WHERE id = ?", [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:id error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Kept for api.js compat (apiJoinGroup) — updated to use groups table ──────

router.post('/groups/:id/join', authenticate, writeLimit, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id, type, status FROM `groups` WHERE id = ?", [req.params.id]
    )
    if (!group || group.status !== 'active') {
      return res.status(404).json({ error: 'Group not found' })
    }
    const existing = await getMembership(req.params.id, req.userId)
    if (existing) return res.status(409).json({ error: 'Already a member' })
    if (group.type === 'hidden') {
      return res.status(403).json({ error: 'Hidden groups require an invite' })
    }
    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
      [req.params.id, req.userId]
    )
    await pool.query(
      "UPDATE `groups` SET member_count = member_count + 1 WHERE id = ?", [req.params.id]
    )
    res.json({ ok: true, status: 'joined' })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already a member' })
    console.error('POST /api/groups/:id/join error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Polls ─────────────────────────────────────────────────────────────────────

router.post('/groups/:id/polls', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership) return res.status(403).json({ error: 'Members only' })
    const { question, options, closes_at } = req.body
    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Question and at least 2 options required' })
    }
    const [result] = await pool.query(
      `INSERT INTO group_polls (group_id, created_by, question, options, closes_at)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.userId, question, JSON.stringify(options), closes_at || null]
    )
    const [[poll]] = await pool.query('SELECT * FROM group_polls WHERE id = ?', [result.insertId])
    res.status(201).json({ poll })
  } catch (err) {
    console.error('POST /api/groups/:id/polls error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/groups/:id/polls', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id, type FROM `groups` WHERE id = ? AND status = 'active'", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const membership = await getMembership(req.params.id, req.userId)
    if (group.type !== 'public' && !membership) {
      return res.status(403).json({ error: 'Members only' })
    }
    const [polls] = await pool.query(
      `SELECT p.*, u.name AS creator_name,
              (SELECT option_id FROM group_poll_votes
               WHERE poll_id = p.id AND user_id = ?) AS my_vote,
              (SELECT JSON_OBJECTAGG(option_id, cnt)
               FROM (SELECT option_id, COUNT(*) AS cnt FROM group_poll_votes
                     WHERE poll_id = p.id GROUP BY option_id) v) AS vote_counts
       FROM group_polls p JOIN users u ON u.id = p.created_by
       WHERE p.group_id = ?
       ORDER BY p.created_at DESC`,
      [req.userId, req.params.id]
    )
    res.json({ polls })
  } catch (err) {
    console.error('GET /api/groups/:id/polls error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups/:id/polls/:pollId/vote', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership) return res.status(403).json({ error: 'Members only' })
    const { option_id } = req.body
    if (option_id == null) return res.status(400).json({ error: 'option_id required' })
    const [[poll]] = await pool.query(
      'SELECT id, options, closes_at FROM group_polls WHERE id = ? AND group_id = ?',
      [req.params.pollId, req.params.id]
    )
    if (!poll) return res.status(404).json({ error: 'Poll not found' })
    if (poll.closes_at && new Date(poll.closes_at) < new Date()) {
      return res.status(400).json({ error: 'Poll is closed' })
    }
    const opts = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options
    if (!opts.some(o => String(o.id) === String(option_id))) {
      return res.status(400).json({ error: 'Invalid option' })
    }
    await pool.query(
      `INSERT INTO group_poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE option_id = VALUES(option_id), voted_at = NOW()`,
      [req.params.pollId, req.userId, option_id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/polls/:pollId/vote error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Events ────────────────────────────────────────────────────────────────────

router.post('/groups/:id/events', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership || !['admin', 'moderator'].includes(membership.role)) {
      return res.status(403).json({ error: 'Mod or admin only' })
    }
    const { title, description, location, starts_at, ends_at, max_attendees } = req.body
    if (!title || !starts_at) return res.status(400).json({ error: 'Title and starts_at required' })
    const [result] = await pool.query(
      `INSERT INTO group_events
         (group_id, created_by, title, description, location, starts_at, ends_at, max_attendees)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.userId, title, description || null,
       location || null, starts_at, ends_at || null, max_attendees || null]
    )
    const [[event]] = await pool.query('SELECT * FROM group_events WHERE id = ?', [result.insertId])
    res.status(201).json({ event })
  } catch (err) {
    console.error('POST /api/groups/:id/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/groups/:id/events', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      "SELECT id, type FROM `groups` WHERE id = ? AND status = 'active'", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const membership = await getMembership(req.params.id, req.userId)
    if (group.type !== 'public' && !membership) {
      return res.status(403).json({ error: 'Members only' })
    }
    const [events] = await pool.query(
      `SELECT ge.*, u.name AS creator_name,
              (SELECT COUNT(*) FROM group_event_rsvp
               WHERE event_id = ge.id AND status = 'going') AS going_count,
              (SELECT status FROM group_event_rsvp
               WHERE event_id = ge.id AND user_id = ?) AS my_rsvp
       FROM group_events ge JOIN users u ON u.id = ge.created_by
       WHERE ge.group_id = ?
       ORDER BY ge.starts_at ASC`,
      [req.userId, req.params.id]
    )
    res.json({ events })
  } catch (err) {
    console.error('GET /api/groups/:id/events error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups/:id/events/:eventId/rsvp', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership) return res.status(403).json({ error: 'Members only' })
    const { status } = req.body
    if (!['going', 'maybe', 'notgoing'].includes(status)) {
      return res.status(400).json({ error: 'status must be going, maybe, or notgoing' })
    }
    const [[event]] = await pool.query(
      'SELECT id, max_attendees FROM group_events WHERE id = ? AND group_id = ?',
      [req.params.eventId, req.params.id]
    )
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (status === 'going' && event.max_attendees) {
      const [[{ goingCount }]] = await pool.query(
        "SELECT COUNT(*) AS goingCount FROM group_event_rsvp WHERE event_id = ? AND status = 'going'",
        [req.params.eventId]
      )
      if (goingCount >= event.max_attendees) {
        return res.status(400).json({ error: 'Event is full' })
      }
    }
    await pool.query(
      `INSERT INTO group_event_rsvp (event_id, user_id, status) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [req.params.eventId, req.userId, status]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/events/:eventId/rsvp error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Invitations ───────────────────────────────────────────────────────────────

router.post('/groups/:id/invite', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership) return res.status(403).json({ error: 'Members only' })
    const [[group]] = await pool.query(
      "SELECT id FROM `groups` WHERE id = ? AND status = 'active'", [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const { userId: invitedUserId } = req.body
    if (invitedUserId) {
      const [[target]] = await pool.query('SELECT id FROM users WHERE id = ?', [invitedUserId])
      if (!target) return res.status(404).json({ error: 'User not found' })
      const existing = await getMembership(req.params.id, invitedUserId)
      if (existing) return res.status(409).json({ error: 'User is already a member' })
      const [result] = await pool.query(
        "INSERT INTO group_invitations (group_id, invited_by, invited_user_id, status) VALUES (?, ?, ?, 'pending')",
        [req.params.id, req.userId, invitedUserId]
      )
      createNotification(
        invitedUserId, 'group_invite',
        'Du er blevet inviteret til at deltage i en gruppe',
        'You have been invited to join a group',
        req.userId
      )
      res.json({ ok: true, invitationId: result.insertId })
    } else {
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await pool.query(
        "INSERT INTO group_invitations (group_id, invited_by, token, status, expires_at) VALUES (?, ?, ?, 'pending', ?)",
        [req.params.id, req.userId, token, expiresAt]
      )
      res.json({ ok: true, token, expiresAt })
    }
  } catch (err) {
    console.error('POST /api/groups/:id/invite error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// No auth required to resolve — UI can show group preview before login prompt.
router.get('/groups/join/:token', async (req, res) => {
  try {
    const [[inv]] = await pool.query(
      `SELECT gi.*, g.name, g.slug, g.description, g.type, g.cover_image, g.member_count
       FROM group_invitations gi
       JOIN \`groups\` g ON g.id = gi.group_id
       WHERE gi.token = ? AND gi.status = 'pending'`,
      [req.params.token]
    )
    if (!inv) return res.status(404).json({ error: 'Invalid or expired invite link' })
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      await pool.query("UPDATE group_invitations SET status = 'expired' WHERE token = ?", [req.params.token])
      return res.status(410).json({ error: 'Invite link has expired' })
    }

    // Optionally resolve session without blocking unauthenticated callers.
    const sessionId = getSessionIdFromRequest(req)
    let userId = null
    if (sessionId) {
      const [[sess]] = await pool.query(
        'SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId]
      ).catch(() => [[null]])
      userId = sess?.user_id || null
    }

    let alreadyMember = false
    if (userId) {
      alreadyMember = !!(await getMembership(inv.group_id, userId))
    }

    res.json({
      group: {
        id: inv.group_id,
        name: inv.name,
        slug: inv.slug,
        description: inv.description,
        type: inv.type,
        coverImage: inv.cover_image,
        memberCount: inv.member_count,
      },
      token: req.params.token,
      alreadyMember,
      requiresAuth: !userId,
    })
  } catch (err) {
    console.error('GET /api/groups/join/:token error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ── Moderation ────────────────────────────────────────────────────────────────

router.get('/groups/:id/modlog', authenticate, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership || !['admin', 'moderator'].includes(membership.role)) {
      return res.status(403).json({ error: 'Mod or admin only' })
    }
    const [rows] = await pool.query(
      `SELECT ml.*, a.name AS actor_name, tu.name AS target_user_name
       FROM group_moderation_log ml
       JOIN users a ON a.id = ml.actor_id
       LEFT JOIN users tu ON tu.id = ml.target_user_id
       WHERE ml.group_id = ?
       ORDER BY ml.created_at DESC
       LIMIT 100`,
      [req.params.id]
    )
    res.json({ log: rows })
  } catch (err) {
    console.error('GET /api/groups/:id/modlog error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/groups/:id/moderate', authenticate, writeLimit, async (req, res) => {
  try {
    const membership = await getMembership(req.params.id, req.userId)
    if (!membership || !['admin', 'moderator'].includes(membership.role)) {
      return res.status(403).json({ error: 'Mod or admin only' })
    }
    const { action, target_user_id, target_post_id, reason } = req.body
    const VALID_ACTIONS = [
      'remove_post', 'warn_user', 'ban_user', 'unban_user',
      'approve_member', 'reject_member', 'promote', 'demote',
    ]
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Invalid action' })
    }
    await pool.query(
      `INSERT INTO group_moderation_log
         (group_id, actor_id, target_user_id, target_post_id, action, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.userId,
       target_user_id || null, target_post_id || null, action, reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/moderate error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
