import express from 'express'
import pool from '../db.js'
import { sendSms } from '../sms.js'
import { validate, schemas } from '../validation.js'
import { BADGES, BADGE_BY_ID, PLATFORM_LAUNCH_DATE, BADGE_AD_FREE_DAYS } from '../../src/badges/badgeDefinitions.js'
import { evaluateBadges } from '../../src/badges/badgeEngine.js'
import {
  authenticate, writeLimit, fileUploadLimit, strictLimit, registerLimit,
  requireAdmin, requireModerator, requireBusiness, attachUserMode,
  upload, uploadDoc, reelUpload, coverUpload,
  formatPostTime, formatMsgTime, applySignals, autoSignalPost,
  checkInviteRateLimit, checkForgotRateLimit, checkAndAwardBadges,
  createNotification, auditLog, auditLogGdpr, hasConsent, recordConsent, withdrawConsent,
  getSessionIdFromRequest, setSessionCookie, clearSessionCookie, generateCsrfToken,
  validateMagicBytes, validatePasswordStrength, getPasswordPolicy,
  sseBroadcast, sseAdd, sseRemove, sseClients,
  parseBrowser, getGeoForIp,
  UPLOADS_DIR, MISTRAL_API_KEY, UPLOAD_FILES_CEILING,
  mailer, oauthStateTokens,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  COOKIE_NAME, SERVER_START, visitedSessions, visitedAnonIps,
} from '../middleware.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import bcrypt from 'bcrypt'
import { createReelFromLivestream, LIVESTREAM_DEFAULTS, transcodeVideo } from '../livestream.js'

const router = express.Router()

// ── Google OAuth constants ──
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://fellis.eu/api/auth/google/callback'

// ── LinkedIn OAuth constants ──
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://fellis.eu/api/auth/linkedin/callback'

// ── Email translations ──────────────────────────────────────────────────────
const EMAIL_LANGS = new Set(['da','en','de','fr','es','fi','pl','it','no','nl','sv','pt'])
function emailLang(lang) { return EMAIL_LANGS.has(lang) ? lang : 'en' }

