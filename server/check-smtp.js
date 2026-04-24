#!/usr/bin/env node
/**
 * server/check-smtp.js — Verify SMTP connectivity and authentication.
 *
 * Reads the same environment variables as the main server and attempts to
 * open a connection to the configured SMTP host and authenticate.  Does NOT
 * send any email — nodemailer's verify() only completes the SMTP handshake.
 *
 * Run from the server/ directory:
 *   npm run check-smtp                       (reads .env automatically)
 *   node --env-file=.env check-smtp.js
 *
 * Exit codes:
 *   0  — SMTP connection verified, or MAIL_HOST not configured (dev mode)
 *   1  — SMTP connection FAILED (wrong credentials, host unreachable, etc.)
 */

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET  = '\x1b[0m'

const MAIL_HOST   = process.env.MAIL_HOST
const MAIL_PORT   = parseInt(process.env.MAIL_PORT || '587')
const MAIL_SECURE = process.env.MAIL_SECURE === 'true'
const MAIL_USER   = process.env.MAIL_USER
const MAIL_PASS   = process.env.MAIL_PASS
const MAIL_FROM   = process.env.MAIL_FROM || MAIL_USER

console.log('\n=== SMTP Connectivity Check ===\n')

if (!MAIL_HOST) {
  console.log(`${YELLOW}⚠  MAIL_HOST is not set in server/.env${RESET}`)
  console.log()
  console.log('   Password reset emails will NOT be sent — the server logs the reset')
  console.log('   link to stdout instead (dev mode).  This is intentional in development')
  console.log('   but means users cannot reset their passwords in production.')
  console.log()
  console.log('   To enable email, set these variables in server/.env:')
  console.log('     MAIL_HOST=smtp.example.com')
  console.log('     MAIL_PORT=587')
  console.log('     MAIL_SECURE=false')
  console.log('     MAIL_USER=your@email.com')
  console.log('     MAIL_PASS=your-smtp-password')
  console.log('     MAIL_FROM=noreply@fellis.eu')
  console.log()
  process.exit(0)
}

console.log(`  Host   : ${MAIL_HOST}`)
console.log(`  Port   : ${MAIL_PORT}`)
console.log(`  Secure : ${MAIL_SECURE}`)
console.log(`  User   : ${MAIL_USER || '(none)'}`)
console.log(`  From   : ${MAIL_FROM || '(none)'}`)
console.log()

let nodemailer
try {
  nodemailer = (await import('nodemailer')).default
} catch {
  console.log(`${RED}✖  nodemailer is not installed.${RESET}`)
  console.log('   Run: npm install')
  console.log()
  process.exit(1)
}

const transport = nodemailer.createTransport({
  host: MAIL_HOST,
  port: MAIL_PORT,
  secure: MAIL_SECURE,
  auth: MAIL_USER ? { user: MAIL_USER, pass: MAIL_PASS } : undefined,
  family: 4, // Force IPv4 — avoids ENETUNREACH on hosts without an IPv6 route
})

const CONNECT_TIMEOUT_MS = 12_000

console.log(`  Connecting... (timeout ${CONNECT_TIMEOUT_MS / 1000}s)`)
try {
  await Promise.race([
    transport.verify(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s — port ${MAIL_PORT} is likely blocked by the server firewall`)), CONNECT_TIMEOUT_MS)
    ),
  ])
  console.log()
  console.log(`${GREEN}✓  SMTP connection verified${RESET}`)
  console.log(`${GREEN}   ${MAIL_HOST}:${MAIL_PORT} accepted the login for ${MAIL_USER}${RESET}`)
  console.log(`${GREEN}   Password reset emails will be delivered from ${MAIL_FROM || MAIL_USER}${RESET}`)
  console.log()
  process.exit(0)
} catch (err) {
  console.log()
  console.log(`${RED}✖  SMTP connection FAILED${RESET}`)
  console.log(`${RED}   ${err.message}${RESET}`)
  console.log()
  const isTimeout = err.message.includes('timed out')
  const isAuthFail = err.message.includes('535') || err.message.includes('auth') || err.message.includes('Authentication')
  if (isTimeout) {
    console.log('  The TCP connection was silently dropped — the port is likely blocked.')
    console.log()
    console.log('  Fix: switch to port 587 with STARTTLS in server/.env:')
    console.log('    MAIL_PORT=587')
    console.log('    MAIL_SECURE=false')
    console.log()
    console.log('  Port 465 (SMTPS) is commonly blocked by VPS providers to prevent spam.')
    console.log('  Port 587 (STARTTLS submission) is the modern standard and usually allowed.')
    console.log('  Migadu supports both — 587 is their recommended setting.')
  } else if (isAuthFail) {
    console.log('  Authentication failed — check MAIL_USER and MAIL_PASS in server/.env.')
    console.log('  For Migadu: the password is the mailbox password (not your Migadu account password).')
  } else {
    console.log('  Troubleshooting:')
    console.log('  1. Double-check MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS in server/.env')
    console.log('  2. Port 587 → MAIL_SECURE=false (STARTTLS); port 465 → MAIL_SECURE=true (TLS)')
    console.log('  3. Check that the server allows outbound TCP on port', MAIL_PORT)
  }
  console.log()
  process.exit(1)
}
