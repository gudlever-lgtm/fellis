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
      'INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)',
      [result.insertId, req.userId, 'admin']
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

// ── Group detail: slug-based routes ──────────────────────────────────────────

router.get('/groups/:slug', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM conversation_participants
               WHERE conversation_id = c.id AND status = 'active') AS member_count,
              cp.role AS my_role,
              cp.status AS my_status
       FROM conversations c
       LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
       WHERE c.slug = ? AND c.is_group = 1`,
      [req.userId, req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const isMember = group.my_role !== null && group.my_status === 'active'
    if (group.type === 'hidden' && !isMember) {
      return res.status(403).json({ error: 'forbidden' })
    }

    let tags = []
    try { tags = group.tags ? JSON.parse(group.tags) : [] } catch {}

    res.json({
      id: group.id,
      name: group.name,
      slug: group.slug,
      description_da: group.description_da,
      description_en: group.description_en,
      type: group.type || 'public',
      category: group.category,
      tags,
      cover_url: group.cover_url || null,
      member_count: Number(group.member_count) || 0,
      created_at: group.created_at,
      created_by: group.created_by,
      pinned_post_id: group.pinned_post_id || null,
      membership: {
        isMember,
        role: group.my_role || null,
        hasRequested: group.my_status === 'pending',
      },
    })
  } catch (err) {
    console.error('GET /api/groups/:slug error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/:slug/posts', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    const isMember = !!cp
    if ((group.type === 'hidden' || group.type === 'private') && !isMember) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.created_at, p.is_pinned,
              u.name AS author_name, u.id AS author_id,
              (SELECT reaction FROM post_likes WHERE post_id = p.id AND user_id = ?) AS my_reaction
       FROM posts p
       JOIN users u ON u.id = p.author_id
       WHERE p.group_id = ?
       ORDER BY p.is_pinned DESC, p.created_at DESC
       LIMIT 50`,
      [req.userId, group.id]
    )

    if (posts.length) {
      const postIds = posts.map(p => p.id)
      const [reactionRows] = await pool.query(
        'SELECT post_id, reaction, COUNT(*) AS cnt FROM post_likes WHERE post_id IN (?) GROUP BY post_id, reaction',
        [postIds]
      )
      const reactMap = {}
      for (const row of reactionRows) {
        if (!reactMap[row.post_id]) reactMap[row.post_id] = {}
        reactMap[row.post_id][row.reaction] = Number(row.cnt)
      }
      posts.forEach(p => { p.reactions = reactMap[p.id] || {} })
    }

    res.json({ posts })
  } catch (err) {
    console.error('GET /api/groups/:slug/posts error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:slug/posts', authenticate, writeLimit, upload.single('media'), async (req, res) => {
  const { text } = req.body || {}
  if (!text?.trim()) return res.status(400).json({ error: 'text_required' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp) {
      if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
      return res.status(403).json({ error: 'members_only' })
    }

    const clean = text.trim()
    const mediaJson = req.file ? JSON.stringify([`/uploads/${req.file.filename}`]) : null
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, media, group_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, clean, clean, mediaJson, group.id]
    )
    const [[post]] = await pool.query(
      'SELECT p.id, p.text_da, p.text_en, p.media, p.created_at, p.is_pinned, u.name AS author_name, u.id AS author_id FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?',
      [result.insertId]
    )
    res.status(201).json({ ...post, reactions: {}, my_reaction: null })
  } catch (err) {
    console.error('POST /api/groups/:slug/posts error:', err)
    if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
    res.status(500).json({ error: 'server_error' })
  }
})

