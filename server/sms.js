/**
 * 46elks SMS helper
 * Docs: https://46elks.com/docs/send-sms
 *
 * Required env vars:
 *   46ELKS_USERNAME  — your 46elks API username (starts with "u")
 *   46ELKS_PASSWORD  — your 46elks API password
 *   46ELKS_SENDER    — sender name shown on recipient's phone (default: fellis.eu)
 */

const API_URL = 'https://api.46elks.com/a1/sms'

/**
 * Send an SMS via 46elks.
 * @param {string} to      Recipient phone number in E.164 format, e.g. "+4512345678"
 * @param {string} message Message body (max 160 chars for single SMS)
 * @returns {Promise<boolean>} true on success, false if unconfigured or failed
 */
export async function sendSms(to, message) {
  const username = process.env['46ELKS_USERNAME']
  const password = process.env['46ELKS_PASSWORD']

  if (!username || !password) {
    console.warn('46elks not configured — SMS sending disabled (set 46ELKS_USERNAME and 46ELKS_PASSWORD)')
    return false
  }

  const sender = process.env['46ELKS_SENDER'] || 'FellisEU'
  const credentials = Buffer.from(`${username}:${password}`).toString('base64')

  const body = new URLSearchParams({ from: sender, to, message })

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!res.ok) {
      const text = await res.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = null }
      console.error(`46elks SMS error — status: ${res.status} ${res.statusText}`)
      console.error('46elks SMS error — response:', parsed ?? text)
      return false
    }
    const data = await res.json().catch(() => null)
    if (data) console.log('46elks SMS sent:', JSON.stringify(data))
    return true
  } catch (err) {
    console.error('46elks SMS fetch error:', err.message)
    return false
  }
}