function getResetEmailStrings(lang, name, resetUrl) {
  const l = emailLang(lang)
  const btn = {
    da: 'Nulstil adgangskode', en: 'Reset password', de: 'Passwort zurücksetzen',
    fr: 'Réinitialiser le mot de passe', es: 'Restablecer contraseña', fi: 'Nollaa salasana',
    pl: 'Zresetuj hasło', it: 'Reimposta password', no: 'Tilbakestill passord',
    nl: 'Wachtwoord opnieuw instellen', sv: 'Återställ lösenord', pt: 'Redefinir senha',
  }[l]
  const subject = {
    da: 'Nulstil din adgangskode', en: 'Reset your password', de: 'Passwort zurücksetzen',
    fr: 'Réinitialisez votre mot de passe', es: 'Restablece tu contraseña', fi: 'Nollaa salasanasi',
    pl: 'Zresetuj swoje hasło', it: 'Reimposta la tua password', no: 'Tilbakestill passordet ditt',
    nl: 'Stel je wachtwoord opnieuw in', sv: 'Återställ ditt lösenord', pt: 'Redefina sua senha',
  }[l]
  const greet = {
    da: `Hej ${name}`, en: `Hi ${name}`, de: `Hallo ${name}`, fr: `Bonjour ${name}`,
    es: `Hola ${name}`, fi: `Hei ${name}`, pl: `Cześć ${name}`, it: `Ciao ${name}`,
    no: `Hei ${name}`, nl: `Hallo ${name}`, sv: `Hej ${name}`, pt: `Olá ${name}`,
  }[l]
  const body = {
    da: `Klik her for at nulstille din adgangskode (linket udløber om 1 time):`,
    en: `Click here to reset your password (the link expires in 1 hour):`,
    de: `Klicken Sie hier, um Ihr Passwort zurückzusetzen (der Link läuft in 1 Stunde ab):`,
    fr: `Cliquez ici pour réinitialiser votre mot de passe (le lien expire dans 1 heure) :`,
    es: `Haz clic aquí para restablecer tu contraseña (el enlace caduca en 1 hora):`,
    fi: `Nollaa salasanasi napsauttamalla tästä (linkki vanhenee 1 tunnin kuluttua):`,
    pl: `Kliknij tutaj, aby zresetować swoje hasło (link wygasa za 1 godzinę):`,
    it: `Clicca qui per reimpostare la tua password (il link scade tra 1 ora):`,
    no: `Klikk her for å tilbakestille passordet ditt (lenken utløper om 1 time):`,
    nl: `Klik hier om je wachtwoord opnieuw in te stellen (de link verloopt over 1 uur):`,
    sv: `Klicka här för att återställa ditt lösenord (länken går ut om 1 timme):`,
    pt: `Clique aqui para redefinir sua senha (o link expira em 1 hora):`,
  }[l]
  const ignore = {
    da: `Hvis du ikke bad om dette, kan du ignorere denne e-mail.`,
    en: `If you didn't request this, you can ignore this email.`,
    de: `Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.`,
    fr: `Si vous n'avez pas demandé cela, vous pouvez ignorer cet e-mail.`,
    es: `Si no solicitaste esto, puedes ignorar este correo.`,
    fi: `Jos et pyytänyt tätä, voit ohittaa tämän sähköpostin.`,
    pl: `Jeśli tego nie prosiłeś, możesz zignorować ten e-mail.`,
    it: `Se non hai richiesto questo, puoi ignorare questa email.`,
    no: `Hvis du ikke ba om dette, kan du ignorere denne e-posten.`,
    nl: `Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.`,
    sv: `Om du inte begärde detta kan du ignorera det här e-postmeddelandet.`,
    pt: `Se você não solicitou isso, pode ignorar este e-mail.`,
  }[l]
  const regards = {
    da: 'Venlig hilsen', en: 'Best regards', de: 'Mit freundlichen Grüßen',
    fr: 'Cordialement', es: 'Saludos', fi: 'Ystävällisin terveisin',
    pl: 'Pozdrawiam', it: 'Cordiali saluti', no: 'Med vennlig hilsen',
    nl: 'Met vriendelijke groeten', sv: 'Med vänliga hälsningar', pt: 'Atenciosamente',
  }[l]
  const copyLink = {
    da: 'Eller kopier dette link', en: 'Or copy this link', de: 'Oder diesen Link kopieren',
    fr: 'Ou copiez ce lien', es: 'O copia este enlace', fi: 'Tai kopioi tämä linkki',
    pl: 'Lub skopiuj ten link', it: 'O copia questo link', no: 'Eller kopier denne lenken',
    nl: 'Of kopieer deze link', sv: 'Eller kopiera den här länken', pt: 'Ou copie este link',
  }[l]
  return {
    subject,
    text: `${greet},\n\n${body}\n${resetUrl}\n\n${ignore}\n\n${regards},\nFellis`,
    html: `<p>${greet},</p><p>${body}</p><p><a href="${resetUrl}" style="background:#2D6A4F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${btn}</a></p><p style="color:#888;font-size:12px">${copyLink}: ${resetUrl}</p><p style="color:#888;font-size:12px">${ignore}</p>`,
  }
}

