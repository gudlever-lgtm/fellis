import express from 'express'
import pool from '../db.js'
import fs from 'fs'
import path from 'path'
import {
  authenticate, writeLimit, fileUploadLimit,
  upload, coverUpload, UPLOADS_DIR,
} from '../middleware.js'

const router = express.Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getGroupById(id) {
  const [[g]] = await pool.query(
    'SELECT id, type, is_group FROM conversations WHERE id = ? AND is_group = 1',
    [id]
  )
  return g || null
}

async function getMemberRole(groupId, userId) {
  const [[row]] = await pool.query(
    "SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND status = 'active'",
    [groupId, userId]
  )
  return row?.role || null
}

// ── Group discovery ───────────────────────────────────────────────────────────

// GET /groups — public discover with optional category/search/sort
router.get('/groups', authenticate, async (req, res) => {
  const { category, search, sort = 'trending' } = req.query
  try {
    const conditions = [
      `c.is_group = 1`,
      `c.type != 'hidden'`,
      `(c.group_status IS NULL OR c.group_status = 'active')`,
    ]
    const params = [req.userId]
    if (category) { conditions.push(`c.category = ?`); params.push(category) }
    if (search) {
      conditions.push(`(c.name LIKE ? OR c.description_da LIKE ? OR c.description_en LIKE ?)`)
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    const orderBy =
      sort === 'newest'  ? 'c.created_at DESC' :
      sort === 'members' ? 'c.member_count DESC' :
      'c.member_count DESC, c.created_at DESC'

    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.category,
              c.description_da, c.description_en,
              c.cover_url, c.member_count, c.type,
              (cp.user_id IS NOT NULL AND cp.status = 'active') AS is_member,
              cp.status AS my_status
       FROM conversations c
       LEFT JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = ?
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 60`,
      params
    )
    const groups = rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      description: r.description_da || r.description_en || '',
      coverUrl: r.cover_url || null,
      memberCount: Number(r.member_count) || 0,
      type: r.type || 'public',
      isMember: Boolean(r.is_member),
      hasRequested: r.my_status === 'pending',
    }))
    res.json({ groups })
  } catch (err) {
    console.error('GET /api/groups error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// GET /groups/me — groups I'm an active member of
router.get('/groups/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.category, c.cover_url,
              c.member_count, c.type, c.group_status,
              cp.role AS my_role
       FROM conversations c
       JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = ?
       WHERE c.is_group = 1 AND cp.status = 'active'
       ORDER BY c.name ASC`,
      [req.userId]
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error('GET /api/groups/me error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// GET /groups/admin/pending — platform admin: groups awaiting approval
router.get('/groups/admin/pending', authenticate, async (req, res) => {
  if (!req.adminRole) return res.status(403).json({ error: 'admin_only' })
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.category,
              c.description_da, c.description_en,
              c.cover_url, c.member_count, c.type, c.created_at,
              u.name AS creator_name
       FROM conversations c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.is_group = 1 AND c.group_status = 'pending'
       ORDER BY c.created_at ASC`,
      []
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error('GET /api/groups/admin/pending error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// POST /groups/admin/:id/approve
router.post('/groups/admin/:id/approve', authenticate, async (req, res) => {
  if (!req.adminRole) return res.status(403).json({ error: 'admin_only' })
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'invalid_id' })
  try {
    await pool.query(
      `UPDATE conversations SET group_status = 'active' WHERE id = ? AND is_group = 1`,
      [id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/admin/:id/approve error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// POST /groups/admin/:id/reject
router.post('/groups/admin/:id/reject', authenticate, async (req, res) => {
  if (!req.adminRole) return res.status(403).json({ error: 'admin_only' })
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'invalid_id' })
  try {
    await pool.query(
      `UPDATE conversations SET group_status = 'rejected' WHERE id = ? AND is_group = 1`,
      [id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/admin/:id/reject error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.get('/groups/suggestions', authenticate, async (req, res) => {
  try {
    const [suggestions] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.category, c.description_da, c.description_en,
              c.cover_url, c.member_count,
              COUNT(DISTINCT cp2.user_id) AS shared_members
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
       ORDER BY shared_members DESC, c.member_count DESC
       LIMIT 5`,
      [req.userId, req.userId, req.userId]
    )

    if (suggestions.length === 0) {
      const [popular] = await pool.query(
        `SELECT c.id, c.name, c.slug, c.category, c.description_da, c.description_en,
                c.cover_url, c.member_count, 0 AS shared_members
         FROM conversations c
         WHERE c.is_public = 1
           AND c.is_group = 1
           AND c.id NOT IN (
             SELECT conversation_id FROM conversation_participants WHERE user_id = ?
           )
         ORDER BY c.member_count DESC
         LIMIT 5`,
        [req.userId]
      )
      return res.json({ suggestions: popular })
    }

    res.json({ suggestions })
  } catch (err) {
    console.error('GET /api/groups/suggestions error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ── Create group ──────────────────────────────────────────────────────────────

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
    const [[existing]] = await pool.query('SELECT id FROM conversations WHERE slug = ?', [cleanSlug])
    if (existing) return res.status(409).json({ error: 'slug_taken' })

    const groupStatus = req.adminRole ? 'active' : 'pending'
    const [result] = await pool.query(
      `INSERT INTO conversations
         (name, slug, description_da, type, category, tags, is_group, is_public,
          created_by, member_count, group_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, NOW())`,
      [
        String(name).trim(),
        cleanSlug,
        description ? String(description).trim() : '',
        type,
        category || null,
        JSON.stringify(cleanTags),
        isPublic,
        req.userId,
        groupStatus,
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

// ── Cover upload ──────────────────────────────────────────────────────────────

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

// ── Join ──────────────────────────────────────────────────────────────────────

router.post('/groups/:id/join', authenticate, writeLimit, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group ID' })
  try {
    const [[group]] = await pool.query(
      'SELECT id, type, is_group FROM conversations WHERE id = ? AND is_group = 1',
      [groupId]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    const existingRole = await getMemberRole(groupId, req.userId)
    if (existingRole) return res.status(409).json({ error: 'Already a member' })

    if (group.type === 'public') {
      await pool.query(
        'INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, req.userId, 'member']
      )
      await pool.query('UPDATE conversations SET member_count = member_count + 1 WHERE id = ?', [groupId])
      return res.json({ ok: true, status: 'joined' })
    }

    // private / hidden — set pending status
    await pool.query(
      'INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, status) VALUES (?, ?, ?, ?)',
      [groupId, req.userId, 'member', 'pending']
    )
    res.json({ ok: true, status: 'pending' })
  } catch (err) {
    console.error('POST /api/groups/:id/join error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ── Leave ─────────────────────────────────────────────────────────────────────

// POST /api/groups/:id/leave — the last admin cannot leave
router.post('/groups/:id/leave', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[cp]] = await pool.query(
      'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, req.userId]
    )
    if (!cp) return res.status(404).json({ error: 'not_a_member' })

    // last admin guard: prevent removing the last admin
    if (cp.role === 'admin') {
      const [[adminCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ? AND role = 'admin' AND status = 'active'",
        [groupId]
      )
      if (adminCount.n <= 1) {
        return res.status(400).json({ error: 'last admin cannot leave — promote another member first' })
      }
    }

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, req.userId]
    )
    await pool.query('UPDATE conversations SET member_count = GREATEST(member_count - 1, 0) WHERE id = ?', [groupId])
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/leave error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ── Group detail (slug-based) ─────────────────────────────────────────────────

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

// ── Posts (id-based) ──────────────────────────────────────────────────────────

router.get('/groups/:id/posts', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const role = await getMemberRole(groupId, req.userId)
    const isMember = !!role
    if ((group.type === 'hidden' || group.type === 'private') && !isMember) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const [posts] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.created_at, p.is_pinned,
              u.name AS author_name, u.id AS author_id,
              (SELECT reaction FROM post_likes WHERE post_id = p.id AND user_id = ?) AS my_reaction
       FROM posts p
       JOIN users u ON u.id = p.author_id
       WHERE p.group_id = ?
       ORDER BY p.is_pinned DESC, p.created_at DESC
       LIMIT 50`,
      [req.userId, groupId]
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
    console.error('GET /api/groups/:id/posts error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:id/posts', authenticate, writeLimit, upload.single('media'), async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'invalid_id' })
  const { text } = req.body || {}
  if (!text?.trim()) {
    if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
    return res.status(400).json({ error: 'text_required' })
  }
  try {
    const group = await getGroupById(groupId)
    if (!group) {
      if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
      return res.status(404).json({ error: 'not_found' })
    }

    const role = await getMemberRole(groupId, req.userId)
    if (!role) {
      if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
      return res.status(403).json({ error: 'members_only' })
    }

    const clean = text.trim()
    const mediaJson = req.file ? JSON.stringify([`/uploads/${req.file.filename}`]) : null
    const [result] = await pool.query(
      'INSERT INTO posts (author_id, text_da, text_en, media, group_id) VALUES (?, ?, ?, ?, ?)',
      [req.userId, clean, clean, mediaJson, groupId]
    )
    await pool.query('UPDATE conversations SET post_count = post_count + 1 WHERE id = ?', [groupId])

    const [[post]] = await pool.query(
      `SELECT p.id, p.text_da, p.text_en, p.media, p.created_at, p.is_pinned,
              u.name AS author_name, u.id AS author_id
       FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      [result.insertId]
    )
    res.status(201).json({ ...post, reactions: {}, my_reaction: null })
  } catch (err) {
    console.error('POST /api/groups/:id/posts error:', err)
    if (req.file) fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {})
    res.status(500).json({ error: 'server_error' })
  }
})

router.delete('/groups/:id/posts/:postId', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const [[post]] = await pool.query(
      'SELECT author_id FROM posts WHERE id = ? AND group_id = ?',
      [postId, groupId]
    )
    if (!post) return res.status(404).json({ error: 'not_found' })

    const role = await getMemberRole(groupId, req.userId)
    const isOwner = post.author_id === req.userId
    const isMod = role === 'admin' || role === 'moderator'
    if (!isOwner && !isMod) return res.status(403).json({ error: 'forbidden' })

    await pool.query('DELETE FROM posts WHERE id = ?', [postId])
    await pool.query('UPDATE conversations SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?', [groupId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:id/posts/:postId error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:id/posts/:postId/pin', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
  const { pinned } = req.body || {}
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const role = await getMemberRole(groupId, req.userId)
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ error: 'forbidden' })
    }

    if (pinned) {
      await pool.query('UPDATE posts SET is_pinned = 0 WHERE group_id = ?', [groupId])
      await pool.query('UPDATE posts SET is_pinned = 1 WHERE id = ? AND group_id = ?', [postId, groupId])
      await pool.query('UPDATE conversations SET pinned_post_id = ? WHERE id = ?', [postId, groupId])
    } else {
      await pool.query('UPDATE posts SET is_pinned = 0 WHERE id = ?', [postId])
      await pool.query('UPDATE conversations SET pinned_post_id = NULL WHERE id = ? AND pinned_post_id = ?', [groupId, postId])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/groups/:id/posts/:postId/pin error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.post('/groups/:id/posts/:postId/react', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const postId = parseInt(req.params.postId)
  if (isNaN(groupId) || isNaN(postId)) return res.status(400).json({ error: 'invalid_id' })
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
    console.error('POST /api/groups/:id/posts/:postId/react error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ── Members (id-based) ────────────────────────────────────────────────────────

router.get('/groups/:id/members', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  if (isNaN(groupId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const role = await getMemberRole(groupId, req.userId)
      if (!role) return res.status(403).json({ error: 'forbidden' })
    }

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url, COALESCE(cp.role, 'member') AS role
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = ? AND cp.status = 'active'
       ORDER BY FIELD(cp.role, 'admin', 'moderator', 'member'), u.name`,
      [groupId]
    )
    res.json({ members })
  } catch (err) {
    console.error('GET /api/groups/:id/members error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// PUT /api/groups/:id/members/:userId/role — admin only
router.put('/groups/:id/members/:userId/role', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(groupId) || isNaN(targetId)) return res.status(400).json({ error: 'invalid_id' })
  const { role } = req.body || {}
  if (!['moderator', 'member'].includes(role)) return res.status(400).json({ error: 'invalid_role' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const myRole = await getMemberRole(groupId, req.userId)
    if (myRole !== 'admin') return res.status(403).json({ error: 'admin_only' })

    await pool.query(
      'UPDATE conversation_participants SET role = ? WHERE conversation_id = ? AND user_id = ?',
      [role, groupId, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/groups/:id/members/:userId/role error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

router.delete('/groups/:id/members/:userId', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id)
  const targetId = parseInt(req.params.userId)
  if (isNaN(groupId) || isNaN(targetId)) return res.status(400).json({ error: 'invalid_id' })
  try {
    const group = await getGroupById(groupId)
    if (!group) return res.status(404).json({ error: 'not_found' })

    const myRole = await getMemberRole(groupId, req.userId)
    if (myRole !== 'admin' && myRole !== 'moderator') {
      return res.status(403).json({ error: 'forbidden' })
    }

    const [[target]] = await pool.query(
      'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, targetId]
    )
    if (!target) return res.status(404).json({ error: 'not_found' })

    // last admin guard: cannot remove the last admin
    if (target.role === 'admin') {
      const [[adminCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ? AND role = 'admin' AND status = 'active'",
        [groupId]
      )
      if (adminCount.n <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' })
      }
    }
    if (myRole === 'moderator' && target.role === 'moderator') {
      return res.status(403).json({ error: 'insufficient_permissions' })
    }

    await pool.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [groupId, targetId]
    )
    await pool.query('UPDATE conversations SET member_count = GREATEST(member_count - 1, 0) WHERE id = ?', [groupId])
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/groups/:id/members/:userId error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ── Events (slug-based) ───────────────────────────────────────────────────────

router.get('/groups/:slug/events', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const role = await getMemberRole(group.id, req.userId)
      if (!role) return res.status(403).json({ error: 'forbidden' })
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

// ── Polls (slug-based) ────────────────────────────────────────────────────────

router.get('/groups/:slug/polls', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, type FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    if (group.type === 'hidden') {
      const role = await getMemberRole(group.id, req.userId)
      if (!role) return res.status(403).json({ error: 'forbidden' })
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

    const role = await getMemberRole(group.id, req.userId)
    if (!role) return res.status(403).json({ error: 'members_only' })

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

// ── Invite link (slug-based) ──────────────────────────────────────────────────

router.get('/groups/:slug/invite', authenticate, async (req, res) => {
  try {
    const [[group]] = await pool.query(
      'SELECT id, slug FROM conversations WHERE slug = ? AND is_group = 1',
      [req.params.slug]
    )
    if (!group) return res.status(404).json({ error: 'not_found' })

    const role = await getMemberRole(group.id, req.userId)
    if (!role) return res.status(403).json({ error: 'members_only' })

    res.json({ link: `/groups/${group.slug}` })
  } catch (err) {
    console.error('GET /api/groups/:slug/invite error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

export default router
