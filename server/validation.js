/**
 * server/validation.js — Zod validation schemas and middleware factory
 *
 * Usage:
 *   import { validate, schemas } from './validation.js'
 *   app.post('/api/auth/login', validate(schemas.login), handler)
 */

import { z } from 'zod'

// ── Re-usable field definitions ────────────────────────────────────────────

const email = z.string().email('Invalid email address').max(254).toLowerCase().trim()
const password = z.string().min(8, 'Password must be at least 8 characters').max(128)
const optionalPassword = z.string().max(128).optional()
const handle = z.string().min(2).max(30).regex(/^[a-z0-9_.]+$/, 'Handle may only contain lowercase letters, numbers, . and _')
const name = z.string().min(1, 'Name is required').max(100).trim()
const lang = z.enum(['da', 'en']).optional().default('da')
const nonEmptyString = z.string().min(1).max(5000).trim()
const optionalText = z.string().max(5000).trim().optional()
const positiveInt = z.number().int().positive()

// ── Auth schemas ───────────────────────────────────────────────────────────

const login = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  lang: lang.optional(),
  rememberMe: z.boolean().optional(),
})

const register = z.object({
  name,
  email,
  password,
  handle: handle.optional(),
  lang: lang.optional(),
  inviteToken: z.string().max(128).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Birthday must be YYYY-MM-DD').optional().or(z.literal('')),
  location: z.string().max(200).trim().optional(),
})

const forgotPassword = z.object({
  email,
  lang: lang.optional(),
})

const resetPassword = z.object({
  token: z.string().min(1).max(256),
  password,
})

const verifyMfa = z.object({
  userId: positiveInt,
  code: z.string().min(6).max(6).regex(/^\d{6}$/, 'MFA code must be 6 digits'),
  lang: lang.optional(),
})

const changePassword = z.object({
  currentPassword: optionalPassword,
  newPassword: password,
  mfaCode: z.string().max(6).optional(),
})

// ── Post schemas ───────────────────────────────────────────────────────────

const createPost = z.object({
  text_da: optionalText,
  text_en: optionalText,
  categories: z.array(z.string().max(64)).max(10).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
}).refine(d => (d.text_da && d.text_da.length > 0) || (d.text_en && d.text_en.length > 0), {
  message: 'Post must have text in at least one language',
})

const createComment = z.object({
  text: nonEmptyString,
  parentId: positiveInt.optional().nullable(),
})

// ── Profile update schema ──────────────────────────────────────────────────

const updateProfile = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  handle: handle.optional(),
  bio_da: z.string().max(1000).trim().optional(),
  bio_en: z.string().max(1000).trim().optional(),
  location: z.string().max(200).trim().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').optional()),
  website: z.string().url('Invalid URL').max(500).optional().or(z.literal('')),
  relationship_status: z.enum(['single', 'in_relationship', 'engaged', 'married', 'divorced', 'widowed', 'complicated', '']).optional(),
  industry: z.string().max(100).trim().optional(),
  seniority: z.string().max(50).trim().optional(),
  job_title: z.string().max(100).trim().optional(),
  company: z.string().max(100).trim().optional(),
  phone: z.string().max(30).trim().optional().or(z.literal('')),
  profile_public: z.boolean().optional(),
  interests: z.array(z.string().max(64)).max(50).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  lang: lang.optional(),
  // Business fields
  business_category: z.string().max(100).optional(),
  business_website: z.string().url().max(500).optional().or(z.literal('')),
  business_hours: z.string().max(500).optional(),
  business_description_da: z.string().max(2000).optional(),
  business_description_en: z.string().max(2000).optional(),
}).strict()

// ── Marketplace schema ─────────────────────────────────────────────────────

const createListing = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).trim().optional(),
  price: z.number().min(0).max(1_000_000),
  currency: z.string().length(3).optional().default('EUR'),
  category: z.string().max(64).optional(),
  location: z.string().max(200).trim().optional(),
  contact_phone: z.string().max(30).trim().optional(),
  contact_email: z.string().email().max(254).optional().or(z.literal('')),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor', '']).optional(),
})

// ── Conversation / Message schema ──────────────────────────────────────────

const sendMessage = z.object({
  text: z.string().min(1).max(10000).trim(),
  mediaUrl: z.string().url().max(1000).optional().or(z.literal('')),
})

const createConversation = z.object({
  participantIds: z.array(positiveInt).min(1).max(50),
  name: z.string().max(100).trim().optional(),
  message: z.string().min(1).max(10000).trim().optional(),
})

// ── Job / CV schemas ───────────────────────────────────────────────────────

const createJob = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(10000).trim().optional(),
  location: z.string().max(200).trim().optional(),
  salary_min: z.number().min(0).optional(),
  salary_max: z.number().min(0).optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'internship', 'freelance', '']).optional(),
  industry: z.string().max(100).trim().optional(),
  remote: z.boolean().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
})

// ── Event schema ───────────────────────────────────────────────────────────

const createEvent = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(5000).trim().optional(),
  location: z.string().max(300).trim().optional(),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }).optional(),
  is_public: z.boolean().optional().default(true),
  max_attendees: z.number().int().min(1).max(100000).optional(),
})

// ── Report schema ──────────────────────────────────────────────────────────

const createReport = z.object({
  target_type: z.enum(['post', 'comment', 'user', 'reel', 'listing', 'job']),
  target_id: positiveInt,
  reason: z.enum(['spam', 'harassment', 'hate_speech', 'misinformation', 'nudity', 'violence', 'other']),
  details: z.string().max(1000).trim().optional(),
})

// ── Exported schemas map ───────────────────────────────────────────────────

export const schemas = {
  login,
  register,
  forgotPassword,
  resetPassword,
  verifyMfa,
  changePassword,
  createPost,
  createComment,
  updateProfile,
  createListing,
  sendMessage,
  createConversation,
  createJob,
  createEvent,
  createReport,
}

/**
 * validate(schema) — Express middleware that validates req.body against a zod schema.
 * On failure returns 400 with a structured error list.
 * On success, replaces req.body with the parsed (coerced + trimmed) data.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const errors = result.error.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }))
      return res.status(400).json({ error: 'Validation failed', errors })
    }
    req.body = result.data
    next()
  }
}