router.delete('/groups/:slug/posts/:postId', authenticate, async (req, res) => {
  const postId = parseInt(req.params.postId)
  if (isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[post]] = await pool.query(
      'SELECT author_id FROM posts WHERE id = ? AND group_id = ?',
      [postId, group.id]
    )
    if (!post) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    const isOwner = post.author_id === req.userId
    const isMod = cp?.role === 'admin' || cp?.role === 'moderator'
    if (!isOwner && !isMod) return res.status(403).json({ error: 'forbidden' })

    await pool.query('DELETE FROM posts WHERE id = ?', [postId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:slug/posts/:postId error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:slug/posts/:postId/pin', authenticate, async (req, res) => {
  const postId = parseInt(req.params.postId)
  if (isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
  const { pinned } = req.body || {}
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp || (cp.role !== 'admin' && cp.role !== 'moderator')) {
      return res.status(403).json({ error: 'forbidden' })
    }

    if (pinned) {
      await pool.query('UPDATE posts SET is_pinned = 0 WHERE group_id = ?', [group.id])
      await pool.query('UPDATE posts SET is_pinned = 1 WHERE id = ? AND group_id = ?', [postId, group.id])
      await pool.query('UPDATE conversations SET pinned_post_id = ? WHERE id = ?', [postId, group.id])
    } else {
      await pool.query('UPDATE posts SET is_pinned = 0 WHERE id = ?', [postId])
      await pool.query('UPDATE conversations SET pinned_post_id = NULL WHERE id = ? AND pinned_post_id = ?', [group.id, postId])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:slug/posts/:postId/pin error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:slug/posts/:postId/react', authenticate, async (req, res) => {
  const postId = parseInt(req.params.postId)
  if (isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
  const { reaction } = req.body || {}
  if (!['like', 'love', 'insightful'].includes(reaction)) return res.status(400).json({ error: 'invalid_reaction' })
  try {
    const [[existing]] = await pool.query(
      'SELECT reaction FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    )
    if (existing && existing.reaction === reaction) {
      await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.userId])
      return res.json({ reaction: null })
    }
    await pool.query(
      'INSERT INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reaction = ?',
      [postId, req.userId, reaction, reaction]
    )
    res.json({ reaction })
  } catch (err) {
    console.error('POST /api/groups/:slug/posts/:postId/react error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/:slug/members', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const [[cp]] = await pool.query(
        "SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
        [group.id, req.userId]
      )
      if (!cp) return res.status(403).json({ error: 'forbidden' })
    }

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url, COALESCE(cp.role, 'member') AS role, cp.joined_at
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = ? AND cp.status = 'active'
       ORDER BY FIELD(cp.role, 'admin', 'moderator', 'member'), u.name`,
      [group.id]
    )
    res.json({ members })
  } catch (err) {
    console.error('GET /api/groups/:slug/members error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.patch('/groups/:slug/members/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId)) return res.status(400).json({ error: 'invalid_id' })
  const { role } = req.body || {}
  if (!['moderator', 'member'].includes(role)) return res.status(400).json({ error: 'invalid_role' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp || cp.role !== 'admin') return res.status(403).json({ error: 'admin_only' })

    await pool.query(
      'UPDATE conversation_participants SET role = ? WHERE conversation_id = ? AND user_id = ?',
      [role, group.id, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/groups/:slug/members/:userId error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.delete('/groups/:slug/members/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId)
  if (isNaN(targetId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp || (cp.role !== 'admin' && cp.role !== 'moderator')) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const [[target]] = await pool.query(
      'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [group.id, targetId]
    )
    if (target?.role === 'admin') return res.status(403).json({ error: 'cannot_remove_admin' })
    if (cp.role === 'moderator' && target?.role === 'moderator') {
      return res.status(403).json({ error: 'insufficient_permissions' })
    }

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [group.id, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:slug/members/:userId error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/:slug/events', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const [[cp]] = await pool.query(
        "SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
        [group.id, req.userId]
      )
      if (!cp) return res.status(403).json({ error: 'forbidden' })
    }

    const [events] = await pool.query(
      `SELECT e.*,
              (SELECT status FROM event_rsvps WHERE event_id = e.id AND user_id = ?) AS my_rsvp,
              (SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going') AS going_count
       FROM events e
       WHERE e.group_id = ? AND (e.start_time IS NULL OR e.start_time >= NOW())
       ORDER BY e.start_time ASC
       LIMIT 20`,
      [req.userId, group.id]
    )
    res.json({ events })
  } catch (err) {
    console.error('GET /api/groups/:slug/events error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:slug/events/:eventId/rsvp', authenticate, async (req, res) => {
  const eventId = parseInt(req.params.eventId)
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' })
  const { status } = req.body || {}
  if (!['going', 'maybe', 'notGoing'].includes(status)) return res.status(400).json({ error: 'invalid_status' })
  try {
    await pool.query(
      'INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
      [eventId, req.userId, status, status]
    )
    res.json({ ok: true, status })
  } catch (err) {
    console.error('POST /api/groups/:slug/events/:eventId/rsvp error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/:slug/polls', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const [[cp]] = await pool.query(
        "SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
        [group.id, req.userId]
      )
      if (!cp) return res.status(403).json({ error: 'forbidden' })
    }

    const [polls] = await pool.query(
      `SELECT p.*,
              (SELECT option_idx FROM group_poll_votes WHERE poll_id = p.id AND user_id = ?) AS user_vote
       FROM group_polls p
       WHERE p.group_id = ? AND (p.ends_at IS NULL OR p.ends_at > NOW())
       ORDER BY p.created_at DESC`,
      [req.userId, group.id]
    )

    const enriched = await Promise.all(polls.map(async (poll) => {
      let options = []
      try { options = JSON.parse(poll.options) } catch {}
      const [votes] = await pool.query(
        'SELECT option_idx, COUNT(*) AS cnt FROM group_poll_votes WHERE poll_id = ? GROUP BY option_idx',
        [poll.id]
      )
      const voteCounts = {}
      votes.forEach(v => { voteCounts[v.option_idx] = Number(v.cnt) })
      return {
        ...poll,
        options: options.map((opt, idx) => ({
          id: idx,
          text_da: opt.text_da || opt.text || '',
          text_en: opt.text_en || opt.text || '',
          vote_count: voteCounts[idx] || 0,
        })),
      }
    }))

    res.json({ polls: enriched })
  } catch (err) {
    console.error('GET /api/groups/:slug/polls error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:slug/polls/:pollId/vote', authenticate, async (req, res) => {
  const pollId = parseInt(req.params.pollId)
  if (isNaN(pollId)) return res.status(400).json({ error: 'invalid_id' })
  const optionIdx = Number(req.body?.optionIdx)
  if (!Number.isInteger(optionIdx) || optionIdx < 0) return res.status(400).json({ error: 'invalid_option' })
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp) return res.status(403).json({ error: 'members_only' })

    const [[poll]] = await pool.query(
      'SELECT id, options FROM group_polls WHERE id = ? AND group_id = ?',
      [pollId, group.id]
    )
    if (!poll) return res.status(404).json({ error: 'not_found' })

    let opts = []
    try { opts = JSON.parse(poll.options) } catch {}
    if (optionIdx >= opts.length) return res.status(400).json({ error: 'invalid_option' })

    await pool.query(
      'INSERT INTO group_poll_votes (poll_id, user_id, option_idx) VALUES (?, ?, ?)',
      [pollId, req.userId, optionIdx]
    )
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already_voted' })
    console.error('POST /api/groups/:slug/polls/:pollId/vote error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.delete('/groups/:slug/leave', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [group.id, req.userId]
    )
    if (cp?.role === 'admin') return res.status(400).json({ error: 'admin_cannot_leave' })

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [group.id, req.userId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:slug/leave error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/:slug/invite', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, slug FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      "SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
      [group.id, req.userId]
    )
    if (!cp) return res.status(403).json({ error: 'members_only' })

    res.json({ link: `/groups/${group.slug}` })
  } catch (err) {
    console.error('GET /api/groups/:slug/invite error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})


export default router
