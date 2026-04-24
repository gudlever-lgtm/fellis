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
import { fetchEurDkkRate, getMollieClient } from '../helpers.js'

const router = express.Router()

const FEATURE_CATALOG = [
  { id: 'ad_free',        price: 2.99, modes: ['privat', 'private', 'network', 'business'] },
  { id: 'analytics',      price: 4.99, modes: ['privat', 'private', 'network', 'business'] },
  { id: 'profile_boost',  price: 1.99, modes: ['privat', 'private', 'network', 'business'] },
  { id: 'direct_message', price: 1.99, modes: ['privat', 'private', 'network'] },
  { id: 'multi_admin',    price: 3.99, modes: ['business'] },
  { id: 'ad_campaigns',   price: 9.99, modes: ['business'] },
]

router.get('/pricing', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT adfree_price_private, adfree_price_business, ad_price_cpm, boost_price, currency FROM admin_ad_settings WHERE id = 1'
    )
    res.json({
      adfree_price_private: parseFloat(row?.adfree_price_private) || 2.99,
      adfree_price_business: parseFloat(row?.adfree_price_business) || 5.99,
      ad_price_cpm: parseFloat(row?.ad_price_cpm) || 9.99,
      boost_price: parseFloat(row?.boost_price) || 2.99,
      currency: row?.currency || 'EUR',
    })
  } catch (err) {
    console.error('GET /api/pricing error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/currency/eur-dkk', async (_req, res) => {
  try {
    const rate = await fetchEurDkkRate()
    res.json({ rate, base: 'EUR', currency: 'DKK' })
  } catch (err) {
    console.error('GET /api/currency/eur-dkk error:', err.message)
    res.json({ rate: 7.46, base: 'EUR', currency: 'DKK', fallback: true })
  }
})


router.post('/mollie/payment/create', authenticate, async (req, res) => {
  try {
    const { plan, currency: reqCurrency, ad_id: adId, recurring = false, interval = 'monthly' } = req.body || {}
    if (!plan) return res.status(400).json({ error: 'Missing required field: plan' })

    const mollie = await getMollieClient()
    if (!mollie) return res.status(503).json({ error: 'Mollie ikke konfigureret — sæt MOLLIE_API_KEY i server/.env eller i Betalingskonfiguration under Admin' })

    const [[user]] = await pool.query('SELECT id, email, name, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // MobilePay (DKK) is for private individuals only — reject business accounts
    if (reqCurrency === 'DKK' && user.mode === 'business') {
      return res.status(400).json({ error: 'MobilePay kan ikke benyttes til virksomhedsbetalinger. Vælg et betalingskort i stedet.' })
    }

    // Resolve amount from admin_ad_settings
    let resolvedAmount = null
    const [[adS]] = await pool.query('SELECT adfree_price_private, adfree_price_business, adfree_recurring_pct, adfree_annual_discount_pct, ad_price_cpm, ad_recurring_pct, currency FROM admin_ad_settings WHERE id = 1').catch(() => [[null]])
    // If the client explicitly requests DKK (MobilePay), honour it; otherwise use admin-configured currency
    const resolvedCurrency = reqCurrency === 'DKK' ? 'DKK' : (adS?.currency || 'EUR')
    if (plan === 'adfree') {
      const oneTimePrice = parseFloat(user.mode === 'business' ? adS?.adfree_price_business : adS?.adfree_price_private) || 29
      if (recurring && interval === 'annual') {
        const recurringPct = parseInt(adS?.adfree_recurring_pct ?? 100)
        const monthlyPrice = Math.round(oneTimePrice * recurringPct / 100 * 100) / 100
        const annualDiscountPct = parseInt(adS?.adfree_annual_discount_pct ?? 0)
        resolvedAmount = Math.round(monthlyPrice * 12 * (1 - annualDiscountPct / 100) * 100) / 100
      } else if (recurring) {
        const pct = parseInt(adS?.adfree_recurring_pct ?? 100)
        resolvedAmount = Math.round(oneTimePrice * pct / 100 * 100) / 100
      } else {
        resolvedAmount = oneTimePrice
      }
    } else if (plan === 'ad_activation') {
      const oneTimePrice = parseFloat(adS?.ad_price_cpm) || 50
      if (recurring) {
        const pct = parseInt(adS?.ad_recurring_pct ?? 100)
        resolvedAmount = Math.round(oneTimePrice * pct / 100 * 100) / 100
      } else {
        resolvedAmount = oneTimePrice
      }
    }
    if (!resolvedAmount || isNaN(resolvedAmount) || resolvedAmount <= 0) resolvedAmount = 29

    // MobilePay only supports DKK — convert the EUR amount to DKK at the live ECB rate
    if (resolvedCurrency === 'DKK') {
      try {
        const rate = await fetchEurDkkRate()
        resolvedAmount = Math.round(resolvedAmount * rate * 100) / 100
      } catch (err) {
        console.error('EUR→DKK conversion failed, using fallback rate 7.46:', err.message)
        resolvedAmount = Math.round(resolvedAmount * 7.46 * 100) / 100
      }
    }

    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
    const siteUrl = process.env.SITE_URL || origin
    const adIdParam = adId ? `&ad_id=${adId}` : ''
    const recurringParam = recurring ? '&recurring=1' : ''
    const redirectUrl = `${origin}/?mollie_payment=success&plan=${encodeURIComponent(plan)}${adIdParam}${recurringParam}`
    const webhookUrl = `${siteUrl}/api/mollie/payment/webhook`

    // For recurring: get or create a Mollie customer to enable mandate/subscription
    let mollieCustomerId = null
    if (recurring) {
      const [[userRow]] = await pool.query('SELECT mollie_customer_id, email, name FROM users WHERE id = ?', [req.userId])
      mollieCustomerId = userRow?.mollie_customer_id
      if (!mollieCustomerId) {
        const customer = await mollie.customers.create({ name: userRow?.name || 'fellis user', email: userRow?.email || '' })
        mollieCustomerId = customer.id
        await pool.query('UPDATE users SET mollie_customer_id = ? WHERE id = ?', [mollieCustomerId, req.userId]).catch(() => {})
      }
    }

    const paymentParams = {
      amount: { currency: resolvedCurrency, value: resolvedAmount.toFixed(2) },
      description: `fellis.eu — ${plan}${recurring ? ' (abonnement)' : ''}`,
      redirectUrl,
      webhookUrl,
      metadata: { user_id: String(req.userId), plan, recurring: String(!!recurring), interval: recurring ? interval : 'once', ...(adId ? { ad_id: String(adId) } : {}) },
    }
    // MobilePay is only available in DKK — pin the payment method so Mollie skips the method selector
    if (resolvedCurrency === 'DKK') {
      paymentParams.method = 'mobilepay'
    }
    if (recurring && mollieCustomerId) {
      paymentParams.customerId = mollieCustomerId
      paymentParams.sequenceType = 'first'
    }

    const payment = await mollie.payments.create(paymentParams)

    const checkoutUrl = payment._links?.checkout?.href
    if (!checkoutUrl) {
      console.error('POST /api/mollie/payment/create: no checkout URL in response', JSON.stringify(payment._links))
      return res.status(500).json({ error: 'Mollie returnerede ingen checkout-URL. Prøv igen.' })
    }

    // Record the pending payment in the subscriptions table
    await pool.query(
      'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id, recurring) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, payment.id, plan, 'open', adId || null, recurring ? 1 : 0]
    ).catch(() =>
      pool.query('INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status) VALUES (?, ?, ?, ?)',
        [req.userId, payment.id, plan, 'open'])
    )
    // Mark the ad as payment pending immediately when checkout is initiated
    if (plan === 'ad_activation' && adId) {
      await pool.query(
        "UPDATE ads SET payment_status = 'pending' WHERE id = ? AND advertiser_id = ?",
        [adId, req.userId]
      ).catch(() => {})
    }

    res.json({ checkoutUrl, paymentId: payment.id })
  } catch (err) {
    console.error('POST /api/mollie/payment/create error:', err.message, err.stack)
    // Surface Mollie API error details if available
    const mollieMsg = err.message || ''
    res.status(500).json({ error: mollieMsg || 'Server error' })
  }
})


router.post('/mollie/payment/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  // Always respond 200 immediately — Mollie retries if we don't
  res.status(200).send('OK')
  try {
    const id = req.body?.id || req.query?.id
    if (!id || typeof id !== 'string' || !id.startsWith('tr_')) {
      console.warn('Mollie webhook: invalid or missing payment id:', id)
      return
    }

    const mollie = await getMollieClient()
    if (!mollie) { console.error('Mollie webhook: client unavailable'); return }

    const payment = await mollie.payments.get(id)

    // Subscription renewal payments from Mollie have a subscriptionId but no matching row by payment id.
    // Find sub by mollie_subscription_id first, then fall back to mollie_payment_id.
    let sub = null
    if (payment.subscriptionId) {
      const [[bySub]] = await pool.query('SELECT * FROM subscriptions WHERE mollie_subscription_id = ?', [payment.subscriptionId])
      sub = bySub || null
    }
    if (!sub) {
      const [[byPay]] = await pool.query('SELECT * FROM subscriptions WHERE mollie_payment_id = ?', [id])
      sub = byPay || null
    }
    if (!sub) { console.warn('Mollie webhook: no subscription row for payment', id); return }

    const status = payment.status // 'open','pending','authorized','expired','canceled','failed','paid'
    const expiresAt = status === 'paid' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null

    // For renewal payments (subscriptionId present) insert a new row rather than overwriting the original
    if (payment.subscriptionId && sub.mollie_subscription_id) {
      if (status === 'paid') {
        await pool.query(
          'INSERT INTO subscriptions (user_id, mollie_payment_id, plan, status, ad_id, recurring, mollie_subscription_id, expires_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
          [sub.user_id, id, sub.plan, 'paid', sub.ad_id || null, sub.mollie_subscription_id, expiresAt]
        ).catch(() => {})
      }
    } else {
      await pool.query(
        'UPDATE subscriptions SET status = ?, expires_at = ? WHERE mollie_payment_id = ?',
        [status, expiresAt, id]
      )
    }

    if (status === 'paid') {
      const isRecurringFirstPayment = sub.recurring && !sub.mollie_subscription_id
      const adId = sub.ad_id || payment.metadata?.ad_id
      const paidAmount = parseFloat(payment.amount?.value) || null

      if (sub.plan === 'ad_activation') {
        // Activate the ad and extend paid_until
        if (adId) await pool.query(
          "UPDATE ads SET status = 'active', paid_until = DATE_ADD(NOW(), INTERVAL 30 DAY), payment_status = 'paid', paid_amount = ?, paid_at = NOW() WHERE id = ?",
          [paidAmount, adId]
        ).catch(() =>
          pool.query("UPDATE ads SET status = 'active', paid_until = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ?", [adId])
        )
      } else if (sub.plan === 'boost') {
        // Boost the marketplace listing for 7 days
        const listingId = sub.ad_id || payment.metadata?.listing_id
        if (listingId) {
          await pool.query(
            'UPDATE marketplace_listings SET boosted_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?',
            [listingId]
          ).catch(() => {})
          const [[listing]] = await pool.query('SELECT title, user_id FROM marketplace_listings WHERE id = ?', [listingId]).catch(() => [[null]])
          if (listing) {
            createNotification(sub.user_id, 'listing_boosted',
              `Din annonce "${listing.title}" er nu boostet i 7 dage`,
              `Your listing "${listing.title}" is now boosted for 7 days`,
              sub.user_id, null
            )
          }
        }
      } else if (sub.plan === 'post_boost') {
        // Activate the boosted post ad
        const adId = sub.ad_id || payment.metadata?.ad_id
        if (adId) {
          const [[adRow]] = await pool.query('SELECT boosted_post_id FROM ads WHERE id = ?', [adId]).catch(() => [[null]])
          await pool.query(
            "UPDATE ads SET status = 'active', payment_status = 'paid', paid_at = NOW(), paid_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?",
            [adId]
          ).catch(() => {})
          if (adRow?.boosted_post_id) {
            createNotification(sub.user_id, 'post_boosted',
              `Dit opslag er nu boostet i 7 dage`,
              `Your post is now boosted for 7 days`,
              sub.user_id, null
            )
          }
        }
      } else {
        // adfree plan: set flag and record a purchased period
        await pool.query('UPDATE users SET ads_free = 1 WHERE id = ?', [sub.user_id])
        if (sub.plan === 'adfree') {
          const periodStart = new Date().toISOString().split('T')[0]
          const periodEnd = expiresAt ? expiresAt.toISOString().split('T')[0] : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          await pool.query(
            `INSERT INTO adfree_purchased_periods (user_id, start_date, end_date, subscription_id)
             VALUES (?, ?, ?, ?)`,
            [sub.user_id, periodStart, periodEnd, sub.id]
          ).catch(() => {}) // table may not exist on old installs until migration runs
        }
      }

      // After first payment of a recurring plan: create a Mollie Subscription
      if (isRecurringFirstPayment && payment.customerId) {
        try {
          const billingInterval = sub.plan === 'ad_activation' ? '30 days' : (payment.metadata?.interval === 'annual' ? '12 months' : '1 month')
          const interval = billingInterval
          const mollieSubscription = await mollie.customers.subscriptions.create(payment.customerId, {
            amount: { currency: payment.amount.currency, value: payment.amount.value },
            interval,
            description: `fellis.eu — ${sub.plan} (abonnement)`,
            webhookUrl: `${process.env.SITE_URL || 'https://fellis.eu'}/api/mollie/payment/webhook`,
            metadata: { user_id: String(sub.user_id), plan: sub.plan, ...(adId ? { ad_id: String(adId) } : {}) },
          })
          await pool.query(
            'UPDATE subscriptions SET mollie_subscription_id = ? WHERE id = ?',
            [mollieSubscription.id, sub.id]
          ).catch(() => {})
          await pool.query(
            'UPDATE users SET mollie_customer_id = ? WHERE id = ?',
            [payment.customerId, sub.user_id]
          ).catch(() => {})
        } catch (subErr) {
          console.error('Mollie subscription create error:', subErr.message)
        }
      }
    } else if (['expired', 'canceled', 'failed'].includes(status)) {
      if (sub.plan === 'ad_activation' || sub.plan === 'post_boost') {
        const adId = sub.ad_id || payment.metadata?.ad_id
        if (adId) await pool.query(
          "UPDATE ads SET payment_status = 'failed' WHERE id = ? AND payment_status != 'paid'",
          [adId]
        ).catch(() => {})
      } else if (sub.plan !== 'boost') {
        // boost failures have no side-effects to revert
        const [[active]] = await pool.query(
          "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'paid' AND (expires_at IS NULL OR expires_at > NOW()) AND mollie_payment_id != ? LIMIT 1",
          [sub.user_id, id]
        )
        if (!active) {
          await pool.query('UPDATE users SET ads_free = 0 WHERE id = ?', [sub.user_id])
        }
      }
    }
  } catch (err) {
    console.error('POST /api/mollie/payment/webhook error:', err.message)
  }
})


router.get('/mollie/payment/status', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })

    // Get the most recent active or pending subscription (prefer recurring+active)
    const [[sub]] = await pool.query(
      `SELECT plan, status, expires_at, recurring, mollie_subscription_id
       FROM subscriptions WHERE user_id = ?
       ORDER BY recurring DESC, created_at DESC LIMIT 1`,
      [req.userId]
    )

    // Compute ads_free dynamically — only active purchased periods or activated earned-day
    // assignments count. Days sitting in the bank (not yet assigned) do NOT make a user ad-free.
    const today = new Date().toISOString().split('T')[0]
    const [[adFreeRow]] = await pool.query(`
      SELECT (
        (SELECT COUNT(*) FROM adfree_day_assignments
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?) +
        (SELECT COUNT(*) FROM adfree_purchased_periods
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?)
      ) AS total
    `, [req.userId, today, today, req.userId, today, today]).catch(() => [[{ total: 0 }]])
    const ads_free = (adFreeRow?.total ?? 0) > 0

    res.json({
      ads_free,
      plan: sub?.plan || null,
      status: sub?.status || null,
      expires_at: sub?.expires_at || null,
      recurring: Boolean(sub?.recurring),
      has_subscription: !!sub?.mollie_subscription_id,
    })
  } catch (err) {
    console.error('GET /api/mollie/payment/status error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.delete('/mollie/subscription/cancel', authenticate, async (req, res) => {
  try {
    const [[sub]] = await pool.query(
      `SELECT s.*, u.mollie_customer_id FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ? AND s.mollie_subscription_id IS NOT NULL
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.userId]
    )
    if (!sub) return res.status(404).json({ error: 'No active subscription found' })

    const mollie = await getMollieClient()
    if (!mollie) return res.status(503).json({ error: 'Payment provider unavailable' })

    if (sub.mollie_customer_id && sub.mollie_subscription_id) {
      await mollie.customers.subscriptions.cancel(sub.mollie_subscription_id, { customerId: sub.mollie_customer_id })
        .catch(err => console.warn('Mollie subscription cancel warning:', err.message))
    }

    await pool.query(
      "UPDATE subscriptions SET status = 'canceled' WHERE mollie_subscription_id = ?",
      [sub.mollie_subscription_id]
    )

    // Revoke ads_free if no other active subscription remains
    if (sub.plan !== 'ad_activation') {
      const [[active]] = await pool.query(
        "SELECT id FROM subscriptions WHERE user_id = ? AND status = 'paid' AND (expires_at IS NULL OR expires_at > NOW()) AND mollie_subscription_id != ? LIMIT 1",
        [req.userId, sub.mollie_subscription_id]
      )
      if (!active) await pool.query('UPDATE users SET ads_free = 0 WHERE id = ?', [req.userId])
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/mollie/subscription/cancel error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/adfree/bank', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const [rows] = await pool.query(
      'SELECT days_banked, last_updated FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )
    const bankDays = rows.length > 0 ? rows[0].days_banked : 0
    const lastUpdated = rows.length > 0 ? rows[0].last_updated : null
    res.json({ bankDays, lastUpdated })
  } catch (err) {
    console.error('GET /api/adfree/bank error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/adfree/assignments', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { startDate, endDate } = req.query
    const today = new Date().toISOString().split('T')[0]

    // Get earned assignments
    let earnedQuery = 'SELECT id, start_date, end_date, days_used, created_at FROM adfree_day_assignments WHERE user_id = ?'
    const earnedParams = [userId]
    if (startDate) { earnedQuery += ' AND end_date >= ?'; earnedParams.push(startDate) }
    if (endDate) { earnedQuery += ' AND start_date <= ?'; earnedParams.push(endDate) }
    earnedQuery += ' ORDER BY start_date DESC'

    const [earnedRows] = await pool.query(earnedQuery, earnedParams)

    // Get purchased assignments (may not exist on old installs)
    let purchasedRows = []
    try {
      let purchasedQuery = 'SELECT id, start_date, end_date, DATEDIFF(end_date, start_date) + 1 AS days_used, created_at FROM adfree_purchased_periods WHERE user_id = ?'
      const purchasedParams = [userId]
      if (startDate) { purchasedQuery += ' AND end_date >= ?'; purchasedParams.push(startDate) }
      if (endDate) { purchasedQuery += ' AND start_date <= ?'; purchasedParams.push(endDate) }
      purchasedQuery += ' ORDER BY start_date DESC'
      ;[purchasedRows] = await pool.query(purchasedQuery, purchasedParams)
    } catch (e) { /* table may not exist yet */ }

    // Map to response format — use local-time getters to avoid UTC offset shifting dates
    const localDateStr = (d) => {
      if (!d) return null
      const dt = d instanceof Date ? d : new Date(d)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    const toAssignment = (r, source) => ({
      id: r.id,
      source,
      startDate: localDateStr(r.start_date),
      endDate: localDateStr(r.end_date),
      daysUsed: r.days_used,
      createdAt: r.created_at,
    })

    const assignments = [
      ...earnedRows.map(r => toAssignment(r, 'earned')),
      ...purchasedRows.map(r => toAssignment(r, 'purchased')),
    ].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))

    // Find active period (purchased takes priority if multiple)
    let activePeriod = null
    for (const a of assignments) {
      if (a.startDate <= today && today <= a.endDate) {
        if (!activePeriod || a.source === 'purchased') activePeriod = a
      }
    }

    res.json({ assignments, activePeriod })
  } catch (err) {
    console.error('GET /api/adfree/assignments error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/adfree/is-active', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { date } = req.query
    if (!date) return res.status(400).json({ error: 'date parameter required' })

    // Check purchased first (higher priority)
    let purchasedRows = []
    try {
      ;[purchasedRows] = await pool.query(
        `SELECT 1 FROM adfree_purchased_periods WHERE user_id = ? AND start_date <= ? AND end_date >= ?`,
        [userId, date, date]
      )
    } catch (e) { /* table may not exist */ }

    if (purchasedRows.length > 0) {
      return res.json({ isAdFree: true, source: 'purchased' })
    }

    const [earnedRows] = await pool.query(
      `SELECT 1 FROM adfree_day_assignments WHERE user_id = ? AND start_date <= ? AND end_date >= ?`,
      [userId, date, date]
    )

    res.json({ isAdFree: earnedRows.length > 0, source: earnedRows.length > 0 ? 'earned' : null })
  } catch (err) {
    console.error('GET /api/adfree/is-active error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.post('/adfree/assign', authenticate, async (req, res) => {
  try {
    const userId = req.userId
    const { startDate, endDate } = req.body

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required' })
    }

    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must be <= endDate' })
    }

    // Calculate days needed
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysNeeded = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1

    // Check if user has enough days in bank
    const [bankRows] = await pool.query(
      'SELECT days_banked FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )

    const bankDays = bankRows.length > 0 ? bankRows[0].days_banked : 0
    if (bankDays < daysNeeded) {
      return res.status(400).json({
        error: 'Insufficient ad-free days',
        available: bankDays,
        needed: daysNeeded,
      })
    }

    // Create assignment
    const now = new Date()
    const [result] = await pool.query(
      `INSERT INTO adfree_day_assignments (user_id, start_date, end_date, days_used, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, startDate, endDate, daysNeeded, now]
    )

    // Deduct from bank
    await pool.query(
      `UPDATE adfree_days_bank SET days_banked = days_banked - ?, last_updated = NOW()
       WHERE user_id = ?`,
      [daysNeeded, userId]
    )

    // If assignment covers today, set ads_free = 1
    const today = new Date().toISOString().split('T')[0]
    if (startDate <= today && today <= endDate) {
      await pool.query(
        'UPDATE users SET ads_free = 1, adfree_active_until = ? WHERE id = ?',
        [new Date(endDate + ' 23:59:59'), userId]
      )
    }

    // Get updated bank
    const [newBankRows] = await pool.query(
      'SELECT days_banked FROM adfree_days_bank WHERE user_id = ?',
      [userId]
    )
    const newBank = newBankRows.length > 0 ? newBankRows[0].days_banked : 0

    const assignment = {
      id: result.insertId,
      startDate,
      endDate,
      daysUsed: daysNeeded,
      createdAt: now,
    }

    res.json({ success: true, newBank, assignment })
  } catch (err) {
    console.error('POST /api/adfree/assign error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})


router.get('/payment/features', authenticate, async (req, res) => {
  try {
    const [[[user]], [rows]] = await Promise.all([
      pool.query('SELECT mode FROM users WHERE id = ?', [req.userId]),
      pool.query('SELECT feature, active, expires_at FROM user_features WHERE user_id = ? AND active = 1', [req.userId]),
    ])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const mode = user.mode || 'privat'
    const activeMap = {}
    for (const row of rows) activeMap[row.feature] = row
    const features = FEATURE_CATALOG
      .filter(f => f.modes.includes(mode))
      .map(f => ({
        id: f.id,
        price: f.price,
        active: !!activeMap[f.id],
        expires_at: activeMap[f.id]?.expires_at || null,
      }))
    res.json({ features })
  } catch (err) {
    console.error('GET /api/payment/features error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/payment/start', authenticate, async (req, res) => {
  try {
    const { feature } = req.body || {}
    if (!feature) return res.status(400).json({ error: 'Missing field: feature' })
    const catalog = FEATURE_CATALOG.find(f => f.id === feature)
    if (!catalog) return res.status(400).json({ error: 'Unknown feature' })

    const [[user]] = await pool.query('SELECT id, email, name, mode FROM users WHERE id = ?', [req.userId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!catalog.modes.includes(user.mode)) return res.status(403).json({ error: 'Feature not available for your account type' })

    const origin = req.headers.origin || process.env.SITE_URL || 'https://fellis.eu'
    const redirectUrl = `${origin}/?page=features&payment=success&feature=${encodeURIComponent(feature)}`
    const siteUrl = process.env.SITE_URL || origin

    const mollie = await getMollieClient()
    if (!mollie) {
      // Dev/test fallback: activate directly
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      await pool.query(
        `INSERT INTO user_features (user_id, feature, active, expires_at) VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE active = 1, expires_at = ?`,
        [req.userId, feature, expiresAt, expiresAt]
      )
      return res.json({ checkout_url: redirectUrl })
    }

    const amountStr = catalog.price.toFixed(2)
    const payment = await mollie.payments.create({
      amount: { currency: 'EUR', value: amountStr },
      description: `fellis ${feature} subscription`,
      redirectUrl,
      webhookUrl: `${siteUrl}/api/mollie/payment/webhook`,
      metadata: { user_id: String(req.userId), feature },
    })
    res.json({ checkout_url: payment.getCheckoutUrl() })
  } catch (err) {
    console.error('POST /api/payment/start error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/payment/cancel', authenticate, async (req, res) => {
  try {
    const { feature } = req.body || {}
    if (!feature) return res.status(400).json({ error: 'Missing field: feature' })

    const [[row]] = await pool.query(
      'SELECT mollie_subscription_id FROM user_features WHERE user_id = ? AND feature = ?',
      [req.userId, feature]
    )
    if (row?.mollie_subscription_id) {
      try {
        const mollie = await getMollieClient()
        const [[user]] = await pool.query('SELECT mollie_customer_id FROM users WHERE id = ?', [req.userId])
        if (mollie && user?.mollie_customer_id) {
          await mollie.customerSubscriptions.cancel({
            customerId: user.mollie_customer_id,
            id: row.mollie_subscription_id,
          })
        }
      } catch (cancelErr) {
        console.error('Mollie subscription cancel error:', cancelErr.message)
      }
    }

    await pool.query(
      'UPDATE user_features SET active = 0 WHERE user_id = ? AND feature = ?',
      [req.userId, feature]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/payment/cancel error:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