function getMfaEmailStrings(lang, code) {
  const l = emailLang(lang)
  const subject = {
    da: 'Din Fellis-kode', en: 'Your Fellis code', de: 'Dein Fellis-Code',
    fr: 'Votre code Fellis', es: 'Tu código de Fellis', fi: 'Fellis-koodisi',
    pl: 'Twój kod Fellis', it: 'Il tuo codice Fellis', no: 'Din Fellis-kode',
    nl: 'Jouw Fellis-code', sv: 'Din Fellis-kod', pt: 'Seu código Fellis',
  }[l]
  const intro = {
    da: `Din Fellis-kode er: ${code}`, en: `Your Fellis code is: ${code}`,
    de: `Dein Fellis-Code lautet: ${code}`, fr: `Votre code Fellis est : ${code}`,
    es: `Tu código de Fellis es: ${code}`, fi: `Fellis-koodisi on: ${code}`,
    pl: `Twój kod Fellis to: ${code}`, it: `Il tuo codice Fellis è: ${code}`,
    no: `Din Fellis-kode er: ${code}`, nl: `Jouw Fellis-code is: ${code}`,
    sv: `Din Fellis-kod är: ${code}`, pt: `Seu código Fellis é: ${code}`,
  }[l]
  const expires = {
    da: 'Koden udløber om 5 minutter.', en: 'The code expires in 5 minutes.',
    de: 'Der Code läuft in 5 Minuten ab.', fr: 'Le code expire dans 5 minutes.',
    es: 'El código caduca en 5 minutos.', fi: 'Koodi vanhenee 5 minuutissa.',
    pl: 'Kod wygasa za 5 minut.', it: 'Il codice scade tra 5 minuti.',
    no: 'Koden utløper om 5 minutter.', nl: 'De code verloopt over 5 minuten.',
    sv: 'Koden upphör om 5 minuter.', pt: 'O código expira em 5 minutos.',
  }[l]
  return {
    subject,
    text: `${intro}\n${expires}`,
    html: `<p>${intro.replace(`: ${code}`, `: <strong style="font-size:18px">${code}</strong>`)}</p><p style="color:#888">${expires}</p>`,
  }
}

router.get('/auth/password-policy', async (req, res) => {
  res.json(await getPasswordPolicy())
})


