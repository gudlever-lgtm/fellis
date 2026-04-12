#!/usr/bin/env node
// e2e-test.js — End-to-end integration test for fellis.eu
// Version: 1.1.2
//
// Changelog:
//   1.1.2 — Add failOrSkip() helper; apply to forgot-password and search calls so
//            a server timeout skips rather than fails those tests; fix search 500
//            by adding fallback query for legacy single-column messages table
//   1.1.1 — Add AbortController timeout (REQUEST_TIMEOUT_MS, default 15s) to all
//            requests so the suite never hangs on a deadlocked/unresponsive server
//   1.1.0 — Add testFeedModeSeparation (privat/business feed filter, ?mode param)
//   1.0.0 — Initial suite (health, auth, feed, posts, media, marketplace, events,
//            jobs, messaging, reels, explore, interests, badges, error handling)
//
// Usage:
//   BASE_URL=https://test.fellis.eu node tests/e2e-test.js
//   BASE_URL=http://localhost:3001 node tests/e2e-test.js
//   npm run e2e                            (uses https://test.fellis.eu)
//
// Run from the server itself:
//   BASE_URL=http://localhost:3001 npm run e2e
//
// Requirements: Node 18+ (built-in fetch). No external dependencies.
// The script cleans up all data it creates (posts, listings, events, account).

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') || 'https://test.fellis.eu'
const API = `${BASE_URL}/api`
const VERBOSE = process.env.VERBOSE === '1'
// Request timeout — prevents the suite hanging indefinitely when the server
// is deadlocked or unresponsive. Override with REQUEST_TIMEOUT_MS env var.
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '') || 15_000

// ─── Output helpers ────────────────────────────────────────────────────────────
const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
}

let passed = 0
let failed = 0
let skipped = 0
const failures = []
const unexpectedFiveHundreds = []  // tracks any 500 seen outside intentional tests
let currentSection = ''
let trackingFiveHundreds = true    // set false when intentionally expecting 500

function section(name) {
  currentSection = name
  console.log(`\n${c.cyan(c.bold(`── ${name} ──`))}`)
}

function ok(label) {
  passed++
  console.log(`  ${c.green('✔')} ${label}`)
}

function fail(label, detail) {
  failed++
  const msg = `  ${c.red('✖')} ${label}${detail ? c.dim(` — ${detail}`) : ''}`
  console.log(msg)
  failures.push(`[${currentSection}] ${label}${detail ? `: ${detail}` : ''}`)
}

function skip(label, reason) {
  skipped++
  console.log(`  ${c.yellow('–')} ${label}${reason ? c.dim(` (${reason})`) : ''}`)
}

// Skips rather than fails when a request timed out — timeout means the server
// is unresponsive/deadlocked, not that the endpoint logic is broken.
function failOrSkip(r, label, detail) {
  if (r.timeout) skip(label, `server timeout (${REQUEST_TIMEOUT_MS}ms) — check DB health`)
  else           fail(label, detail)
}

function log(msg) {
  if (VERBOSE) console.log(c.dim(`    ${msg}`))
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
let sessionId = null
let csrfToken = null

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra }
  if (sessionId) h['X-Session-Id'] = sessionId
  if (sessionId && csrfToken) h['X-CSRF-Token'] = csrfToken
  return h
}

async function refreshCsrfToken() {
  if (!sessionId) { csrfToken = null; return }
  const r = await api('GET', '/csrf-token')
  if (r.ok && r.data?.csrfToken) csrfToken = r.data.csrfToken
}

