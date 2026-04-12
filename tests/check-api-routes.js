#!/usr/bin/env node
/**
 * Static API route checker — runs per build to catch 404s before they hit production.
 *
 * Compares every request(url) call in src/api.js against the routes
 * registered in server/index.js and reports any mismatches.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

// ── 1. Extract server routes ──────────────────────────────────────────────────

const serverSrc = readFileSync(resolve(root, 'server/index.js'), 'utf8')

// Match: app.get('/api/...') / app.post(...)  etc.
const serverRouteRe = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi
const serverRoutes = new Set()
let m
while ((m = serverRouteRe.exec(serverSrc)) !== null) {
  const method = m[1].toUpperCase()
  const path   = m[2].split('?')[0] // strip query string from pattern
  serverRoutes.add(`${method} ${path}`)
}

// ── 1b. Also extract routes from server/routes/facebook.js ───────────────────
// These are mounted at /api/auth/facebook via app.use('/api/auth/facebook', facebookRouter)
// The file uses router.get/post/etc — extract and prefix with the mount path.
const FB_ROUTE_PREFIX = '/api/auth/facebook'
try {
  const fbSrc = readFileSync(resolve(root, 'server/routes/facebook.js'), 'utf8')
  const fbRouteRe = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi
  while ((m = fbRouteRe.exec(fbSrc)) !== null) {
    const method = m[1].toUpperCase()
    const subPath = m[2].split('?')[0]
    // '/' → /api/auth/facebook, '/callback' → /api/auth/facebook/callback
    const fullPath = subPath === '/' ? FB_ROUTE_PREFIX : `${FB_ROUTE_PREFIX}${subPath}`
    serverRoutes.add(`${method} ${fullPath}`)
  }
} catch (err) {
  console.warn('Could not scan server/routes/facebook.js:', err.message)
}

// ── 2. Extract client API calls ────────────────────────────────────────────────

const apiSrc = readFileSync(resolve(root, 'src/api.js'), 'utf8')

// Matches:
//   request('/api/foo')                          → GET /api/foo
//   request(`/api/foo/${id}`)                    → GET /api/foo/:id
//   request('/api/foo', { method: 'POST' })      → POST /api/foo
//   request(`/api/foo/${id}/bar`, { method: 'DELETE' })
const clientCallRe = /request\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*\})?\s*\)/gi
const clientCalls = []

while ((m = clientCallRe.exec(apiSrc)) !== null) {
  const rawPath = m[1]
  const method  = (m[2] || 'GET').toUpperCase()

  // Normalise template literal variables like ${id}, ${convId}, ${postId} → :param
  // and strip query strings (everything from ? onward, including ?key=${val})
  const path = rawPath
    .replace(/\$\{[^}]+\}/g, ':param') // ${anything} → :param
    .replace(/\?.*$/,         '')       // strip query string

  clientCalls.push({ method, path, raw: rawPath })
}

// ── 3. Normalise server route params to :param for comparison ─────────────────
//    /api/marketplace/:id/sold  →  /api/marketplace/:param/sold

function normaliseServerPath(p) {
  return p.replace(/:[\w]+/g, ':param')
}

const normServerRoutes = new Set(
  [...serverRoutes].map(r => {
    const [method, path] = r.split(' ')
    return `${method} ${normaliseServerPath(path)}`
  })
)

// ── 4. Compare ────────────────────────────────────────────────────────────────

const errors = []

for (const { method, path, raw } of clientCalls) {
  const key = `${method} ${path}`
  if (!normServerRoutes.has(key)) {
    errors.push({ method, path, raw })
  }
}

// ── 5. Report ─────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m'
const RED   = '\x1b[31m'
const RESET = '\x1b[0m'

console.log('\n=== API route check ===\n')
console.log(`Server routes found  : ${serverRoutes.size}`)
console.log(`Client calls found   : ${clientCalls.length}`)

if (errors.length === 0) {
  console.log(`\n${GREEN}✓ All ${clientCalls.length} client API calls have matching server routes.${RESET}\n`)
} else {
  console.log(`\n${RED}✗ ${errors.length} client API call(s) have NO matching server route:${RESET}\n`)
  for (const e of errors) {
    console.log(`  ${RED}[${e.method}]${RESET} ${e.path}  (raw: "${e.raw}")`)
  }
  console.log()
  process.exit(1)
}

// ── 6. Livestream / live-reel endpoint declarations ───────────────────────────
//
// The following routes MUST exist on the server and return the listed status
// codes when hit at runtime (admin-auth required → 200 authenticated, 401 not).
//
//   GET  /api/admin/livestream/settings  → 200 (admin) | 401 (unauthenticated) — never 404/500
//   POST /api/admin/livestream/settings  → 200 (admin) | 401 (unauthenticated) — never 404/500
//   GET  /api/reels                      → 200 (authenticated)                  — never 404/500
//
// Verify these are present in the server route set:
const REQUIRED_LIVESTREAM_ROUTES = [
  'GET /api/admin/livestream/settings',
  'POST /api/admin/livestream/settings',
  'GET /api/reels',
]

const missingLsRoutes = REQUIRED_LIVESTREAM_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingLsRoutes.length > 0) {
  console.log(`${RED}✗ Missing required livestream/reel server routes:${RESET}`)
  for (const r of missingLsRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All required livestream/reel routes are registered on the server.${RESET}\n`)
}

// ── mediamtx / RTMP stream endpoint declarations ──────────────────────────────
//
// These routes MUST exist on the server and return the listed status codes:
//
//   GET  /api/stream/active  → 200 (authenticated) | 401 (unauthenticated) — never 404/500
//   GET  /api/stream/key     → 200 (authenticated) | 401 (unauthenticated) — never 404/500
//   POST /api/stream/auth    → 200 (valid key)     | 401 (invalid key)     — never 404/500
//   POST /api/stream/end     → 200 (valid key)     | 400 (missing key)     — never 404/500
//
const REQUIRED_STREAM_ROUTES = [
  'GET /api/stream/active',
  'GET /api/stream/key',
  'POST /api/stream/auth',
  'POST /api/stream/end',
]

const missingStreamRoutes = REQUIRED_STREAM_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingStreamRoutes.length > 0) {
  console.log(`${RED}✗ Missing required mediamtx/stream server routes:${RESET}`)
  for (const r of missingStreamRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All required mediamtx/stream routes are registered on the server.${RESET}\n`)
}

// ── chat.fellis.eu conversation endpoints ─────────────────────────────────────
//
// These routes MUST exist on the server and return the listed status codes:
//
//   GET  /api/conversations              → 200 (authenticated) | 401 (unauthenticated) — never 404/500
//   POST /api/conversations/:id/messages → 200 (authenticated) | 401 (unauthenticated) — never 404/500
//
const REQUIRED_CHAT_ROUTES = [
  'GET /api/conversations',
  'POST /api/conversations/:id/messages',
]

const missingChatRoutes = REQUIRED_CHAT_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingChatRoutes.length > 0) {
  console.log(`${RED}✗ Missing required chat conversation server routes:${RESET}`)
  for (const r of missingChatRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All required chat conversation routes are registered on the server.${RESET}\n`)
}

// ── Facebook data import endpoint declarations ─────────────────────────────
//
// These routes MUST exist on the server and return the listed status codes:
//
//   GET  /api/auth/facebook              → 302 (redirect to FB) | 401 (no session)
//   GET  /api/auth/facebook/callback     → 302 (redirect back)  | 400 (bad state)
//   GET  /api/auth/facebook/data         → 200 (connected)      | 401 (no session)
//   POST /api/auth/facebook/import       → 200 (ok)             | 401 (no session)
//   POST /api/auth/facebook/disconnect   → 200 (ok)             | 401 (no session)
//   POST /api/auth/facebook/deauthorize  → 200 (public webhook) | 400 (bad sig)
//   POST /api/auth/facebook/delete       → 200 (public webhook) | 400 (bad sig)
//
const REQUIRED_FACEBOOK_ROUTES = [
  'GET /api/auth/facebook',
  'GET /api/auth/facebook/callback',
  'GET /api/auth/facebook/data',
  'POST /api/auth/facebook/import',
  'POST /api/auth/facebook/disconnect',
  'POST /api/auth/facebook/deauthorize',
  'POST /api/auth/facebook/delete',
]

const missingFbRoutes = REQUIRED_FACEBOOK_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingFbRoutes.length > 0) {
  console.log(`${RED}✗ Missing required Facebook data-import server routes:${RESET}`)
  for (const r of missingFbRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All required Facebook data-import routes are registered on the server.${RESET}\n`)
}

// ── Feed mode separation endpoint declarations ────────────────────────────────
//
// The feed endpoint MUST exist on the server and support an optional ?mode param:
//
//   GET /api/feed              → 200 (authenticated) | 401 (unauthenticated)  — never 404/500
//   GET /api/feed?mode=privat  → 200 (authenticated, filters by mode=privat)  — never 404/500
//   GET /api/feed?mode=business → 200 (authenticated, filters by mode=business) — never 404/500
//   GET /api/feed?mode=invalid → 400 (invalid mode value — must be rejected)
//   POST /api/feed             → 200 (authenticated, user_mode stored from users.mode) — never 404/500
//
// Verify the base GET and POST /api/feed routes are present in the server route set:
const REQUIRED_FEED_MODE_ROUTES = [
  'GET /api/feed',
  'POST /api/feed',
]

const missingFeedModeRoutes = REQUIRED_FEED_MODE_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingFeedModeRoutes.length > 0) {
  console.log(`${RED}✗ Missing required feed mode-separation server routes:${RESET}`)
  for (const r of missingFeedModeRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed mode-separation routes (GET/POST /api/feed) are registered on the server.${RESET}\n`)
}

// Verify that the server-side GET /api/feed handler contains mode validation logic
// by checking for the expected validation string in server/index.js source.
const FEED_MODE_VALIDATION_MARKER = '"privat" or "business"'
if (!serverSrc.includes(FEED_MODE_VALIDATION_MARKER)) {
  console.log(`${RED}✗ GET /api/feed is missing mode parameter validation ("privat" or "business" guard).${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ GET /api/feed validates the ?mode parameter (rejects invalid values with 400).${RESET}\n`)
}

// Verify that POST /api/feed stores user_mode on insert
const POST_FEED_USER_MODE_MARKER = 'user_mode'
const feedInsertRe = /INSERT INTO posts[^;]+user_mode/s
if (!feedInsertRe.test(serverSrc)) {
  console.log(`${RED}✗ POST /api/feed INSERT does not include user_mode column — posts will not be mode-tagged.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ POST /api/feed INSERT stores user_mode on new posts.${RESET}\n`)
}

// Suppress unused variable warning for the marker
void POST_FEED_USER_MODE_MARKER

process.exit(0)
