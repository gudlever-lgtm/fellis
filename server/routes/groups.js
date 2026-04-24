import express from 'express'
import pool from '../db.js'
import {
  authenticate, writeLimit,
  requireAdmin,
  createNotification,
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

export default router