router.post('/auth/login', strictLimit, validate(schemas.login), async (req, res) => {
  const { email, password, lang } = req.body
  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?', [email]
    )
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' })
    const user = users[0]

    // Check if account is locked due to brute force attempts
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000)
      return res.status(429).json({
        error: `Account locked due to too many failed login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`
      })
    }

    // Verify password (support bcrypt, legacy SHA-256, and legacy plaintext)
    let passwordValid = false
    if (user.password_hash && user.password_hash.startsWith('$2')) {
      // Bcrypt hash — try direct compare first
      passwordValid = await bcrypt.compare(password, user.password_hash)
      if (!passwordValid) {
        // Fallback: previous migration may have stored bcrypt(sha256(password))
        const sha256hex = crypto.createHash('sha256').update(password).digest('hex')
        passwordValid = await bcrypt.compare(sha256hex, user.password_hash)
        if (passwordValid) {
          // Re-hash properly as bcrypt(plaintext) going forward
          const bcryptHash = await bcrypt.hash(password, 10)
          await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcryptHash, user.id])
        }
      }
    } else if (user.password_hash && /^[0-9a-f]{64}$/.test(user.password_hash)) {
      // Legacy SHA-256 hash — verify and migrate to bcrypt
      const sha256 = crypto.createHash('sha256').update(password).digest('hex')
      passwordValid = crypto.timingSafeEqual(Buffer.from(sha256), Buffer.from(user.password_hash))
      if (passwordValid) {
        const bcryptHash = await bcrypt.hash(password, 10)
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcryptHash, user.id])
      }
    } else if (user.password_plain === password) {
      // Legacy plaintext match — migrate to bcrypt and clear plaintext
      passwordValid = true
      const bcryptHash = await bcrypt.hash(password, 10)
      await pool.query('UPDATE users SET password_hash = ?, password_plain = NULL WHERE id = ?', [bcryptHash, user.id])
    }

    if (!passwordValid) {
      // OAuth-only account: no password has ever been set — don't count as brute-force
      if (!user.password_hash && !user.password_plain) {
        return res.status(401).json({ error: 'social_login_only' })
      }

      // Increment failed login attempts (columns may not exist on older installs — ignore errors)
      const newAttempts = (user.failed_login_attempts || 0) + 1

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        await pool.query(
          'UPDATE users SET failed_login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [newAttempts, LOCKOUT_DURATION_MINUTES, user.id]
        ).catch(() => {})
        // Audit log: account locked
        await auditLog(req, 'login_failed_account_locked', 'user', user.id, {
          status: 'failure',
          userId: user.id,
          details: { attempts: newAttempts, reason: 'brute_force_protection' }
        })
        return res.status(429).json({
          error: `Too many failed login attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes.`
        })
      } else {
        await pool.query(
          'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
          [newAttempts, user.id]
        ).catch(() => {})
        // Audit log: failed login attempt
        await auditLog(req, 'login_failed', 'user', user.id, {
          status: 'failure',
          userId: user.id,
          details: { attempts: newAttempts, remaining_before_lockout: MAX_LOGIN_ATTEMPTS - newAttempts }
        })
        return res.status(401).json({ error: 'Invalid credentials' })
      }
    }

    // Password valid: reset failed attempts counter (columns may not exist on older installs)
    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id])
      .catch(() => {}) // ignore if columns don't exist yet

    // MFA: if enabled, send code via SMS (preferred) or fall back to email
    if (user.mfa_enabled && (user.phone || user.email)) {
      const rawCode = String(Math.floor(100000 + Math.random() * 900000))
      const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
      await pool.query(
        'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
        [hashedCode, user.id]
      )
      let method = null
      if (user.phone) {
        const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
        if (smsSent) method = 'sms'
        else console.error(`MFA SMS failed to send for user ${user.id} — 46elks may not be configured`)
      }
      if (!method && user.email && mailer) {
        const fromAddr = process.env.MAIL_FROM || process.env.MAIL_USER
        const mfaStrings = getMfaEmailStrings(lang, rawCode)
        try {
          await Promise.race([
            mailer.sendMail({
              from: `"Fellis" <${fromAddr}>`,
              to: user.email,
              subject: mfaStrings.subject,
              text: mfaStrings.text,
              html: mfaStrings.html,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), 10000)),
          ])
          method = 'email'
        } catch (mailErr) {
          console.error('MFA email error:', mailErr.message)
        }
      }
      if (!method) {
        return res.status(503).json({ error: 'mfa_delivery_unavailable' })
      }
      return res.json({ mfa_required: true, userId: user.id, method })
    }

    // No MFA — create session immediately
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    // Try with user_agent/ip_address columns; fall back if they don't exist yet
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, user.id, lang || 'da', ua, ip]
    ).catch(() =>
      pool.query(
        'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
        [sessionId, user.id, lang || 'da']
      )
    )
    setSessionCookie(res, sessionId)
    // Audit log: successful login
    await auditLog(
      req,
      'login',
      'user',
      user.id,
      { status: 'success', userId: user.id, details: { mfa_enabled: !!user.mfa_enabled } }
    )
    res.json({ sessionId, userId: user.id })
  } catch (err) {
    console.error('[/api/auth/login] 500 error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})


router.post('/auth/register', registerLimit, validate(schemas.register), async (req, res) => {
  const { name, email, password, lang, inviteToken } = req.body
  const regPolicy = await getPasswordPolicy()
  const regPwdErrors = validatePasswordStrength(password, regPolicy, lang || 'da')
  if (regPwdErrors.length > 0) return res.status(400).json({ error: regPwdErrors.join('. ') })
  try {
    const bcryptHash = await bcrypt.hash(password, 10)
    const handle = '@' + name.toLowerCase().replace(/\s+/g, '.')
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase()
    const userInviteToken = crypto.randomBytes(32).toString('hex')
    const [result] = await pool.query(
      'INSERT INTO users (name, handle, initials, email, password_hash, join_date, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, handle, initials, email, bcryptHash, new Date().toISOString().split('T')[0], userInviteToken]
    )
    const newUserId = result.insertId
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, newUserId, lang || 'da', ua, ip]
    ).catch(() =>
      pool.query(
        'INSERT INTO sessions (id, user_id, lang, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
        [sessionId, newUserId, lang || 'da']
      )
    )

    // If registered via invite link, auto-connect with inviter + record referral
    if (inviteToken) {
      try {
        let referrerId = null
        let invitationId = null
        let inviteSource = 'link'

        // Check personal invite token (user.invite_token)
        const [inviter] = await pool.query('SELECT id FROM users WHERE invite_token = ?', [inviteToken])
        if (inviter.length > 0) {
          referrerId = inviter[0].id
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, referrerId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [referrerId, newUserId])
        }

        // Check per-email invitation token
        const [invitation] = await pool.query(
          'SELECT id, inviter_id, invite_source FROM invitations WHERE invite_token = ? AND status = ?',
          [inviteToken, 'pending']
        )
        if (invitation.length > 0) {
          referrerId = invitation[0].inviter_id
          invitationId = invitation[0].id
          inviteSource = invitation[0].invite_source || 'email'
          await pool.query('UPDATE invitations SET status = ?, accepted_by = ? WHERE id = ?', ['accepted', newUserId, invitationId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [newUserId, referrerId])
          await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id, mutual_count) VALUES (?, ?, 0)', [referrerId, newUserId])
        }

        // Record referral and award badges to inviter
        if (referrerId) {
          await pool.query(
            'INSERT IGNORE INTO referrals (referrer_id, referred_id, invitation_id, invite_source) VALUES (?, ?, ?, ?)',
            [referrerId, newUserId, invitationId, inviteSource]
          )
          await pool.query('UPDATE users SET referral_count = referral_count + 1 WHERE id = ?', [referrerId])
          await checkAndAwardBadges(referrerId)
          // Notify inviter that their invitation was accepted
          const [[newUser]] = await pool.query('SELECT name FROM users WHERE id = ?', [newUserId]).catch(() => [[null]])
          if (newUser) {
            createNotification(referrerId, 'friend_accepted',
              `${newUser.name} accepterede din invitation og er nu din ven`,
              `${newUser.name} accepted your invitation and is now your friend`,
              newUserId, newUser.name
            )
          }
        }
      } catch (err) {
        console.error('Invite auto-connect error:', err)
      }
    }

    setSessionCookie(res, sessionId)
    res.json({ sessionId, userId: newUserId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or handle already exists' })
    console.error('POST /api/auth/register error:', err.message)
    res.status(500).json({ error: 'Registration failed' })
  }
})


router.post('/auth/forgot-password', strictLimit, validate(schemas.forgotPassword), async (req, res) => {
  const { email, lang } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })

  // Rate limit: max 3 requests per email per hour
  if (!checkForgotRateLimit(email)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  try {
    const [users] = await pool.query(
      'SELECT id, name, password_hash FROM users WHERE email = ?', [email]
    )
    // Always return success to avoid leaking whether the email exists
    if (users.length === 0) return res.json({ ok: true })

    const user = users[0]
    // Generate a cryptographically random token and store its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')
    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
      [hashedToken, user.id]
    )

    const siteBase = process.env.SITE_URL || 'https://fellis.eu'
    const resetUrl = `${siteBase}/?reset_token=${rawToken}`

    if (mailer) {
      const fromAddr = process.env.MAIL_FROM || process.env.MAIL_USER
      const resetStrings = getResetEmailStrings(lang, user.name, resetUrl)
      try {
        await Promise.race([
          mailer.sendMail({
            from: `"Fellis" <${fromAddr}>`,
            to: email,
            subject: resetStrings.subject,
            text: resetStrings.text,
            html: resetStrings.html,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), 10000)),
        ])
      } catch (mailErr) {
        console.error('Reset mail error:', mailErr.message)
        return res.status(502).json({ error: 'email_send_failed' })
      }
    } else {
      // Dev fallback: log the token (never expose in production without MAIL_HOST)
      console.info(`[dev] Password reset link for ${email}: ${resetUrl}`)
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Request failed' })
  }
})


