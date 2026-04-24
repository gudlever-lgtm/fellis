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

router.post('/groups', authenticate, writeLimit, async (req, res) => {
  const { name, slug, description, type, category, tags } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' })
  if (!slug || !String(slug).trim()) return res.status(400).json({ error: 'Slug required' })

  const validTypes = ['public', 'private', 'hidden']
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' })

  const validCategories = ['interest', 'local', 'professional', 'event', 'other']
  if (category && !validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' })

  const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' })

  const cleanTags = Array.isArray(tags)
    ? tags.slice(0, 20).map(t => String(t).trim()).filter(Boolean)
    : []

  const isPublic = type === 'public' ? 1 : 0

  try {
    const [[existing]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ?',
      [cleanSlug]
    )
    if (existing) return res.status(409).json({ error: 'slug_taken' })

    const [result] = await pool.query(
      `INSERT INTO conversations
         (name, slug, description_da, type, category, tags, is_group, is_public, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NOW())`,
      [
        String(name).trim(),
        cleanSlug,
        description ? String(description).trim() : '',
        type,
        category || null,
        JSON.stringify(cleanTags),
        isPublic,
        req.userId,
      ]
    )

    await pool.query(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
      [result.insertId, req.userId]
    )

    res.status(201).json({ id: result.insertId, slug: cleanSlug })
  } catch (err) {
    console.error('POST /api/groups error:', err)
    res.status(500).json({ error: 'Failed to create group' })
  }
})

router.post('/groups/:id/cover', authenticate, fileUploadLimit, coverUpload.single('cover'), async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    const [[group]] = await pool.query(
      'SELECT id, created_by FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) {
      fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
      return res.status(404).json({ error: 'Group not found' })
    }
    if (group.created_by !== req.userId) {
      fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
      return res.status(403).json({ error: 'Forbidden' })
    }

    const coverUrl = `/uploads/${req.file.filename}`
    await pool.query('UPDATE conversations SET cover_url = ? WHERE id = ?', [coverUrl, groupId])

    res.json({ coverUrl })
  } catch (err) {
    console.error('POST /api/groups/:id/cover error:', err)
    if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
    res.status(500).json({ error: 'Failed to upload cover' })
  }
})


export default router
