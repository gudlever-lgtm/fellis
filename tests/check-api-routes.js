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
  process.exit(0)
} else {
  console.log(`\n${RED}✗ ${errors.length} client API call(s) have NO matching server route:${RESET}\n`)
  for (const e of errors) {
    console.log(`  ${RED}[${e.method}]${RESET} ${e.path}  (raw: "${e.raw}")`)
  }
  console.log()
  process.exit(1)
}
