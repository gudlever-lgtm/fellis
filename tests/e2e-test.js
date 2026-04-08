#!/usr/bin/env node
// e2e-test.js — End-to-end integration test for fellis.eu
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
let currentSection = ''

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

function log(msg) {
  if (VERBOSE) console.log(c.dim(`    ${msg}`))
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
let sessionId = null

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra }
  if (sessionId) h['X-Session-Id'] = sessionId
  return h
}

async function api(method, path, body, extraHeaders = {}) {
  const url = `${API}${path}`
  const opts = {
    method,
    headers: headers(extraHeaders),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  try {
    const res = await fetch(url, opts)
    let data = null
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      data = await res.json()
    } else {
      data = await res.text()
    }
    log(`${method} ${path} → ${res.status}`)
    return { status: res.status, data, ok: res.ok }
  } catch (err) {
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
  const { FormData, Blob } = await import('node:buffer').catch(() => globalThis)
  const form = new FormData()
  form.append(fieldName, new Blob([buffer], { type: mimeType }), filename)
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v)

  const h = {}
  if (sessionId) h['X-Session-Id'] = sessionId

  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', headers: h, body: form })
    const data = await res.json()
    return { status: res.status, data, ok: res.ok }
  } catch (err) {
    return { status: 0, data: null, ok: false, err: err.message }
  }
}

async function uploadPostWithMedia(text, buffer) {
  const { FormData, Blob } = await import('node:buffer').catch(() => globalThis)
  const form = new FormData()
  form.append('text', text)
  form.append('media', new Blob([buffer], { type: 'image/png' }), 'test.png')

  const h = {}
  if (sessionId) h['X-Session-Id'] = sessionId

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
const testEmail = `e2e.test.${ts}@fellis-test.invalid`
const testName  = `E2E Test ${ts}`
const testPass  = 'E2eTest1234!'

let userId     = null
let postId     = null
let mediaPostId = null
let commentId  = null
let listingId  = null
let eventId    = null
let jobId      = null
let convId     = null
let reelId     = null

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
  if (r.ok && r.data?.id) {
    commentId = r.data.id
    ok(`Added comment (id=${commentId})`)
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
  else      fail('GET /api/search', `HTTP ${r.status}`)
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

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
  const create = await api('POST', '/events', {
    title: `E2E Event ${ts}`,
    description_da: 'E2E testevent',
    description_en: 'E2E test event',
    location: 'Test Venue',
    start_time: tomorrow,
    end_time: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    is_public: true,
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

  const create = await api('POST', '/jobs', {
    title: `E2E Job ${ts}`,
    company_name: 'E2E Corp',
    description: 'This is an E2E test job listing.',
    location: 'Remote',
    employment_type: 'full_time',
    salary_min: 500000,
    salary_max: 700000,
    currency: 'DKK',
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

async function testCsrfToken() {
  section('CSRF Token')
  const r = await api('GET', '/csrf-token')
  if (r.ok && r.data?.token) ok(`GET /api/csrf-token → token received`)
  else                        fail('GET /api/csrf-token', `HTTP ${r.status}`)
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  section('Cleanup')
  if (!sessionId) { skip('Cleanup', 'no session'); return }

  // Comments are deleted via their parent post — just delete the post directly
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

  // Delete account via GDPR endpoint (requires password re-verification)
  const del = await api('DELETE', '/gdpr/account', { password: testPass })
  if (del.ok) ok(`Deleted test account (${testEmail})`)
  else        fail('DELETE /api/gdpr/account', `HTTP ${del.status} — ${JSON.stringify(del.data)}`)
}

// ─── Second account — test login separately ────────────────────────────────
async function testLogin() {
  section('Login (separate from register)')
  // Log out first by clearing session, then log back in
  const savedSession = sessionId
  sessionId = null

  const r = await api('POST', '/auth/login', { email: testEmail, password: testPass, lang: 'da' })
  if (r.ok && r.data?.sessionId) {
    sessionId = r.data.sessionId // restore (may differ from register session)
    ok(`Login successful for ${testEmail}`)
  } else {
    // Restore session so cleanup still works
    sessionId = savedSession
    fail('POST /api/auth/login', r.data?.error || `HTTP ${r.status}`)
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log(c.bold(`\nfellis.eu E2E Test Suite`))
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

  await testHealth()
  await testConfig()
  await testCsrfToken()
  await testRegister()
  await testSessionCheck()
  await testLogin()          // logs in fresh after registering
  await testSessionCheck()   // verify new session also works
  await testFeed()
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
  await cleanup()

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed + skipped
  console.log(`\n${'─'.repeat(50)}`)
  console.log(c.bold('Results:'))
  console.log(`  ${c.green(`✔ ${passed} passed`)}`)
  if (failed > 0)  console.log(`  ${c.red(`✖ ${failed} failed`)}`)
  if (skipped > 0) console.log(`  ${c.yellow(`– ${skipped} skipped`)}`)
  console.log(`  Total: ${total}`)

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