router.post('/auth/reset-password', strictLimit, async (req, res) => {
  const { token, password, lang: resetLang } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
  const resetPolicy = await getPasswordPolicy()
  const resetPwdErrors = validatePasswordStrength(password, resetPolicy, resetLang || 'da')
  if (resetPwdErrors.length > 0) return res.status(400).json({ error: resetPwdErrors.join('. ') })
  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [hashedToken]
    )
    if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset token' })
    const userId = rows[0].id
    const bcryptHash = await bcrypt.hash(password, 10)
    // Update password and clear reset token atomically
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [bcryptHash, userId]
    )
    // Create a new login session
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, resetLang || 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ ok: true, sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' })
  }
})


router.post('/auth/verify-mfa', strictLimit, validate(schemas.verifyMfa), async (req, res) => {
  const { userId, code, lang } = req.body
  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND mfa_code_expires > NOW()',
      [userId]
    )
    if (rows.length === 0) return res.status(400).json({ error: 'Code expired or user not found' })
    const hashedCode = crypto.createHash('sha256').update(String(code)).digest('hex')
    const [valid] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND mfa_code = ?',
      [userId, hashedCode]
    )
    if (valid.length === 0) return res.status(401).json({ error: 'Invalid code' })
    // Clear MFA code and create session
    await pool.query(
      'UPDATE users SET mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?', [userId]
    )
    const sessionId = crypto.randomUUID()
    const ua = req.headers['user-agent'] || null
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    await pool.query(
      'INSERT INTO sessions (id, user_id, lang, expires_at, user_agent, ip_address) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)',
      [sessionId, userId, lang || 'da', ua, ip]
    )
    setSessionCookie(res, sessionId)
    res.json({ sessionId, userId })
  } catch (err) {
    res.status(500).json({ error: 'MFA verification failed' })
  }
})


