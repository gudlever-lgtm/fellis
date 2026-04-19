import nav from './nav.js'
import facebook from './facebook.js'
import blog from './blog.js'
import feed from './feed.js'
import friends from './friends.js'
import messages from './messages.js'
import search from './search.js'
import profile from './profile.js'
import settings from './settings.js'
import notifications from './notifications.js'
import analytics from './analytics.js'
import business from './business.js'
import ads from './ads.js'
import events from './events.js'
import companies from './companies.js'
import jobs from './jobs.js'
import marketplace from './marketplace.js'
import admin from './admin.js'
import reels from './reels.js'
import moderation from './moderation.js'
import referrals from './referrals.js'
import commonUiA from './common-ui-a.js'
import commonUiB from './common-ui-b.js'
import commonUiC from './common-ui-c.js'
import commonErrors from './common-errors.js'
import commonTime from './common-time.js'
import commonNotifications from './common-notifications.js'
import commonKeyboard from './common-keyboard.js'
import onboarding from './onboarding.js'
import forBusiness from './for-business.js'
import privacy from './privacy.js'

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

const segments = [
  nav, feed, friends, messages, search, profile, settings,
  notifications, analytics, business, ads, events, companies,
  jobs, marketplace, admin, reels, moderation, referrals,
  commonUiA, commonUiB, commonUiC, commonErrors, commonTime, commonNotifications, commonKeyboard,
  blog, facebook, onboarding, forBusiness, privacy,
]

export const PT = segments.reduce((acc, seg) => {
  const result = { ...acc }
  for (const lang of Object.keys(seg)) {
    result[lang] = deepMerge(result[lang] || {}, seg[lang] || {})
  }
  return result
}, {})

const _translationsCache = {}

export function getTranslations(lang) {
  if (lang === 'da') return PT.da
  if (lang === 'en') return PT.en
  if (_translationsCache[lang]) return _translationsCache[lang]
  const specific = PT[lang]
  if (!specific) return PT.en
  return (_translationsCache[lang] = { ...PT.en, ...specific })
}
