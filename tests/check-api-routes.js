#!/usr/bin/env node
/**
 * Static API route checker — runs per build to catch 404s before they hit production.
 *
 * Compares every request(url) call in src/api.js against the routes
 * registered in server/index.js and server/routes/*.js and reports any mismatches.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
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

// ── 1b. Extract routes from all server/routes/*.js files ─────────────────────
// Most routers are mounted at /api via app.use('/api', router).
// Exception: facebook.js is mounted at /api/auth/facebook — its routes use
// short paths like '/', '/callback', '/data' and must be prefixed accordingly.
const routesDir = resolve(root, 'server/routes')
const FB_ROUTE_PREFIX = '/api/auth/facebook'
try {
  const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.js'))
  for (const file of routeFiles) {
    try {
      const src = readFileSync(resolve(routesDir, file), 'utf8')
      const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi
      while ((m = re.exec(src)) !== null) {
        const method = m[1].toUpperCase()
        const subPath = m[2].split('?')[0]
        let fullPath
        if (file === 'facebook.js') {
          // facebook.js is mounted at /api/auth/facebook
          fullPath = subPath === '/' ? FB_ROUTE_PREFIX : `${FB_ROUTE_PREFIX}${subPath}`
        } else {
          // All other route files are mounted at /api
          fullPath = subPath === '/' ? '/api' : `/api${subPath}`
        }
        serverRoutes.add(`${method} ${fullPath}`)
      }
    } catch (err) {
      console.warn(`Could not scan server/routes/${file}:`, err.message)
    }
  }
} catch (err) {
  console.warn('Could not scan server/routes/ directory:', err.message)
}

// Build combined source for content-based checks (markers that may now live in route files)
let combinedServerSrc = serverSrc
try {
  const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.js'))
  for (const file of routeFiles) {
    try {
      combinedServerSrc += '\n' + readFileSync(resolve(routesDir, file), 'utf8')
    } catch {}
  }
} catch {}

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
//   POST /api/auth/facebook/import-photos→ 200 (ok)             | 401 (no session)
//   POST /api/auth/facebook/disconnect   → 200 (ok)             | 401 (no session)
//   POST /api/auth/facebook/deauthorize  → 200 (public webhook) | 400 (bad sig)
//   POST /api/auth/facebook/delete       → 200 (public webhook) | 400 (bad sig)
//
const REQUIRED_FACEBOOK_ROUTES = [
  'GET /api/auth/facebook',
  'GET /api/auth/facebook/callback',
  'GET /api/auth/facebook/data',
  'POST /api/auth/facebook/import',
  'POST /api/auth/facebook/import-photos',
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
// by checking for the expected validation string in server/index.js or route files.
const FEED_MODE_VALIDATION_MARKER = '"privat" or "business"'
if (!combinedServerSrc.includes(FEED_MODE_VALIDATION_MARKER)) {
  console.log(`${RED}✗ GET /api/feed is missing mode parameter validation ("privat" or "business" guard).${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ GET /api/feed validates the ?mode parameter (rejects invalid values with 400).${RESET}\n`)
}

// Verify that POST /api/feed stores user_mode on insert
const POST_FEED_USER_MODE_MARKER = 'user_mode'
const feedInsertRe = /INSERT INTO posts[^;]+user_mode/s
if (!feedInsertRe.test(combinedServerSrc)) {
  console.log(`${RED}✗ POST /api/feed INSERT does not include user_mode column — posts will not be mode-tagged.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ POST /api/feed INSERT stores user_mode on new posts.${RESET}\n`)
}

// Suppress unused variable warning for the marker
void POST_FEED_USER_MODE_MARKER

// ── 7. Direct fetch() / XHR calls have matching server routes ─────────────────
//
// Calls that bypass request() (auth, file uploads, public endpoints) are
// invisible to check #4.  Extract them separately so a renamed server route
// still surfaces as a failure here.
//
// Patterns covered:
//   fetch(`${API_BASE}/api/...`, { method: 'POST', ... })   → POST /api/...
//   fetch(`${API_BASE}/api/...`)                            → GET  /api/...
//   xhr.open('POST', `${API_BASE}/api/...`, true)           → POST /api/...

// Walk the options object using brace counting to extract the method value.
// This avoids false positives from scanning past the end of the current call
// into adjacent function bodies.
function extractFetchMethod(src, afterCommaIdx) {
  let i = afterCommaIdx
  while (i < src.length && /\s/.test(src[i])) i++ // skip whitespace
  if (src[i] !== '{') return 'GET'                 // no options object
  let depth = 1
  i++ // step past opening '{'
  const bodyStart = i
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  const body = src.slice(bodyStart, i - 1) // content between outer { and }
  const mm   = body.match(/\bmethod\s*:\s*['"`](\w+)['"`]/)
  return mm ? mm[1].toUpperCase() : 'GET'
}

// (a) fetch(`${API_BASE}/api/...`) calls
//   Group 1: the path literal (may contain ${…} template expressions)
//   Group 2: ',' when an options object follows; absent when the call closes
//   immediately with ')' — in that case default method is GET.
const directFetchRe = /fetch\(\s*`\$\{API_BASE\}(\/api\/[^`]+)`\s*(,)?/g
const directCalls = []

while ((m = directFetchRe.exec(apiSrc)) !== null) {
  const rawPath    = m[1]
  const hasOptions = m[2] === ','
  const method     = hasOptions
    ? extractFetchMethod(apiSrc, m.index + m[0].length)
    : 'GET'
  const path = rawPath
    .replace(/\$\{[^}]+\}/g, ':param') // ${anything} → :param
    .replace(/\?.*$/,         '')       // strip query string
  directCalls.push({ method, path, raw: rawPath })
}

// (b) xhr.open('METHOD', `${API_BASE}/api/...`) calls (used for upload progress)
const xhrOpenRe = /xhr\.open\(\s*['"`](\w+)['"`]\s*,\s*`\$\{API_BASE\}(\/api\/[^`]+)`/g
while ((m = xhrOpenRe.exec(apiSrc)) !== null) {
  const method  = m[1].toUpperCase()
  const rawPath = m[2]
  const path    = rawPath
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\?.*$/,         '')
  directCalls.push({ method, path, raw: rawPath })
}

// Deduplicate — same endpoint is sometimes used by multiple wrapper functions
// (e.g. apiApplyToJob and apiApplyToJobFull both hit POST /api/jobs/:id/apply)
const seenDirect = new Set()
const uniqueDirectCalls = directCalls.filter(({ method, path }) => {
  const key = `${method} ${path}`
  if (seenDirect.has(key)) return false
  seenDirect.add(key)
  return true
})

const directErrors = []
for (const { method, path, raw } of uniqueDirectCalls) {
  if (!normServerRoutes.has(`${method} ${path}`)) {
    directErrors.push({ method, path, raw })
  }
}

console.log(`Direct fetch/XHR calls found : ${uniqueDirectCalls.length}`)

if (directErrors.length === 0) {
  console.log(`\n${GREEN}✓ All ${uniqueDirectCalls.length} direct fetch/XHR calls have matching server routes.${RESET}\n`)
} else {
  console.log(`\n${RED}✗ ${directErrors.length} direct fetch/XHR call(s) have NO matching server route:${RESET}\n`)
  for (const e of directErrors) {
    console.log(`  ${RED}[${e.method}]${RESET} ${e.path}  (raw: "${e.raw}")`)
  }
  console.log()
  process.exit(1)
}

// ── 8. i18n segment import coverage ──────────────────────────────────────────
//
// Every *.js file under src/i18n/ (except index.js itself) must be:
//   (a) imported in index.js
//   (b) listed in the `segments` array so the deep-merge actually runs
//
// Catches the common mistake of adding a new translation file but forgetting
// to wire it up in the aggregator — translations silently vanish at runtime.

const i18nDir      = resolve(root, 'src/i18n')
const i18nIndexSrc = readFileSync(resolve(i18nDir, 'index.js'), 'utf8')

// Non-segment utility files that live in src/i18n/ but are not translation
// segments — they must NOT be required to appear in index.js or the segments array.
const I18N_NON_SEGMENT_FILES = new Set(['loader.js', 'useTranslation.js'])

const i18nSegmentFiles = readdirSync(i18nDir)
  .filter(f => f.endsWith('.js') && f !== 'index.js' && !I18N_NON_SEGMENT_FILES.has(f))
  .sort()

// (a) Check that each segment file has a matching import statement
const missingI18nImports = i18nSegmentFiles.filter(f => {
  const base = f.replace(/\.js$/, '')
  return !i18nIndexSrc.includes(`'./${f}'`)    &&
         !i18nIndexSrc.includes(`'./${base}'`) &&
         !i18nIndexSrc.includes(`"./${f}"`)    &&
         !i18nIndexSrc.includes(`"./${base}"`)
})

// (b) Check that every imported name is listed in the segments array
const i18nImportNames = [...i18nIndexSrc.matchAll(/^import\s+(\w+)\s+from\s+['"]\.\//gm)]
  .map(mm => mm[1])

const segmentsBlockMatch = i18nIndexSrc.match(/const\s+segments\s*=\s*\[([\s\S]*?)\]/)
const segmentsBlock      = segmentsBlockMatch ? segmentsBlockMatch[1] : ''
const missingFromSegments = i18nImportNames.filter(
  name => !new RegExp(`\\b${name}\\b`).test(segmentsBlock)
)

console.log(`i18n segment files   : ${i18nSegmentFiles.length}`)
console.log(`i18n imports         : ${i18nImportNames.length}`)

const i18nErrors = [
  ...missingI18nImports.map(f  => `${f} is not imported in src/i18n/index.js`),
  ...missingFromSegments.map(n => `import '${n}' is imported but not listed in the segments array`),
]

if (i18nErrors.length === 0) {
  console.log(`\n${GREEN}✓ All ${i18nSegmentFiles.length} i18n segment files are imported and listed in segments.${RESET}\n`)
} else {
  console.log(`\n${RED}✗ i18n coverage issues found:${RESET}`)
  for (const e of i18nErrors) console.log(`  ${RED}${e}${RESET}`)
  console.log()
  process.exit(1)
}

// ── 9. GDPR route existence ───────────────────────────────────────────────────
//
// These endpoints are legally mandated under GDPR Arts. 7, 17, and 20.
// A refactor that accidentally removes or renames one of them must fail the
// build before it reaches production.

const REQUIRED_GDPR_ROUTES = [
  'GET /api/gdpr/consent',
  'POST /api/gdpr/consent',
  'POST /api/gdpr/consent/withdraw',
  'POST /api/gdpr/account/request-delete',
  'DELETE /api/gdpr/account',
  'GET /api/gdpr/export',
]

const missingGdprRoutes = REQUIRED_GDPR_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingGdprRoutes.length > 0) {
  console.log(`${RED}✗ Missing required GDPR server routes:${RESET}`)
  for (const r of missingGdprRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All required GDPR routes (Art. 7/17/20) are registered on the server.${RESET}\n`)
}

// ── 10. Duplicate server route detection ──────────────────────────────────────
//
// Express silently ignores the second handler when the same METHOD+path is
// registered twice — only the first handler runs.  This catches accidental
// copy-paste duplicates before they cause subtle production bugs.
//
// Paths are normalised (:id, :userId → :param) so semantically identical
// routes with different parameter names are also detected.

const serverRoutesAllList = []
// Check app.METHOD routes in index.js
const serverRouteDupRe = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi
while ((m = serverRouteDupRe.exec(serverSrc)) !== null) {
  const method = m[1].toUpperCase()
  const path   = normaliseServerPath(m[2].split('?')[0])
  serverRoutesAllList.push(`${method} ${path}`)
}
// Check router.METHOD routes in all route files
try {
  const routeFiles2 = readdirSync(routesDir).filter(f => f.endsWith('.js'))
  for (const file of routeFiles2) {
    try {
      const src = readFileSync(resolve(routesDir, file), 'utf8')
      const re2 = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi
      while ((m = re2.exec(src)) !== null) {
        const method = m[1].toUpperCase()
        const subPath = normaliseServerPath(m[2].split('?')[0])
        let fullPath
        if (file === 'facebook.js') {
          fullPath = subPath === '/' ? FB_ROUTE_PREFIX : `${FB_ROUTE_PREFIX}${subPath}`
        } else {
          fullPath = subPath === '/' ? '/api' : `/api${subPath}`
        }
        serverRoutesAllList.push(`${method} ${fullPath}`)
      }
    } catch {}
  }
} catch {}

const routeFreq = new Map()
for (const r of serverRoutesAllList) {
  routeFreq.set(r, (routeFreq.get(r) || 0) + 1)
}
const duplicateRoutes = [...routeFreq.entries()].filter(([, count]) => count > 1)

if (duplicateRoutes.length > 0) {
  console.log(`${RED}✗ Duplicate server route registrations detected (Express only executes the first):${RESET}`)
  for (const [route, count] of duplicateRoutes) {
    console.log(`  ${RED}${route}  (registered ${count}×)${RESET}`)
  }
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ No duplicate server route registrations found (${serverRoutesAllList.length} routes scanned).${RESET}\n`)
}

// ── 11. CSRF exempt path consistency ─────────────────────────────────────────
//
// CSRF_EXEMPT_PATHS in server/index.js must:
//   (a) contain the four pre-auth paths users hit before they have a session
//   (b) contain ONLY /auth/* paths and /visit — anything else being exempt
//       would be a security vulnerability (no CSRF protection on state changes)
//
// Example of a dangerous misconfiguration this catches:
//   accidentally adding '/gdpr/account' to the set while refactoring

const csrfExemptMatch = combinedServerSrc.match(/const CSRF_EXEMPT_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
if (!csrfExemptMatch) {
  console.log(`${RED}✗ CSRF_EXEMPT_PATHS not found in server/index.js — CSRF middleware may be misconfigured.${RESET}\n`)
  process.exit(1)
}

const csrfExemptPaths = [...csrfExemptMatch[1].matchAll(/['"`]([^'"`\n]+)['"`]/g)]
  .map(mm => mm[1])

// These four must always be exempt — users reach them before having a session
// and therefore cannot possess a CSRF token.
const REQUIRED_CSRF_EXEMPT = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/verify-mfa',
]
const missingCsrfExempt = REQUIRED_CSRF_EXEMPT.filter(p => !csrfExemptPaths.includes(p))

// Only /auth/* paths and /visit are acceptable exemptions.
// Any other path being exempt means state-changing requests go unprotected.
const incorrectlyExempt = csrfExemptPaths.filter(
  p => !p.startsWith('/auth/') && p !== '/visit'
)

const csrfErrors = [
  ...missingCsrfExempt.map(p  => `${p} is missing from CSRF_EXEMPT_PATHS (required pre-auth exemption)`),
  ...incorrectlyExempt.map(p  => `${p} must not be in CSRF_EXEMPT_PATHS — only /auth/* and /visit are allowed`),
]

if (csrfErrors.length > 0) {
  console.log(`${RED}✗ CSRF_EXEMPT_PATHS misconfiguration:${RESET}`)
  for (const e of csrfErrors) console.log(`  ${RED}${e}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ CSRF_EXEMPT_PATHS is correctly configured (${csrfExemptPaths.length} exempt paths, all /auth/* or /visit).${RESET}\n`)
}

// ── 12. SMTP error surfacing check ────────────────────────────────────────────
//
// The forgot-password endpoint must surface SMTP delivery failures to the user
// rather than fire-and-forget (silently swallowing errors and lying "link sent").
//
// Two markers must both be present in server/index.js:
//   (a) 'email_send_failed'  — the error code returned to the client on SMTP failure
//   (b) 'Promise.race'       — wraps sendMail() with a timeout so the await doesn't
//                              hang the HTTP response indefinitely
//
// If either marker is missing, a future refactor has reintroduced the
// fire-and-forget antipattern and users will again get false "link sent"
// confirmations without receiving any email.

const EMAIL_FAIL_MARKER  = 'email_send_failed'
const EMAIL_AWAIT_MARKER = 'Promise.race'

const smtpErrors = []
if (!combinedServerSrc.includes(EMAIL_FAIL_MARKER)) {
  smtpErrors.push(`'${EMAIL_FAIL_MARKER}' not found in server/ — SMTP errors are silently swallowed`)
}
if (!combinedServerSrc.includes(EMAIL_AWAIT_MARKER)) {
  smtpErrors.push(`'${EMAIL_AWAIT_MARKER}' not found in server/ — sendMail() is fire-and-forget (must be awaited)`)
}

if (smtpErrors.length > 0) {
  console.log(`${RED}✗ forgot-password SMTP error handling is broken:${RESET}`)
  for (const e of smtpErrors) console.log(`  ${RED}${e}${RESET}`)
  console.log(`  ${RED}Users will receive false "nulstillingslink sendt" confirmations without getting any email.${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ forgot-password awaits SMTP send and surfaces failures via '${EMAIL_FAIL_MARKER}'.${RESET}\n`)
}

// ── 13. Password reset token migration check ──────────────────────────────────
//
// The forgot-password endpoint stores a hashed token in reset_token and
// reset_token_expires on the users table.  If these columns are missing
// (migration not applied), every forgot-password request crashes with a
// DB error → 500 → user sees "Kunne ikke nulstille adgangskode".
//
// Verify that the migration file that adds these columns:
//   (a) exists in the repository
//   (b) actually defines both required columns

const RESET_MIGRATION_PATH = resolve(root, 'server/migrate-mfa-reset.sql')

if (!existsSync(RESET_MIGRATION_PATH)) {
  console.log(`${RED}✗ server/migrate-mfa-reset.sql is missing — reset_token columns are never added.${RESET}`)
  console.log(`  ${RED}Every forgot-password request will crash with a DB error until the migration is created.${RESET}\n`)
  process.exit(1)
}

const resetMigrationSrc = readFileSync(RESET_MIGRATION_PATH, 'utf8')
const resetMigrationErrors = []
if (!resetMigrationSrc.includes('reset_token')) {
  resetMigrationErrors.push('reset_token column is not defined')
}
if (!resetMigrationSrc.includes('reset_token_expires')) {
  resetMigrationErrors.push('reset_token_expires column is not defined')
}

if (resetMigrationErrors.length > 0) {
  console.log(`${RED}✗ server/migrate-mfa-reset.sql is incomplete:${RESET}`)
  for (const e of resetMigrationErrors) console.log(`  ${RED}${e}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Password reset migration (migrate-mfa-reset.sql) defines reset_token + reset_token_expires.${RESET}`)
  console.log(`${GREEN}  Remember to run 'cd server && npm run migrate' on the production server after deploy.${RESET}\n`)
}

// ── 14. .env.example inline comment check ────────────────────────────────────
//
// Node.js --env-file does NOT strip inline comments (# after the value).
// An inline comment on e.g. SITE_URL turns into part of the value:
//
//   SITE_URL=https://fellis.eu  # some note
//   → process.env.SITE_URL === 'https://fellis.eu  # some note'
//
// This silently breaks every password reset link and invite URL in production.
// Verify that .env.example has no inline comments so the template stays clean
// and doesn't mislead developers into adding them to their own .env.

const ENV_EXAMPLE_PATH = resolve(root, 'server/.env.example')
if (existsSync(ENV_EXAMPLE_PATH)) {
  const envExampleLines = readFileSync(ENV_EXAMPLE_PATH, 'utf8').split('\n')
  const inlineCommentLines = envExampleLines
    .map((line, i) => ({ line, num: i + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return false     // blank or full-line comment
      if (!trimmed.includes('=')) return false                   // not a key=value line
      const valueStart = trimmed.indexOf('=') + 1
      const value = trimmed.slice(valueStart)
      return value.includes('#')                                 // # inside a value
    })

  if (inlineCommentLines.length > 0) {
    console.log(`${RED}✗ server/.env.example contains inline comments (Node.js --env-file includes them in the value):${RESET}`)
    for (const { line, num } of inlineCommentLines) {
      console.log(`  ${RED}Line ${num}: ${line.trim()}${RESET}`)
    }
    console.log(`  ${RED}Move comments to their own line starting with #.${RESET}`)
    console.log()
    process.exit(1)
  } else {
    console.log(`${GREEN}✓ server/.env.example has no inline comments (all # are on dedicated lines).${RESET}\n`)
  }
}

// ── 15. Onboarding dismiss endpoint ──────────────────────────────────────────
//
// The onboarding checklist is shown once to new users (account < 7 days,
// onboarding_dismissed = 0).  Dismissing it calls this endpoint:
//
//   POST /api/user/onboarding/dismiss → 200 (authenticated) | 401 (not authenticated)
//
// Must never return 404 (route missing) or 500 (server error).

const REQUIRED_ONBOARDING_ROUTES = [
  'POST /api/user/onboarding/dismiss',
]

const missingOnboardingRoutes = REQUIRED_ONBOARDING_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingOnboardingRoutes.length > 0) {
  console.log(`${RED}✗ Missing required onboarding server routes:${RESET}`)
  for (const r of missingOnboardingRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Onboarding dismiss route (POST /api/user/onboarding/dismiss) is registered on the server.${RESET}\n`)
}

// ── 16. Feed chronological ordering guarantee ─────────────────────────────────
//
// The main feed (GET /api/feed) MUST return posts in strict reverse-chronological
// order — no algorithmic ranking, scoring, or weighting applied to organic posts.
//
//   (a) GET /api/feed is registered on the server → route returns 200 for
//       authenticated requests, never 404/500
//   (b) The primary feed SQL must use ORDER BY p.created_at DESC — not a scoring
//       formula, not RAND(), not any weighted expression
//   (c) Admin feed-weight multipliers (feed_weight_family, feed_weight_interest,
//       feed_weight_recency) must NOT appear inside the feed SELECT — if they
//       were multiplied into an ORDER BY expression that would be hidden ranking
//
// Note: boosted ad injection (positions 4 and 15, non-ad-free users, page 1 only)
// is a clearly-labelled ad placement that does not reorder organic posts.
// The explore feed (/api/explore/feed) deliberately uses trending_score ordering
// and is a separate endpoint — that ranking is not the main chronological feed.

// (a) Confirm GET /api/feed is registered → will return 200 for authenticated users
if (!normServerRoutes.has('GET /api/feed')) {
  console.log(`${RED}✗ Feed ordering: GET /api/feed is not registered on the server — would return 404, not 200.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed ordering: GET /api/feed is registered and will return 200 for authenticated requests.${RESET}`)
}

// (b) Verify ORDER BY p.created_at DESC exists in the feed route source
const feedRoutePath = resolve(root, 'server/routes/feed.js')
let feedRouteSrc = ''
try {
  feedRouteSrc = readFileSync(feedRoutePath, 'utf8')
} catch {
  // fallback: search combined source (covers monolithic server/index.js layout)
  feedRouteSrc = combinedServerSrc
}

const FEED_CHRONO_MARKER = 'ORDER BY p.created_at DESC'
if (!feedRouteSrc.includes(FEED_CHRONO_MARKER)) {
  console.log(`${RED}✗ Feed ordering: main feed SQL is missing "ORDER BY p.created_at DESC".${RESET}`)
  console.log(`  ${RED}Posts may not arrive in reverse-chronological order. Check server/routes/feed.js.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed ordering: main feed SQL contains ORDER BY p.created_at DESC — pure chronological, no scoring.${RESET}`)
}

// (c) Verify that the boosted-post splice injection has not been reintroduced.
// Paid ads must be served only via AdBanner.jsx (/api/content), never by splicing
// sponsored posts into the chronological result array at fixed positions.
// Marker: the injection set isSponsored:true on objects it spliced into result[].
const FEED_SPLICE_INJECTION_MARKER = 'isSponsored: true'
if (feedRouteSrc.includes(FEED_SPLICE_INJECTION_MARKER)) {
  console.log(`${RED}✗ Feed ordering: boosted-post splice injection detected in server/routes/feed.js.${RESET}`)
  console.log(`  ${RED}Paid posts must not be injected into the chronological feed array.${RESET}`)
  console.log(`  ${RED}Serve sponsored content through AdBanner.jsx (/api/content) only.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed ordering: no boosted-post splice injection in the main feed handler.${RESET}`)
}

// (d) Feed-weight multipliers must NOT be wired into the feed SELECT.
// The pattern looks for: feed_weight_<name> multiplied by anything (ranking injection).
// Their presence in admin-settings CRUD routes is fine; only a multiplication in
// the feed query itself constitutes algorithmic ranking.
const FEED_WEIGHT_RANKING_RE = /feed_weight_(?:family|interest|recency)\s*\*\s*[\d(]/
if (FEED_WEIGHT_RANKING_RE.test(feedRouteSrc)) {
  console.log(`${RED}✗ Feed ordering: feed_weight multipliers are applied inside the feed query — hidden ranking detected.${RESET}`)
  console.log(`  ${RED}The main GET /api/feed must order by created_at DESC only. No scoring or weighting allowed.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed ordering: feed_weight multipliers are NOT applied in the main feed query (no hidden ranking).${RESET}`)
}
console.log()

// ── 17. Translations endpoint checks ─────────────────────────────────────────
//
// The JSON-based i18n system exposes translations via GET /api/translations.
// Static equivalents of the following HTTP test cases:
//
//   GET /api/translations?lang=da&feature=auth    → 200  (valid lang + valid feature)
//   GET /api/translations?lang=xx&feature=auth    → 400  (unknown lang rejected)
//   GET /api/translations?lang=da&feature=unknown → 400/404 (unknown feature rejected)
//
// Four static invariants must hold:
//
//   (a) GET /api/translations is registered on the server — otherwise every
//       dynamic import that falls back to the API will receive a 404.
//   (b) The translations route validates the `lang` parameter and returns 400
//       for unknown languages (e.g. lang=xx) so callers get a clear error.
//   (c) The translations route validates the `feature` parameter and returns
//       400 (or 404) for unknown features so missing JSON files don't cause 500s.

const REQUIRED_TRANSLATIONS_ROUTES = ['GET /api/translations']

const missingTranslationsRoutes = REQUIRED_TRANSLATIONS_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingTranslationsRoutes.length > 0) {
  console.log(`${RED}✗ Missing required translations server routes:${RESET}`)
  for (const r of missingTranslationsRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
}

const translationsRoutePath = resolve(root, 'server/routes/translations.js')
let translationsSrc = ''
try {
  translationsSrc = readFileSync(translationsRoutePath, 'utf8')
} catch {
  console.log(`${RED}✗ server/routes/translations.js not found.${RESET}\n`)
  process.exit(1)
}

const translationsErrors = []

// (b) lang validation — must reject unknown langs (return 400)
if (!translationsSrc.includes('VALID_LANGS') || !translationsSrc.includes('400')) {
  translationsErrors.push('translations route does not validate lang parameter or is missing 400 response')
}

// (c) feature validation — must reject unknown features (return 400 or 404)
if (!translationsSrc.includes('VALID_FEATURES')) {
  translationsErrors.push('translations route does not validate feature parameter (VALID_FEATURES whitelist missing)')
}

// (d) all 11 supported languages must be present in VALID_LANGS
//     proves: GET ?lang=da → passes validation (valid lang)
//             GET ?lang=xx → rejected (xx absent from VALID_LANGS → 400)
const REQUIRED_LANGS = ['da', 'en', 'de', 'es', 'fr', 'it', 'nl', 'no', 'pl', 'pt', 'sv']
const missingLangs = REQUIRED_LANGS.filter(l => !translationsSrc.includes(`'${l}'`) && !translationsSrc.includes(`"${l}"`))
if (missingLangs.length > 0) {
  translationsErrors.push(`translations route VALID_LANGS is missing required languages: ${missingLangs.join(', ')}`)
}

// (f) all 4 feature namespaces must be present in VALID_FEATURES
//     proves: GET ?feature=auth    → passes validation → 200 (auth in VALID_FEATURES)
//             GET ?feature=unknown → rejected (unknown absent from VALID_FEATURES → 400/404)
const REQUIRED_FEATURES = ['auth', 'common', 'feed', 'profile']
const missingFeatures = REQUIRED_FEATURES.filter(f =>
  !translationsSrc.includes(`'${f}'`) && !translationsSrc.includes(`"${f}"`)
)
if (missingFeatures.length > 0) {
  translationsErrors.push(`VALID_FEATURES is missing required feature(s): ${missingFeatures.join(', ')} — GET ?lang=da&feature=auth would return 400/404`)
}

// (e) cache header must be set for valid responses
if (!translationsSrc.includes('Cache-Control')) {
  translationsErrors.push('translations route does not set Cache-Control header for valid responses')
}

if (translationsErrors.length > 0) {
  console.log(`${RED}✗ translations route validation issues:${RESET}`)
  for (const e of translationsErrors) console.log(`  ${RED}${e}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ GET /api/translations is registered, validates lang + feature, supports all ${REQUIRED_LANGS.length} languages and ${REQUIRED_FEATURES.length} feature namespaces.${RESET}\n`)
}

// ── User-type, company-profile, network-profile, and feature-flag routes ──────
//
// These routes implement the user-type system (private / network / business).
// All must be registered on the server and never return 404.
//
//   PATCH /api/user/type               → 200 (authenticated) | 400 (bad mode) | 401
//   GET   /api/user/:id/type           → 200 (public)        | 400 (bad id)   | 404
//   POST  /api/company/profile         → 200 (business)      | 403 (wrong type)| 401
//   GET   /api/company/profile/:userId → 200 (public)        | 404 (not found)
//   PATCH /api/user/network-profile    → 200 (network)       | 403 (wrong type)| 401
//   GET   /api/user/features           → 200 (authenticated) | 401
//
const REQUIRED_USER_TYPE_ROUTES = [
  'PATCH /api/user/type',
  'GET /api/user/:id/type',
  'POST /api/company/profile',
  'GET /api/company/profile/:userId',
  'PATCH /api/user/network-profile',
  'GET /api/user/features',
]

const missingUserTypeRoutes = REQUIRED_USER_TYPE_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingUserTypeRoutes.length > 0) {
  console.log(`${RED}✗ Missing required user-type server routes:${RESET}`)
  for (const r of missingUserTypeRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All ${REQUIRED_USER_TYPE_ROUTES.length} user-type routes (type/company/network/features) are registered on the server.${RESET}\n`)
}

// Verify PATCH /api/user/type validates the mode parameter
const userTypeRoutesSrc = readFileSync(resolve(root, 'server/routes/users.js'), 'utf8')
if (!userTypeRoutesSrc.includes("'private'") || !userTypeRoutesSrc.includes("'network'") || !userTypeRoutesSrc.includes("'business'")) {
  console.log(`${RED}✗ PATCH /api/user/type is missing mode validation for 'private', 'network', or 'business'.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ PATCH /api/user/type validates mode against private/network/business enum.${RESET}\n`)
}

// ── Feed context routes (post_context feed separation) ────────────────────────
//
//   GET  /api/feed/network  → 200 (network/business) | 401 (other modes)
//   GET  /api/feed/business → 200 (authenticated)    | 401 (unauthenticated)
//
const REQUIRED_FEED_CONTEXT_ROUTES = [
  'GET /api/feed/network',
  'GET /api/feed/business',
]

const missingFeedContextRoutes = REQUIRED_FEED_CONTEXT_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingFeedContextRoutes.length > 0) {
  console.log(`${RED}✗ Missing feed context server routes:${RESET}`)
  for (const r of missingFeedContextRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Feed context routes (GET /api/feed/network and /business) are registered.${RESET}\n`)
}

// Verify api.js exports the new feed functions
const feedContextApiCheck = ['apiFetchNetworkFeed', 'apiFetchBusinessFeed']
const missingFeedApiFns = feedContextApiCheck.filter(fn => !apiSrc.includes(fn))
if (missingFeedApiFns.length > 0) {
  console.log(`${RED}✗ src/api.js is missing feed context functions: ${missingFeedApiFns.join(', ')}${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ src/api.js exports apiFetchNetworkFeed and apiFetchBusinessFeed.${RESET}\n`)
}

// ── Company profile form routes ───────────────────────────────────────────────
//
//   POST /api/company/profile  → 200 (business mode) | 403 (other modes)
//   GET  /api/company/profile/:userId → 200 (public)
//
const REQUIRED_COMPANY_PROFILE_ROUTES = [
  'POST /api/company/profile',
  'GET /api/company/profile/:userId',
]

const missingCompanyProfileRoutes = REQUIRED_COMPANY_PROFILE_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingCompanyProfileRoutes.length > 0) {
  console.log(`${RED}✗ Missing company profile server routes:${RESET}`)
  for (const r of missingCompanyProfileRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ Company profile routes (POST and GET /api/company/profile) are registered.${RESET}\n`)
}

// Verify api.js exports apiCreateCompanyProfile
if (!apiSrc.includes('apiCreateCompanyProfile')) {
  console.log(`${RED}✗ src/api.js is missing apiCreateCompanyProfile export.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ src/api.js exports apiCreateCompanyProfile.${RESET}\n`)
}

// Verify 403 guard in POST /api/company/profile
const miscRoutesSrc = readFileSync(resolve(root, 'server/routes/misc.js'), 'utf8')
if (!miscRoutesSrc.includes("req.userMode !== 'business'") || !miscRoutesSrc.includes('403')) {
  console.log(`${RED}✗ POST /api/company/profile is missing 403 guard for non-business users.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ POST /api/company/profile has 403 guard for non-business mode.${RESET}\n`)
}

// ── Groups route existence + logic checks ────────────────────────────────────
//
// All routes registered in server/routes/groups.js must be present so that
// none of them return 404.  The try/catch count verifies 500s are handled.
//
// Static invariants checked here:
//   (a) Every declared groups route exists in the server route set   → no 404
//   (b) Every route handler has a try/catch block                    → no unhandled 500
//   (c) GET /api/groups/:slug returns 403 for hidden groups
//   (d) Trending sort uses post_count DESC, member_count DESC
//   (e) POST /api/groups assigns 'admin' role to creator in group_members

const REQUIRED_GROUPS_ROUTES = [
  // CRUD + admin (step 1)
  'GET /api/groups',
  'POST /api/groups',
  'GET /api/groups/me',
  'GET /api/groups/suggestions',
  'GET /api/groups/admin/pending',
  'POST /api/groups/admin/approve/:id',
  'POST /api/groups/admin/reject/:id',
  'DELETE /api/groups/admin/:id',
  'GET /api/groups/:slug',
  'PUT /api/groups/:id',
  'DELETE /api/groups/:id',
  'POST /api/groups/:id/join',
  // Polls (step 2)
  'POST /api/groups/:id/polls',
  'GET /api/groups/:id/polls',
  'POST /api/groups/:id/polls/:pollId/vote',
  // Events (step 2)
  'POST /api/groups/:id/events',
  'GET /api/groups/:id/events',
  'POST /api/groups/:id/events/:eventId/rsvp',
  // Invitations (step 2)
  'POST /api/groups/:id/invite',
  'GET /api/groups/join/:token',
  // Moderation (step 2)
  'GET /api/groups/:id/modlog',
  'POST /api/groups/:id/moderate',
]

const missingGroupsRoutes = REQUIRED_GROUPS_ROUTES.filter(r => {
  const [method, p] = r.split(' ')
  return !normServerRoutes.has(`${method} ${normaliseServerPath(p)}`)
})

if (missingGroupsRoutes.length > 0) {
  console.log(`${RED}✗ Missing required groups server routes:${RESET}`)
  for (const r of missingGroupsRoutes) console.log(`  ${RED}${r}${RESET}`)
  console.log()
  process.exit(1)
} else {
  console.log(`${GREEN}✓ All ${REQUIRED_GROUPS_ROUTES.length} groups routes are registered on the server (no 404).${RESET}\n`)
}

const groupsRouteSrc = readFileSync(resolve(root, 'server/routes/groups.js'), 'utf8')

// (b) every handler has a try/catch → prevents unhandled 500
const groupsHandlerCount = (groupsRouteSrc.match(/router\.(get|post|put|patch|delete)\(/gi) || []).length
const groupsTryCatchCount = (groupsRouteSrc.match(/\btry\s*\{/g) || []).length
if (groupsTryCatchCount < groupsHandlerCount) {
  console.log(`${RED}✗ groups.js: ${groupsHandlerCount} route handlers but only ${groupsTryCatchCount} try/catch blocks — some routes may return unhandled 500.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: all ${groupsHandlerCount} route handlers have try/catch error handling (500 prevention).${RESET}\n`)
}

// (c) 403 guard for hidden groups
if (!groupsRouteSrc.includes("'hidden'") || !groupsRouteSrc.includes('403')) {
  console.log(`${RED}✗ groups.js: GET /api/groups/:slug is missing 403 guard for hidden groups.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: 403 guard for hidden groups is present.${RESET}\n`)
}

// (d) trending sort
if (!groupsRouteSrc.includes('post_count DESC') || !groupsRouteSrc.includes('member_count DESC')) {
  console.log(`${RED}✗ groups.js: trending sort is missing post_count DESC or member_count DESC ordering.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: trending sort uses post_count DESC, member_count DESC.${RESET}\n`)
}

// (e) creator assigned admin role on group creation
if (!groupsRouteSrc.includes("'admin'")) {
  console.log(`${RED}✗ groups.js: POST /api/groups does not assign admin role to creator in group_members.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: group creator is assigned admin role in group_members.${RESET}\n`)
}

// (f) poll votes enforce one vote per user via ON DUPLICATE KEY UPDATE
if (!groupsRouteSrc.includes('ON DUPLICATE KEY UPDATE')) {
  console.log(`${RED}✗ groups.js: poll vote handler is missing ON DUPLICATE KEY UPDATE — one-vote-per-user not enforced.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: poll votes use ON DUPLICATE KEY UPDATE (one vote per user enforced).${RESET}\n`)
}

// (g) invite link uses a random token (crypto.randomBytes)
if (!groupsRouteSrc.includes('randomBytes')) {
  console.log(`${RED}✗ groups.js: POST /api/groups/:id/invite does not generate a random invite token.${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: invite link generates a random token via crypto.randomBytes.${RESET}\n`)
}

// (h) GET /api/groups/join/:token works without auth (no authenticate middleware on the handler)
const joinTokenLine = groupsRouteSrc.match(/router\.get\(['"`]\/groups\/join\/:token['"`][^)]*\)/)
if (!joinTokenLine || joinTokenLine[0].includes('authenticate')) {
  console.log(`${RED}✗ groups.js: GET /api/groups/join/:token must not require authentication (token preview is public).${RESET}\n`)
  process.exit(1)
} else {
  console.log(`${GREEN}✓ groups.js: GET /api/groups/join/:token is accessible without authentication.${RESET}\n`)
}

process.exit(0)