router.post('/auth/enable-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT phone FROM users WHERE id = ?', [req.userId])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' })
    if (!rows[0].phone) return res.status(400).json({ error: 'A phone number is required to enable MFA' })
    await pool.query('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [req.userId])
    // Audit log: MFA enabled
    await auditLog(req, 'mfa_enable', 'user', req.userId, { status: 'success' })
    res.json({ ok: true, mfa_enabled: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable MFA' })
  }
})


router.post('/auth/disable-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET mfa_enabled = 0, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?',
      [req.userId]
    )
    // Audit log: MFA disabled
    await auditLog(req, 'mfa_disable', 'user', req.userId, { status: 'success' })
    res.json({ ok: true, mfa_enabled: false })
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable MFA' })
  }
})


router.post('/auth/send-enable-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT phone, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.phone) return res.status(400).json({ error: 'No phone number on account' })
    if (user.mfa_enabled) return res.status(400).json({ error: 'MFA already enabled' })
    const rawCode = String(Math.floor(100000 + Math.random() * 900000))
    const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
    await pool.query(
      'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
      [hashedCode, req.userId]
    )
    const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
    if (!smsSent) {
      console.error(`Enable MFA SMS failed to send for user ${req.userId} — 46elks may not be configured`)
      return res.status(503).json({ error: 'SMS service unavailable — could not send verification code' })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send MFA code' })
  }
})


router.post('/auth/confirm-enable-mfa', authenticate, writeLimit, async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'code required' })
  try {
    const [[user]] = await pool.query(
      'SELECT mfa_code, mfa_code_expires, mfa_enabled FROM users WHERE id = ?', [req.userId]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.mfa_enabled) return res.status(400).json({ error: 'MFA already enabled' })
    if (!user.mfa_code || !user.mfa_code_expires) return res.status(400).json({ error: 'No pending code — request a new one' })
    if (new Date(user.mfa_code_expires) < new Date()) return res.status(400).json({ error: 'Code expired' })
    const hashed = crypto.createHash('sha256').update(String(code)).digest('hex')
    if (hashed !== user.mfa_code) return res.status(401).json({ error: 'Invalid code' })
    await pool.query(
      'UPDATE users SET mfa_enabled = 1, mfa_code = NULL, mfa_code_expires = NULL WHERE id = ?',
      [req.userId]
    )
    await auditLog(req, 'mfa_enable', 'user', req.userId, { status: 'success' })
    res.json({ ok: true, mfa_enabled: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm MFA' })
  }
})