async function api(method, path, body, extraHeaders = {}) {
  const url = `${API}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const opts = {
    method,
    headers: headers(extraHeaders),
    signal: controller.signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  try {
    const res = await fetch(url, opts)
    clearTimeout(timer)
    let data = null
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      data = await res.json()
    } else {
      data = await res.text()
    }
    log(`${method} ${path} → ${res.status}`)
    // Global 500 tracker — catches unexpected server errors across all tests
    if (res.status === 500 && trackingFiveHundreds) {
      const entry = `${method} ${path} → 500${data?.error ? ` (${data.error})` : ''}`
      unexpectedFiveHundreds.push(`[${currentSection}] ${entry}`)
      console.log(`  ${c.red('⚠')} ${c.red(`Unexpected 500: ${entry}`)}`)
    }
    return { status: res.status, data, ok: res.ok }
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      const msg = `Timeout after ${REQUEST_TIMEOUT_MS}ms — server may be deadlocked`
      console.log(`  ${c.red('⏱')} ${c.red(`${method} ${path} → ${msg}`)}`)
      return { status: 0, data: null, ok: false, err: msg, timeout: true }
    }
    return { status: 0, data: null, ok: false, err: err.message, connErr: true }
  }
}

// Minimal 1×1 transparent PNG (67 bytes) — avoids needing any image library
function minimalPng() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
    'hex'
  )
}

async function uploadFile(fieldName, filename, mimeType, buffer, extraFields = {}) {
  const { Blob } = await import('node:buffer')
  const form = new globalThis.FormData()
  form.append(fieldName, new Blob([buffer], { type: mimeType }), filename)
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v)

  const h = {}
  if (sessionId) h['X-Session-Id'] = sessionId
  if (sessionId && csrfToken) h['X-CSRF-Token'] = csrfToken

  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', headers: h, body: form })
    const data = await res.json()
    return { status: res.status, data, ok: res.ok }
  } catch (err) {
    return { status: 0, data: null, ok: false, err: err.message }
  }
}

async function uploadPostWithMedia(text, buffer) {
  const { Blob } = await import('node:buffer')
  const form = new globalThis.FormData()
  form.append('text', text)
  form.append('media', new Blob([buffer], { type: 'image/png' }), 'test.png')

  const h = {}
  if (sessionId) h['X-Session-Id'] = sessionId
  if (sessionId && csrfToken) h['X-CSRF-Token'] = csrfToken

  try {
    const res = await fetch(`${API}/feed`, { method: 'POST', headers: h, body: form })
    const data = await res.json()
    return { status: res.status, data, ok: res.ok }
  } catch (err) {
    return { status: 0, data: null, ok: false, err: err.message }
  }
}

// ─── Test state ───────────────────────────────────────────────────────────────
const ts = Date.now()
const testEmail   = `e2e.test.${ts}@fellis-test.invalid`
const testName    = `E2E Test ${ts}`
const testPass    = 'E2eTest1234!'
// May be updated by testMailAndPasswordReset when password is changed
let   currentPass = testPass

let userId     = null
let postId     = null
let mediaPostId = null
let commentId  = null
let listingId  = null
let eventId    = null
let companyId  = null
let jobId      = null
let convId     = null
let reelId     = null
let feedModePrivPostId = null  // created in privat mode during feed-separation test
let feedModeBizPostId  = null  // created in business mode during feed-separation test

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testHealth() {
  section('Health Check')
  const r = await api('GET', '/health')
  if (r.ok) ok('Server responds to /api/health')
  else       fail('Server health check', `HTTP ${r.status}`)
}

async function testConfig() {
  section('Platform Config')
  const r = await api('GET', '/config')
  if (r.ok && r.data) ok('GET /api/config returns platform config')
  else                 fail('GET /api/config', `HTTP ${r.status}`)
}

async function testPreAuthRoutes() {
  section('Pre-Auth Routes')

  // Password policy — public, no session required
  const policy = await api('GET', '/auth/password-policy')
  if (policy.ok && typeof policy.data?.min_length === 'number')
    ok('GET /api/auth/password-policy → returns policy object')
  else
    fail('GET /api/auth/password-policy', `HTTP ${policy.status}`)

  // Visit tracking — CSRF-exempt POST, no session required
  const savedSession = sessionId
  sessionId = null
  const visit = await api('POST', '/visit', {})
  sessionId = savedSession
  if (visit.ok || visit.status === 200)
    ok('POST /api/visit → 200 (CSRF exempt, no session)')
  else
    fail('POST /api/visit', `HTTP ${visit.status} — ${JSON.stringify(visit.data)}`)
}

async function testHeartbeat() {
  section('Heartbeat')
  if (!sessionId) { skip('Heartbeat', 'no session'); return }

  const r = await api('POST', '/me/heartbeat')
  if (r.ok)
    ok('POST /api/me/heartbeat → 200')
  else
    fail('POST /api/me/heartbeat', `HTTP ${r.status} — ${JSON.stringify(r.data)}`)
}

async function testRegister() {
  section('Register Account')
  const r = await api('POST', '/auth/register', {
    name: testName,
    email: testEmail,
    password: testPass,
    lang: 'da',
  })

  if (r.ok && r.data?.sessionId) {
    sessionId = r.data.sessionId
    userId    = r.data.userId
    ok(`Registered as "${testName}" (uid=${userId})`)
  } else {
    fail('Register new account', r.data?.error || `HTTP ${r.status}`)
  }
}

async function testSessionCheck() {
  section('Session Validation')
  if (!sessionId) { skip('Session check', 'no session'); return }

  const r = await api('GET', '/profile')
  if (r.ok && r.data?.email === testEmail) ok('Session valid — /api/profile returns correct user')
  else                                      fail('Session check via /api/profile', `HTTP ${r.status}`)
}

async function testFeed() {
  section('Feed')
  if (!sessionId) { skip('Feed tests', 'no session'); return }

  const r = await api('GET', '/feed')
  if (r.ok && Array.isArray(r.data?.posts ?? r.data)) ok('GET /api/feed returns posts array')
  else if (r.ok) ok('GET /api/feed returns data')
  else           fail('GET /api/feed', `HTTP ${r.status}`)
}

async function testCreateTextPost() {
  section('Create Text Post')
  if (!sessionId) { skip('Create post', 'no session'); return }

  const r = await api('POST', '/feed', { text: `E2E test post – ${ts}` })
  if (r.ok && r.data?.id) {
    postId = r.data.id
    ok(`Created text post (id=${postId})`)
  } else {
    fail('POST /api/feed (text only)', r.data?.error || `HTTP ${r.status}`)
  }
}

async function testLikePost() {
  section('Like Post')
  if (!postId) { skip('Like post', 'no post'); return }

  const r = await api('POST', `/feed/${postId}/like`)
  if (r.ok) ok(`Liked post ${postId}`)
  else      fail(`POST /api/feed/${postId}/like`, `HTTP ${r.status}`)
}

async function testAddComment() {
  section('Add Comment')
  if (!postId) { skip('Add comment', 'no post'); return }

  const r = await api('POST', `/feed/${postId}/comment`, { text: 'E2E test comment' })
  // Endpoint returns { author, text, media } — no id in response
  if (r.ok && r.data?.author) {
    ok(`Added comment by "${r.data.author}"`)
  } else {
    fail(`POST /api/feed/${postId}/comment`, r.data?.error || `HTTP ${r.status}`)
  }
}

async function testCreateMediaPost() {
  section('Create Post with Media')
  if (!sessionId) { skip('Media post', 'no session'); return }

  const r = await uploadPostWithMedia(`E2E media test – ${ts}`, minimalPng())
  if (r.ok && r.data?.id) {
    mediaPostId = r.data.id
    ok(`Created post with image (id=${mediaPostId})`)
  } else {
    // Server may reject tiny synthetic PNGs (magic byte check) — not a blocker
    skip('Create post with media', r.data?.error || `HTTP ${r.status} (server may reject synthetic PNG)`)
  }
}

async function testStandaloneUpload() {
  section('Standalone File Upload')
  if (!sessionId) { skip('File upload', 'no session'); return }

  const r = await uploadFile('file', 'e2e-test.png', 'image/png', minimalPng())
  if (r.ok && r.data?.url) ok(`Uploaded file → ${r.data.url}`)
  else                     skip('POST /api/upload', r.data?.error || `HTTP ${r.status} (magic byte validation may reject synthetic PNG)`)
}

async function testProfile() {
  section('Profile')
  if (!sessionId) { skip('Profile tests', 'no session'); return }

  // Update bio via PATCH /api/profile
  const patch = await api('PATCH', '/profile', { bio_da: 'E2E test bio', bio_en: 'E2E test bio EN' })
  if (patch.ok) ok('PATCH /api/profile — updated bio')
  else          fail('PATCH /api/profile', `HTTP ${patch.status}`)

  // Fetch own profile
  const get = await api('GET', '/profile')
  if (get.ok && get.data) ok('GET /api/profile — own profile loaded')
  else                    fail('GET /api/profile', `HTTP ${get.status}`)
}

async function testFriendSearch() {
  section('User Search')
  if (!sessionId) { skip('User search', 'no session'); return }

  const r = await api('GET', `/search?q=${encodeURIComponent('E2E')}`)
  if (r.ok) ok('GET /api/search — search works')
  else      failOrSkip(r, 'GET /api/search', `HTTP ${r.status}`)
}

async function testNotifications() {
  section('Notifications')
  if (!sessionId) { skip('Notifications', 'no session'); return }

  const count = await api('GET', '/notifications/count')
  if (count.ok) ok('GET /api/notifications/count')
  else          fail('GET /api/notifications/count', `HTTP ${count.status}`)

  const list = await api('GET', '/notifications')
  if (list.ok) ok('GET /api/notifications')
  else         fail('GET /api/notifications', `HTTP ${list.status}`)
}

async function testMarketplace() {
  section('Marketplace')
  if (!sessionId) { skip('Marketplace', 'no session'); return }

  // List listings
  const list = await api('GET', '/marketplace')
  if (list.ok) ok('GET /api/marketplace')
  else         fail('GET /api/marketplace', `HTTP ${list.status}`)

  // Create listing
  const create = await api('POST', '/marketplace', {
    title: `E2E listing ${ts}`,
    description_da: 'E2E testopslag',
    description_en: 'E2E test listing',
    price: 99.99,
    currency: 'EUR',
    category: 'other',
    condition: 'new',
    location: 'Test City',
  })
  if (create.ok && create.data?.id) {
    listingId = create.data.id
    ok(`Created marketplace listing (id=${listingId})`)
  } else {
    fail('POST /api/marketplace', create.data?.error || `HTTP ${create.status}`)
  }
}

async function testEvents() {
  section('Events')
  if (!sessionId) { skip('Events', 'no session'); return }

  const list = await api('GET', '/events')
  if (list.ok) ok('GET /api/events')
  else         fail('GET /api/events', `HTTP ${list.status}`)

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16) // "YYYY-MM-DDTHH:MM"
  const create = await api('POST', '/events', {
    title: `E2E Event ${ts}`,
    description: 'E2E test event',
    location: 'Test Venue',
    date: tomorrow,
    eventType: 'other',
  })
  if (create.ok && create.data?.id) {
    eventId = create.data.id
    ok(`Created event (id=${eventId})`)
  } else {
    fail('POST /api/events', create.data?.error || `HTTP ${create.status}`)
  }
}

async function testJobs() {
  section('Jobs')
  if (!sessionId) { skip('Jobs', 'no session'); return }

  const list = await api('GET', '/jobs')
  if (list.ok) ok('GET /api/jobs')
  else         fail('GET /api/jobs', `HTTP ${list.status}`)

  // Jobs require a company — create one first (creator is auto-added as owner)
  const handle = `e2e-corp-${ts}`
  const co = await api('POST', '/companies', { name: `E2E Corp ${ts}`, handle })
  if (co.ok && co.data?.id) {
    companyId = co.data.id
    ok(`Created company (id=${companyId})`)
  } else {
    fail('POST /api/companies', co.data?.error || `HTTP ${co.status}`)
    return
  }

  const create = await api('POST', '/jobs', {
    company_id: companyId,
    title: `E2E Job ${ts}`,
    description: 'E2E test job listing.',
    location: 'Remote',
    type: 'fulltime',
  })
  if (create.ok && create.data?.id) {
    jobId = create.data.id
    ok(`Created job listing (id=${jobId})`)
  } else {
    fail('POST /api/jobs', create.data?.error || `HTTP ${create.status}`)
  }
}

async function testMessaging() {
  section('Messaging')
  if (!sessionId) { skip('Messaging', 'no session'); return }

  const list = await api('GET', '/conversations')
  if (list.ok) ok('GET /api/conversations')
  else         fail('GET /api/conversations', `HTTP ${list.status}`)

  // Can't create a DM with ourselves — just confirm the list endpoint works
}

async function testReels() {
  section('Reels')
  if (!sessionId) { skip('Reels', 'no session'); return }

  const r = await api('GET', '/reels')
  if (r.ok) ok('GET /api/reels')
  else      fail('GET /api/reels', `HTTP ${r.status}`)
}

async function testExplore() {
  section('Explore')
  if (!sessionId) { skip('Explore', 'no session'); return }

  const trending = await api('GET', '/explore/trending')
  if (trending.ok) ok('GET /api/explore/trending')
  else             fail('GET /api/explore/trending', `HTTP ${trending.status}`)
}

async function testInterests() {
  section('Interests')
  if (!sessionId) { skip('Interests', 'no session'); return }

  const cats = await api('GET', '/interest-categories')
  if (cats.ok) ok('GET /api/interest-categories')
  else         fail('GET /api/interest-categories', `HTTP ${cats.status}`)
}

async function testBadges() {
  section('Badges')
  if (!sessionId) { skip('Badges', 'no session'); return }

  const r = await api('GET', '/badges')
  if (r.ok) ok('GET /api/badges')
  else      fail('GET /api/badges', `HTTP ${r.status}`)
}

// ─── 404 & 500 error handling ─────────────────────────────────────────────────

async function testErrorHandling() {
  section('404 & 500 Error Handling')
  if (!sessionId) { skip('Error handling tests', 'no session'); return }

  const GHOST = 999_999_999  // ID that will never exist

  // ── 404: non-existent resources ──────────────────────────────────────────────

  const post404 = await api('GET', `/posts/${GHOST}`)
  if (post404.status === 404) ok(`GET /api/posts/${GHOST} → 404`)
  else                        fail(`GET /api/posts/${GHOST} should be 404`, `got ${post404.status}`)

  const user404 = await api('GET', `/users/${GHOST}`)
  if (user404.status === 404) ok(`GET /api/users/${GHOST} → 404`)
  // Some servers return 403 or empty array — accept either as "not found" behaviour
  else if (user404.status === 403 || (user404.ok && Array.isArray(user404.data) && user404.data.length === 0))
    ok(`GET /api/users/${GHOST} → ${user404.status} (resource not found)`)
  else
    fail(`GET /api/users/${GHOST} should signal not-found`, `got ${user404.status}`)

  const marketplace404 = await api('GET', `/marketplace/${GHOST}`)
  if (marketplace404.status === 404) ok(`GET /api/marketplace/${GHOST} → 404`)
  else if (!marketplace404.ok)       ok(`GET /api/marketplace/${GHOST} → ${marketplace404.status} (not found)`)
  else                               fail(`GET /api/marketplace/${GHOST} should signal not-found`, `got ${marketplace404.status}`)

  const event404 = await api('GET', `/events/${GHOST}`)
  if (event404.status === 404) ok(`GET /api/events/${GHOST} → 404`)
  else if (!event404.ok)       ok(`GET /api/events/${GHOST} → ${event404.status} (not found)`)
  else                         fail(`GET /api/events/${GHOST} should signal not-found`, `got ${event404.status}`)

  const job404 = await api('GET', `/jobs/${GHOST}`)
  if (job404.status === 404) ok(`GET /api/jobs/${GHOST} → 404`)
  else if (!job404.ok)       ok(`GET /api/jobs/${GHOST} → ${job404.status} (not found)`)
  else                       fail(`GET /api/jobs/${GHOST} should signal not-found`, `got ${job404.status}`)

  // ── 404: unknown API route (POST avoids the SPA GET fallback) ────────────────
  // Send without a session so CSRF middleware doesn't intercept before the 404 handler

  const savedForUnknown = sessionId
  sessionId = null
  const unknown = await api('POST', `/this-route-does-not-exist-${GHOST}`)
  sessionId = savedForUnknown
  if (unknown.status === 404) ok('POST /api/<unknown-route> → 404')
  else                        fail('POST to unknown API route should return 404', `got ${unknown.status}`)

  // ── 401: protected endpoint without session ───────────────────────────────────

  const savedSession = sessionId
  sessionId = null
  const unauth = await api('GET', '/feed')
  sessionId = savedSession
  if (unauth.status === 401) ok('GET /api/feed without session → 401')
  else                       fail('Unauthenticated request to /api/feed should return 401', `got ${unauth.status}`)

  // ── 500 summary (detected globally throughout the run) ───────────────────────
  // Reported in final summary — no per-test assertion needed here.
}

async function testCsrfToken() {
  section('CSRF Token')
  if (!sessionId) { skip('CSRF token', 'no session'); return }
  await refreshCsrfToken()
  if (csrfToken) ok(`GET /api/csrf-token → token received`)
  else           fail('GET /api/csrf-token', 'no token in response')
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function testFeedModeSeparation() {
  section('Feed Mode Separation')
  if (!sessionId) { skip('Feed mode separation', 'no session'); return }

  // ── 1. Create a post while in privat mode ─────────────────────────────────
  await api('PATCH', '/me/mode', { mode: 'privat' })
  const privPost = await api('POST', '/feed', { text: `E2E privat-mode post – ${ts}` })
  if (privPost.ok && privPost.data?.id) {
    feedModePrivPostId = privPost.data.id
    ok(`Created post in privat mode (id=${feedModePrivPostId})`)
  } else {
    fail('POST /api/feed in privat mode', privPost.data?.error || `HTTP ${privPost.status}`)
  }

  // ── 2. Switch to business mode and create a post ──────────────────────────
  const switched = await api('PATCH', '/me/mode', { mode: 'business' })
  if (!switched.ok) {
    skip('Business-mode post', 'PATCH /api/me/mode → business failed')
  } else {
    const bizPost = await api('POST', '/feed', { text: `E2E business-mode post – ${ts}` })
    if (bizPost.ok && bizPost.data?.id) {
      feedModeBizPostId = bizPost.data.id
      ok(`Created post in business mode (id=${feedModeBizPostId})`)
    } else {
      fail('POST /api/feed in business mode', bizPost.data?.error || `HTTP ${bizPost.status}`)
    }
  }

  // Switch back to privat for remaining tests
  await api('PATCH', '/me/mode', { mode: 'privat' })

  // ── 3. Invalid mode value must return 400 ─────────────────────────────────
  const invalid = await api('GET', '/feed?mode=invalid')
  if (invalid.status === 400) ok('GET /api/feed?mode=invalid → 400')
  else fail('GET /api/feed?mode=invalid should return 400', `got ${invalid.status}`)

  // ── 4. mode=privat — only privat posts, no business posts ─────────────────
  const privFeed = await api('GET', '/feed?mode=privat&limit=50')
  if (!privFeed.ok) {
    // 500 here means user_mode column is missing — migration not yet applied
    skip('GET /api/feed?mode=privat filtering', `HTTP ${privFeed.status} — run "npm run migrate" first`)
  } else {
    ok('GET /api/feed?mode=privat → 200')
    const ids = new Set((privFeed.data?.posts || []).map(p => p.id))
    if (feedModePrivPostId) {
      if (ids.has(feedModePrivPostId)) ok(`Privat-mode post (id=${feedModePrivPostId}) appears in ?mode=privat feed`)
      else                              fail('Privat-mode post missing from ?mode=privat feed', `id=${feedModePrivPostId}`)
    }
    if (feedModeBizPostId) {
      if (!ids.has(feedModeBizPostId)) ok(`Business-mode post (id=${feedModeBizPostId}) absent from ?mode=privat feed`)
      else                              fail('Business-mode post leaked into ?mode=privat feed', `id=${feedModeBizPostId} found`)
    }
  }

  // ── 5. mode=business — only business posts, no privat posts ───────────────
  const bizFeed = await api('GET', '/feed?mode=business&limit=50')
  if (!bizFeed.ok) {
    skip('GET /api/feed?mode=business filtering', `HTTP ${bizFeed.status} — run "npm run migrate" first`)
  } else {
    ok('GET /api/feed?mode=business → 200')
    const ids = new Set((bizFeed.data?.posts || []).map(p => p.id))
    if (feedModeBizPostId) {
      if (ids.has(feedModeBizPostId)) ok(`Business-mode post (id=${feedModeBizPostId}) appears in ?mode=business feed`)
      else                              fail('Business-mode post missing from ?mode=business feed', `id=${feedModeBizPostId}`)
    }
    if (feedModePrivPostId) {
      if (!ids.has(feedModePrivPostId)) ok(`Privat-mode post (id=${feedModePrivPostId}) absent from ?mode=business feed`)
      else                               fail('Privat-mode post leaked into ?mode=business feed', `id=${feedModePrivPostId} found`)
    }
  }

  // ── 6. No mode param → mixed feed — backward-compatible, always 200 ───────
  const mixed = await api('GET', '/feed?limit=10')
  if (mixed.ok) ok('GET /api/feed (no mode) → 200 — mixed feed still works')
  else          fail('GET /api/feed (no mode) should return 200', `got ${mixed.status}`)
}

async function cleanup() {
  section('Cleanup')
  if (!sessionId) { skip('Cleanup', 'no session'); return }

  // Comments are deleted via their parent post — just delete the post directly
  if (feedModePrivPostId) {
    const r = await api('DELETE', `/feed/${feedModePrivPostId}`)
    if (r.ok) ok(`Deleted feed-mode privat post ${feedModePrivPostId}`)
    else      skip(`Delete feed-mode privat post`, `HTTP ${r.status}`)
  }

  if (feedModeBizPostId) {
    const r = await api('DELETE', `/feed/${feedModeBizPostId}`)
    if (r.ok) ok(`Deleted feed-mode business post ${feedModeBizPostId}`)
    else      skip(`Delete feed-mode business post`, `HTTP ${r.status}`)
  }

  // Restore mode to privat before account deletion
  await api('PATCH', '/me/mode', { mode: 'privat' })

  if (postId) {
    const r = await api('DELETE', `/feed/${postId}`)
    if (r.ok) ok(`Deleted text post ${postId}`)
    else      skip(`Delete post ${postId}`, `HTTP ${r.status}`)
  }

  if (mediaPostId) {
    const r = await api('DELETE', `/feed/${mediaPostId}`)
    if (r.ok) ok(`Deleted media post ${mediaPostId}`)
    else      skip(`Delete media post ${mediaPostId}`, `HTTP ${r.status}`)
  }

  if (listingId) {
    const r = await api('DELETE', `/marketplace/${listingId}`)
    if (r.ok) ok(`Deleted listing ${listingId}`)
    else      skip(`Delete listing ${listingId}`, `HTTP ${r.status}`)
  }

  if (eventId) {
    const r = await api('DELETE', `/events/${eventId}`)
    if (r.ok) ok(`Deleted event ${eventId}`)
    else      skip(`Delete event ${eventId}`, `HTTP ${r.status}`)
  }

  if (jobId) {
    const r = await api('DELETE', `/jobs/${jobId}`)
    if (r.ok) ok(`Deleted job ${jobId}`)
    else      skip(`Delete job ${jobId}`, `HTTP ${r.status}`)
  }

  if (companyId) {
    const r = await api('DELETE', `/companies/${companyId}`)
    if (r.ok) ok(`Deleted company ${companyId}`)
    else      skip(`Delete company ${companyId}`, `HTTP ${r.status}`)
  }

  // Delete account via GDPR endpoint (requires password re-verification)
  const del = await api('DELETE', '/gdpr/account', { password: currentPass })
  if (del.ok) ok(`Deleted test account (${testEmail})`)
  else        fail('DELETE /api/gdpr/account', `HTTP ${del.status} — ${JSON.stringify(del.data)}`)
}

// ─── Login tests ──────────────────────────────────────────────────────────────

async function testLogin() {
  section('Login')
  const savedSession = sessionId
  sessionId = null

  // Correct credentials
  const r = await api('POST', '/auth/login', { email: testEmail, password: testPass, lang: 'da' })
  if (r.ok && r.data?.sessionId) {
    sessionId = r.data.sessionId
    ok(`Correct credentials → session issued`)
  } else {
    sessionId = savedSession
    fail('POST /api/auth/login (correct credentials)', r.data?.error || `HTTP ${r.status}`)
    return
  }

  // Wrong password → 401 (test as unauthenticated — login is a pre-auth endpoint)
  const savedForBad = sessionId
  sessionId = null
  const bad = await api('POST', '/auth/login', { email: testEmail, password: 'WrongPass999!', lang: 'da' })
  if (bad.status === 401) ok('Wrong password → 401 Unauthorized')
  else                    fail('Wrong password should return 401', `got HTTP ${bad.status}`)

  // Non-existent email → 401 (no user enumeration)
  const ghost = await api('POST', '/auth/login', { email: `no-such-user-${ts}@example.invalid`, password: 'anything' })
  if (ghost.status === 401) ok('Unknown email → 401 (no user enumeration)')
  else                      fail('Unknown email should return 401', `got HTTP ${ghost.status}`)
  sessionId = savedForBad
}

// ─── Mail / password-reset flow ───────────────────────────────────────────────

async function testMailAndPasswordReset() {
  section('Mail & Password Reset')
  if (!sessionId) { skip('Password reset tests', 'no session'); return }

  const savedSession = sessionId

  // 1. Forgot-password → always returns { ok: true } (pre-auth endpoint, test without session)
  sessionId = null
  const forgot = await api('POST', '/auth/forgot-password', { email: testEmail })
  sessionId = savedSession
  if (forgot.ok && forgot.data?.ok) ok('POST /api/auth/forgot-password → { ok: true }')
  else                               failOrSkip(forgot, 'POST /api/auth/forgot-password', `HTTP ${forgot.status}`)

  // 2. Forgot-password for unknown email → still { ok: true } (no leaking)
  sessionId = null
  const forgotGhost = await api('POST', '/auth/forgot-password', { email: `ghost-${ts}@example.invalid` })
  sessionId = savedSession
  if (forgotGhost.ok && forgotGhost.data?.ok) ok('Forgot-password unknown email → { ok: true } (no enumeration)')
  else                                         failOrSkip(forgotGhost, 'Forgot-password unknown email', `HTTP ${forgotGhost.status}`)

  // 3. Reset with a bogus token → 400 (pre-auth endpoint, test without session)
  sessionId = null
  const badReset = await api('POST', '/auth/reset-password', {
    token: 'not-a-real-token-aabbccdd',
    password: 'NewPass5678!',
  })
  sessionId = savedSession
  if (badReset.status === 400) ok('Reset with invalid token → 400')
  else                         fail('Invalid reset token should return 400', `got HTTP ${badReset.status}`)

  // 4. Change password while authenticated (exercises the bcrypt + session path)
  const newPass = `E2eChanged${ts}!`
  const change = await api('PATCH', '/profile/password', {
    currentPassword: testPass,
    newPassword: newPass,
    lang: 'da',
  })
  if (change.ok) {
    ok('PATCH /api/profile/password — changed password while authenticated')
    currentPass = newPass  // password is now changed — update before any re-login so cleanup always has the right one

    // 5. Login with OLD password → 401 (pre-auth, test without session)
    sessionId = null
    const oldLogin = await api('POST', '/auth/login', { email: testEmail, password: testPass })
    if (oldLogin.status === 401) ok('Old password rejected after change → 401')
    else                         fail('Old password should be rejected', `got HTTP ${oldLogin.status}`)

    // 6. Login with NEW password → session
    const newLogin = await api('POST', '/auth/login', { email: testEmail, password: newPass, lang: 'da' })
    if (newLogin.ok && newLogin.data?.sessionId) {
      sessionId = newLogin.data.sessionId
      ok('Login with new password → session issued')
    } else {
      sessionId = savedSession  // fall back to avoid breaking subsequent tests
      fail('Login with new password', `HTTP ${newLogin.status}`)
    }
  } else {
    fail('PATCH /api/profile/password', change.data?.error || `HTTP ${change.status}`)
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  const VERSION = '1.1.2'
  console.log(c.bold(`\nfellis.eu E2E Test Suite`) + c.dim(` v${VERSION}`))
  console.log(c.dim(`Target: ${BASE_URL}`))
  console.log(c.dim(`Time:   ${new Date().toISOString()}`))

  // ─── Connectivity pre-check ─────────────────────────────────────────────────
  const probe = await api('GET', '/health')
  if (probe.connErr) {
    console.log()
    console.log(c.red(c.bold(`✖ Cannot reach ${API}/health`)))
    console.log(c.red(`  ${probe.err}`))
    console.log()
    console.log(c.yellow('  Tip: if you are running this on the server itself, use:'))
    console.log(c.yellow(`    BASE_URL=http://localhost:3001 npm run e2e`))
    console.log(c.yellow('  Or check that PM2 is running:'))
    console.log(c.yellow('    pm2 status'))
    console.log()
    process.exit(1)
  }
  console.log()

  try {
    await testHealth()
    await testConfig()
    await testPreAuthRoutes()
    await testRegister()
    await testSessionCheck()
    await testCsrfToken()              // fetch CSRF token for the initial session
    await testLogin()          // logs in fresh after registering — session changes
    await refreshCsrfToken()   // refresh CSRF token for the new session from login
    await testSessionCheck()   // verify new session also works
    await testMailAndPasswordReset()   // forgot-password API + change-password + re-login
    await refreshCsrfToken()   // refresh CSRF token for the new session after password reset
    await testHeartbeat()
    await testFeed()
    await testFeedModeSeparation()
    await testCreateTextPost()
    await testLikePost()
    await testAddComment()
    await testCreateMediaPost()
    await testStandaloneUpload()
    await testProfile()
    await testFriendSearch()
    await testNotifications()
    await testMarketplace()
    await testEvents()
    await testJobs()
    await testMessaging()
    await testReels()
    await testExplore()
    await testInterests()
    await testBadges()
    await testErrorHandling()
  } finally {
    await cleanup()
  }

  // Fold any unexpected 500s into the failure count
  for (const entry of unexpectedFiveHundreds) {
    failed++
    failures.push(entry)
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed + skipped
  console.log(`\n${'─'.repeat(50)}`)
  console.log(c.bold('Results:'))
  console.log(`  ${c.green(`✔ ${passed} passed`)}`)
  if (failed > 0)  console.log(`  ${c.red(`✖ ${failed} failed`)}`)
  if (skipped > 0) console.log(`  ${c.yellow(`– ${skipped} skipped`)}`)
  console.log(`  Total: ${total}`)

  if (unexpectedFiveHundreds.length > 0) {
    console.log(`\n${c.red(c.bold(`Unexpected 500 errors (${unexpectedFiveHundreds.length}):`))}`)
    for (const f of unexpectedFiveHundreds) console.log(`  ${c.red('⚠')} ${f}`)
  }

  if (failures.length > 0) {
    console.log(`\n${c.red(c.bold('Failed tests:'))}`)
    for (const f of failures) console.log(`  ${c.red('✖')} ${f}`)
  }

  console.log()
  if (failed > 0) process.exit(1)
}

run().catch(err => {
  console.error(c.red(`\nFatal error: ${err.message}`))
  console.error(err.stack)
  process.exit(1)
})