router.post('/auth/send-settings-mfa', authenticate, writeLimit, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT phone, mfa_enabled FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.mfa_enabled) return res.status(400).json({ error: 'MFA not enabled' })
    if (!user.phone) return res.status(400).json({ error: 'No phone number on account' })
    const rawCode = String(Math.floor(100000 + Math.random() * 900000))
    const hashedCode = crypto.createHash('sha256').update(rawCode).digest('hex')
    await pool.query(
      'UPDATE users SET mfa_code = ?, mfa_code_expires = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?',
      [hashedCode, req.userId]
    )
    const smsSent = await sendSms(user.phone, `Din Fellis-kode er: ${rawCode} (udløber om 5 minutter)`)
    if (!smsSent) {
      console.error(`Settings MFA SMS failed to send for user ${req.userId} — 46elks may not be configured`)
      return res.status(503).json({ error: 'SMS service unavailable — could not send verification code' })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to send MFA code' })
  }
})


router.post('/auth/logout', authenticate, async (req, res) => {
  const sessionId = getSessionIdFromRequest(req)
  await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId])
  clearSessionCookie(res)
  res.json({ ok: true })
})


router.get('/csrf-token', authenticate, async (req, res) => {
  try {
    const sessionId = getSessionIdFromRequest(req)
    if (!sessionId) return res.status(401).json({ error: 'Not authenticated' })
    const csrfToken = generateCsrfToken(sessionId)
    res.json({ csrfToken })
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate CSRF token' })
  }
})


router.get('/auth/session', authenticate, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, handle, initials, avatar_url, mode, ads_free, is_moderator, onboarding_dismissed, created_at, is_verified, cvr_number, cvr_company_name, phone, email, mobilepay FROM users WHERE id = ?', [req.userId])
    if (users.length === 0) return res.status(404).json({ error: 'User not found' })
    // Compute ads_free dynamically: today must fall within an active earned-day assignment
    // OR an active purchased period — never rely on the static users.ads_free column
    const today = new Date().toISOString().split('T')[0]
    const [[activeRow]] = await pool.query(`
      SELECT (
        (SELECT COUNT(*) FROM adfree_day_assignments
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
        (SELECT COUNT(*) FROM adfree_purchased_periods
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
      ) AS total
    `, [req.userId, today, today, req.userId, today, today]).catch(() => [[{ total: 0 }]])
    const ads_free = (activeRow?.total ?? 0) > 0
    const user = { ...users[0], mode: users[0].mode || 'privat', ads_free, is_admin: users[0].id === 1, is_moderator: Boolean(users[0].is_moderator) || users[0].id === 1 }
    res.json({ user, lang: req.lang })
  } catch (err) {
    res.status(500).json({ error: 'Session check failed' })
  }
})


router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google integration not configured' })
  const state = crypto.randomBytes(16).toString('hex')
  // Store state with 10-minute expiry to validate in callback
  oauthStateTokens.set(state, { provider: 'google', createdAt: Date.now() })
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})


router.get('/auth/google/callback', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.redirect('/?error=google_not_configured')
  const { code, error, state } = req.query
  if (error || !code) return res.redirect('/?error=google_denied')
  // Validate OAuth state to prevent CSRF account-linking attacks
  const stateData = oauthStateTokens.get(state)
  if (!stateData || stateData.provider !== 'google' || Date.now() - stateData.createdAt > 10 * 60 * 1000) {
    oauthStateTokens.delete(state)
    return res.redirect('/?error=google_state_invalid')
  }
  oauthStateTokens.delete(state)
  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/?error=google_token_failed')
    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const gUser = await userRes.json()
    if (!gUser.sub) return res.redirect('/?error=google_userinfo_failed')

    const sessionId = getSessionIdFromRequest(req)
    if (sessionId) {
      // Logged-in user: connect Google to existing account
      const [[sess]] = await pool.query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId])
      if (sess) {
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [gUser.sub, sess.user_id])
        return res.redirect('/?google_connected=1')
      }
    }
    // Not logged in: login or register via Google
    const [[existing]] = await pool.query('SELECT id FROM users WHERE google_id = ?', [gUser.sub])
    let userId
    if (existing) {
      userId = existing.id
    } else if (gUser.email) {
      const [[byEmail]] = await pool.query('SELECT id FROM users WHERE email = ?', [gUser.email])
      if (byEmail) {
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [gUser.sub, byEmail.id])
        userId = byEmail.id
      } else {
        // Create new account
        const handle = (gUser.email.split('@')[0] + Math.floor(Math.random() * 1000)).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30)
        const name = gUser.name || gUser.email.split('@')[0]
        const [ins] = await pool.query(
          'INSERT INTO users (name, handle, email, google_id, avatar_url, interests, created_at) VALUES (?,?,?,?,?,?,NOW())',
          [name, handle, gUser.email, gUser.sub, gUser.picture || null, JSON.stringify([])]
        )
        userId = ins.insertId
      }
    } else {
      return res.redirect('/?error=google_no_email')
    }
    // Create session
    const newSessId = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', [newSessId, userId, expiresAt])
    res.redirect(`/?google_session=${newSessId}`)
  } catch (err) {
    console.error('Google OAuth callback error:', err.message)
    res.redirect('/?error=google_error')
  }
})


router.get('/auth/linkedin', (req, res) => {
  if (!LINKEDIN_CLIENT_ID) return res.status(500).json({ error: 'LinkedIn integration not configured' })
  const state = crypto.randomBytes(16).toString('hex')
  // Store state with 10-minute expiry to validate in callback
  oauthStateTokens.set(state, { provider: 'linkedin', createdAt: Date.now() })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    scope: 'openid profile email',
    state,
  })
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`)
})


router.get('/auth/linkedin/callback', async (req, res) => {
  if (!LINKEDIN_CLIENT_ID) return res.redirect('/?error=linkedin_not_configured')
  const { code, error, state } = req.query
  if (error || !code) return res.redirect('/?error=linkedin_denied')
  // Validate OAuth state to prevent CSRF account-linking attacks
  const liStateData = oauthStateTokens.get(state)
  if (!liStateData || liStateData.provider !== 'linkedin' || Date.now() - liStateData.createdAt > 10 * 60 * 1000) {
    oauthStateTokens.delete(state)
    return res.redirect('/?error=linkedin_state_invalid')
  }
  oauthStateTokens.delete(state)
  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: LINKEDIN_REDIRECT_URI,
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/?error=linkedin_token_failed')
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const lUser = await userRes.json()
    if (!lUser.sub) return res.redirect('/?error=linkedin_userinfo_failed')

    const sessionId = getSessionIdFromRequest(req)
    if (sessionId) {
      const [[sess]] = await pool.query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > NOW()', [sessionId])
      if (sess) {
        await pool.query('UPDATE users SET linkedin_id = ? WHERE id = ?', [lUser.sub, sess.user_id])
        return res.redirect('/?linkedin_connected=1')
      }
    }
    const [[existing]] = await pool.query('SELECT id FROM users WHERE linkedin_id = ?', [lUser.sub])
    let userId
    if (existing) {
      userId = existing.id
    } else if (lUser.email) {
      const [[byEmail]] = await pool.query('SELECT id FROM users WHERE email = ?', [lUser.email])
      if (byEmail) {
        await pool.query('UPDATE users SET linkedin_id = ? WHERE id = ?', [lUser.sub, byEmail.id])
        userId = byEmail.id
      } else {
        const handle = (lUser.email.split('@')[0] + Math.floor(Math.random() * 1000)).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30)
        const [ins] = await pool.query(
          'INSERT INTO users (name, handle, email, linkedin_id, avatar_url, interests, created_at) VALUES (?,?,?,?,?,?,NOW())',
          [lUser.name || lUser.email.split('@')[0], handle, lUser.email, lUser.sub, lUser.picture || null, JSON.stringify([])]
        )
        userId = ins.insertId
      }
    } else {
      return res.redirect('/?error=linkedin_no_email')
    }
    const newSessId = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', [newSessId, userId, expiresAt])
    res.redirect(`/?linkedin_session=${newSessId}`)
  } catch (err) {
    console.error('LinkedIn OAuth callback error:', err.message)
    res.redirect('/?error=linkedin_error')
  }
})


export default router
