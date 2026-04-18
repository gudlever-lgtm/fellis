# CLAUDE.md — fellis.eu

# CONFIG v1.0

## CORE
API=request() | AUTH=CSRF | I18N=EXT

## STACK
FE: React19/Vite7
BE: Node/Express
DB: MariaDB
SRV: lighttpd

## RULES

API
- src/api.js → request()
- no fetch() in components

AUTH
- session-based
- X-CSRF-Token required (state change)

I18N
- primary: da
- src/i18n/*
- no inline strings

CURRENCY
- formatPrice()
- EUR, de-DE

MIGRATIONS
- /server/*.sql (incremental)
- npm run migrate

BUILD
- npm run build:
  1. route check
  2. Vite build

---

## Project Overview

**fellis.eu** is a Danish social platform hosted in the EU, built as a privacy-first alternative to mainstream social networks. It is GDPR-compliant and bilingual (Danish/English).

**Stack:**
- **Frontend:** React 19, Vite 7, JavaScript (JSX) — no TypeScript
- **Backend:** Node.js (ESM), Express 4, MySQL2/MariaDB
- **Database:** MariaDB 11.8+ / MySQL 8+
- **Web server:** lighttpd 1.4.46+ — serves static files, reverse-proxies `/api` and `/uploads` to Node.js, handles SPA fallback and TLS
- **Auth:** Session-based (`X-Session-Id` header + localStorage), Google / LinkedIn OAuth
- **Payments:** Mollie (subscriptions, ad payments, ad-free tier)
- **File uploads:** Multer (images/media)
- **Email:** Nodemailer (optional, only when `MAIL_HOST` is configured)
- **SMS:** 46elks (optional, SMS MFA)
- **AI:** Mistral AI (optional, CV + cover letter generation)

---

## Repository Structure

```
fellis/
├── src/                    # Frontend React app (Vite root)
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # Root component: routing, session management, GDPR consent
│   ├── Landing.jsx         # Unauthenticated landing/login/register page
│   ├── Platform.jsx        # Main authenticated app shell (all pages)
│   ├── Analytics.jsx       # Business analytics dashboard component
│   ├── Reels.jsx           # Short-video reels page
│   ├── InterestGraphPage.jsx  # Interest signal visualization page
│   ├── BusinessDirectory.jsx  # Business discovery and follow page
│   ├── AdManager.jsx       # Ad campaign management for business accounts
│   ├── ExplorePage.jsx     # Explore/discovery page (trending, suggested)
│   ├── PaymentSuccess.jsx  # Mollie payment success handler
│   ├── PaymentFailed.jsx   # Mollie payment failure handler
│   ├── api.js              # All API client functions (single source of truth)
│   ├── data.js             # Mock/fallback data + shared utilities (nameToColor, getInitials, PT translations for shared/global strings)
│   ├── i18n/               # Segmented translation files (one file per feature/page)
│   │   ├── index.js        # Merges all segment files into a single PT-compatible object
│   │   └── *.js            # Feature segments (e.g. feed.js, profile.js, settings.js, marketplace.js …)
│   ├── App.css             # Global styles
│   ├── index.css           # Base CSS reset/fonts
│   ├── index.html          # HTML template (Vite entry)
│   ├── components/         # Shared UI components
│   │   ├── AdBanner.jsx          # Platform ad display
│   │   ├── BadgeToast.jsx        # Badge achievement notification toast
│   │   ├── BusinessBadge.jsx     # Business account indicator badge
│   │   ├── BusinessCard.jsx      # Business profile card
│   │   ├── LocationAutocomplete.jsx  # Location search input
│   │   ├── ModeGate.jsx          # Feature gate by account mode (privat/business)
│   │   ├── StoryBar.jsx          # Stories timeline bar
│   │   └── easter-eggs/          # Easter egg components (ChuckBanner, MatrixRain, PartyConfetti, RickRoll, RiddleBanner)
│   ├── hooks/              # Custom React hooks
│   │   ├── useEasterEggs.js      # Easter egg state management
│   │   ├── useKonamiCode.js      # Konami code detection
│   │   ├── useKeySequence.js     # Key sequence detection
│   │   ├── useLongPress.js       # Long press gesture
│   │   ├── useTapCount.js        # Multiple tap detection
│   │   ├── useScrollHold.js      # Scroll hold detection
│   │   └── useAvatarClick.js     # Avatar click interaction
│   ├── badges/             # Badge system
│   │   ├── badgeDefinitions.js   # Badge catalogue
│   │   └── badgeEngine.js        # Badge evaluation logic
│   └── utils/
│       └── currency.js     # formatPrice() helper (EUR, de-DE locale)
├── server/                 # Backend Express server (separate Node project)
│   ├── index.js            # Main Express server — all API routes defined here
│   ├── db.js               # MySQL2 connection pool (lazy proxy)
│   ├── sms.js              # 46elks SMS service helper
│   ├── migrate.js          # Migration runner (tracks and applies migrate-*.sql in order)
│   ├── run-migrations.js   # CI/startup migration executor
│   ├── schema.sql          # Full database schema (initial setup)
│   ├── seed.js             # Database seed script (demo data)
│   ├── seed-bots.js        # Bot/fake-user seeder
│   ├── cleanup-bots.js     # Remove bot accounts
│   ├── cleanup-ads.js      # Remove expired ad data
│   ├── cleanup-jobs.js     # Remove stale job listings
│   ├── cleanup-marketplace.js  # Remove stale marketplace listings
│   ├── import-keyword-lists.js # Import moderation keyword filters
│   ├── migrate-bcrypt-passwords.js  # One-time bcrypt password migration script
│   ├── migrate-*.sql       # Incremental database migrations (49 files)
│   ├── package.json        # Server-only dependencies
│   └── .env.example        # Environment variable template
├── tests/
│   └── check-api-routes.js # Static API route checker (runs on build)
├── assets/                 # Compiled frontend output (generated by Vite build)
├── public/
│   └── sw.js               # Service worker (PWA shell caching)
├── index.html              # Root HTML (served in production)
├── package.json            # Frontend dependencies + npm scripts
├── vite.config.js          # Vite configuration
├── eslint.config.js        # ESLint 9 flat config
└── resolve-merge.py        # Utility script for resolving merge conflicts
```

---

## Development Workflow

### Prerequisites
- Node.js (with ESM support)
- MariaDB 11.8+ or MySQL 8+

### Setup

**Frontend:**
```bash
npm install          # from repo root
npm run dev          # Vite dev server (default: http://localhost:5173)
```

**Backend:**
```bash
cd server
cp .env.example .env # fill in DB credentials
npm install
npm run start        # node --env-file=.env index.js (port 3001 by default)
```

**Database:**
```bash
# Initial setup
mysql -u root < server/schema.sql

# Apply all migrations (idempotent — safe to re-run)
cd server && npm run migrate

# Seed with demo data
cd server && npm run seed
```

### Environment Variables (`server/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | _(empty)_ |
| `DB_NAME` | Database name | `fellis_eu` |
| `PORT` | Server port | `3001` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID (sign-in + photo picker) | _(optional)_ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | _(optional)_ |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL | `https://fellis.eu/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth Client ID (sign-in + account linking) | _(optional)_ |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth Client Secret | _(optional)_ |
| `LINKEDIN_REDIRECT_URI` | LinkedIn OAuth callback URL | `https://fellis.eu/api/auth/linkedin/callback` |
| `MAIL_HOST` | SMTP host for email sending | _(optional)_ |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_SECURE` | Use TLS | `false` |
| `MAIL_USER` | SMTP username | _(optional)_ |
| `MAIL_PASS` | SMTP password | _(optional)_ |
| `MAIL_FROM` | From address for outgoing emails | _(optional)_ |
| `SITE_URL` | Base URL for reset links, invite links, Mollie webhooks | `https://fellis.eu` |
| `46ELKS_USERNAME` | 46elks API username (SMS MFA) | _(optional)_ |
| `46ELKS_PASSWORD` | 46elks API password (SMS MFA) | _(optional)_ |
| `46ELKS_SENDER` | SMS sender name/number | `fellis.eu` |
| `UPLOADS_DIR` | Media upload directory | `/var/www/fellis.eu/uploads` |
| `MISTRAL_API_KEY` | Mistral AI key for CV/cover letter generation (console.mistral.ai) | _(optional, falls back to template)_ |
| `MOLLIE_API_KEY` | Mollie payment API key (ad payments, subscriptions, ad-free purchases) | _(optional)_ |
| `NODE_ENV` | Set to `production` to enable production-only behaviour | _(optional)_ |
| `CSRF_SECRET` | Secret for CSRF token signing — auto-generated on first start if unset | _(auto)_ |

The server reads `.env` manually at startup (not via `--env-file`) for PM2 compatibility.

---

## Production Server (lighttpd)

fellis.eu is served by **lighttpd** as both a static file server and a reverse proxy to the Node.js backend. The configuration lives in [`lighttpd.conf`](../lighttpd.conf) at the repo root.

### Routing rules

| Path | Handled by |
|------|-----------|
| `/api/*` | Proxied to Node.js `localhost:3001` |
| `/uploads/*` | Proxied to Node.js `localhost:3001` |
| `/assets/*` | Static files — `Cache-Control: immutable, max-age=31536000` |
| Everything else | Fallback to `/index.html` (React SPA routing) |

### Key configuration notes

- **Module order matters:** `mod_proxy` must be listed before `mod_rewrite` so proxy rules are evaluated before URL rewrites.
- **SSE streaming:** `server.stream-response-body = 2` prevents lighttpd from buffering Server-Sent Events. The `/api/sse` path additionally sets `proxy.read-timeout = 600`.
- **SPA fallback:** `url.rewrite-if-not-file = ( "^/.*" => "/index.html" )` handles all React Router paths.
- **chat.fellis.eu:** A `$HTTP["host"]` vhost block in the same config serves the chat app from `/var/www/fellis.eu/chat/dist/` using the same Node.js backend.

### Enabling HTTPS

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/fellis.eu -d fellis.eu -d www.fellis.eu
# Then uncomment the $SERVER["socket"] == ":443" block in lighttpd.conf
```

### Required modules

```bash
sudo lighttpd-enable-mod proxy rewrite compress setenv accesslog
lighttpd -t -f /etc/lighttpd/lighttpd.conf   # validate before reload
sudo systemctl reload lighttpd
```

### Deploy checklist

1. `npm run build` — builds frontend into `assets/` + updates `index.html`
2. Sync `index.html` and `assets/` to `/var/www/fellis.eu/`
3. `cd server && npm run migrate` — apply any pending DB migrations
4. Restart/reload the Node.js backend (PM2: `pm2 reload fellis`)
5. `sudo systemctl reload lighttpd` if the config changed

---

## Build & Test

```bash
# Run the API route checker (validates all client calls have matching server routes)
npm test

# Build for production (runs API route check first, then Vite build)
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

### Build Output
Vite builds from `src/` as root into `assets/` at the repo root:
- JS: `assets/app-[hash].js`
- CSS: `assets/[name]-[hash].css`
- `emptyOutDir: false` — preserves existing files in root

---

## Key Conventions

### Language & Bilingualism
- The platform is fully bilingual: **Danish (`da`)** and **English (`en`)**
- Language preference stored in `localStorage` as `fellis_lang`
- Database stores bilingual content in parallel columns: `text_da` / `text_en`, `bio_da` / `bio_en`, `time_da` / `time_en`
- UI string translations live in **segmented files** under `src/i18n/` — one file per feature/page (e.g. `feed.js`, `profile.js`, `settings.js`, `marketplace.js`)
- Each segment file exports a `{ da: { … }, en: { … } }` object covering only the strings for that feature
- `src/i18n/index.js` deep-merges all segment files and re-exports a single `PT` object so existing `const t = PT[lang]` usage continues to work unchanged
- Global/shared strings that are used across many features stay in `data.js` under `PT` as before; page-specific strings go in the relevant segment file
- Default language is Danish (`da`)
- **Never hardcode UI strings inline.** Do NOT write `lang === 'da' ? 'Dansk tekst' : 'English text'` in components — always add a key to the appropriate segment file (or `data.js` if truly global) and reference it as `t.keyName` (where `const t = PT[lang]`)
- When adding strings for a new feature, create `src/i18n/<feature>.js` and import it in `src/i18n/index.js`
- The only accepted exceptions are: locale strings for JS date APIs (`'da-DK'`/`'en-US'`), bilingual DB field selectors (`.text_da`/`.text_en`), and large long-form content blocks (privacy policy, about page)

### Currency Formatting
- All prices are displayed in **EUR** using the `formatPrice()` helper from `src/utils/currency.js`
- Uses `de-DE` locale: `1.234,56 €`
- **Never** hardcode currency symbols or use `.toFixed(2) + ' DKK'` — always use `formatPrice(amount)`
- Migration `server/migrate-currency.sql` adds `currency='EUR'` default and `price_eur` column to marketplace

### Authentication
- Sessions are stored server-side in the `sessions` DB table (30-day expiry)
- Session ID is in the `fellis_sid` HTTP-only cookie (set by server, sent automatically by browser)
- For multipart/FormData requests, use `formHeaders()` (not `headers()`) to avoid sending `null` as a header value

### CSRF Protection
- All state-changing requests (POST/PUT/PATCH/DELETE) require an `X-CSRF-Token` header
- The CSRF token is HMAC-SHA256(sessionId, CSRF_SECRET) — fetched via `GET /api/csrf-token` after login
- The token is stored in `localStorage` as `fellis_csrf_token` and read by `getCsrfToken()` in `api.js`
- `CSRF_SECRET` must be stable across restarts — it is auto-generated on first start and persisted to `server/.env`
- Pre-auth endpoints (login, register, forgot-password, reset-password, verify-mfa, `/api/visit`) are exempt from CSRF
- The CSRF token must be fetched and stored **before** the platform mounts — both `handleEnterPlatform` and the session-restore path in `App.jsx` await `apiGetCsrfToken()` before calling `setView('platform')`

### API Layer (`src/api.js`)
- **Single source of truth** for all API calls — all `fetch()` calls go through the `request()` helper
- `request()` returns `null` when the server is unreachable (demo/offline mode), never throws on network errors
- `request()` automatically includes the CSRF token via `headers()` — never bypass it for state-changing calls
- For file uploads (avatar, media), call `fetch()` directly with `formHeaders()` — do not use the `request()` helper
- The `VITE_API_URL` env var allows pointing the frontend at a different backend origin
- **Always add new API functions to this file** — never call `fetch()` directly from components
- In `Platform.jsx`, legacy raw `fetch()` calls use the local `csrfFetch()` helper (defined at top of file) which injects the CSRF token — new code should use `api.js` functions instead

### API Route Consistency
- `tests/check-api-routes.js` runs automatically before every build
- It compares all `request(url)` calls in `src/api.js` against routes registered in `server/index.js`
- **Every new API endpoint needs both:** a route in `server/index.js` AND an exported function in `src/api.js`
- Template literal params like `${id}` are normalised to `:param` for comparison

### React Components
- All pages are rendered inside `Platform.jsx` — it manages the `page` state and renders each section conditionally
- `App.jsx` handles: session validation on mount, OAuth callback parsing, invite token handling, GDPR consent dialog, routing between `Landing` and `Platform`
- `AppRoot` in `App.jsx` handles the `/privacy` public route (no auth required)
- Inline styles (`style={{ ... }}`) are used extensively — follow the existing `const s = { ... }` pattern for style objects
- No external CSS framework or component library — all styling is custom

### Mock / Fallback Data
- `src/data.js` provides fallback mock data when the server is unavailable
- Components should gracefully degrade to mock data when API calls return `null`
- `CURRENT_USER`, `FRIENDS`, `POSTS`, etc. are the mock constants

### GDPR Compliance
- Consent is tracked in the DB — `apiGiveConsent()`, `apiWithdrawConsent()`, `apiGetConsentStatus()`
- Account deletion (`apiDeleteAccount()`) and data export (`apiExportData()`) endpoints must remain functional
- Never store sensitive data in localStorage beyond session ID and language preference

### ESLint Rules
- Config: ESLint 9 flat config (`eslint.config.js`)
- `no-unused-vars` is an **error**, except for names matching `/^[A-Z_]/` (constants/components)
- React Hooks rules enforced via `eslint-plugin-react-hooks`
- React Refresh rules enforced via `eslint-plugin-react-refresh`

---

## Database Schema Overview

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email/password + Google/LinkedIn OAuth) |
| `sessions` | Auth sessions (30-day expiry) |
| `friendships` | Bidirectional friend connections |
| `friend_requests` | Pending/accepted/declined friend requests |
| `user_blocks` | Blocked user pairs |
| `posts` | Feed posts (bilingual text + JSON media array); `user_mode` column records author's mode at creation time for feed separation |
| `post_likes` | Like tracking per user/post |
| `post_views` | View count per post |
| `comments` | Post comments (bilingual) |
| `comment_reactions` | Reactions on individual comments |
| `stories` | 24-hour ephemeral story posts |
| `story_views` | Story view tracking |
| `reels` | Short-video reel posts |
| `reel_likes` | Like tracking per reel |
| `reel_comments` | Comments on reels |
| `messages` | Legacy direct messages |
| `conversations` | Group/DM conversation threads |
| `conversation_participants` | Per-user membership + mute state |
| `invitations` | Invite links for bringing new users |
| `notifications` | Per-user notification log |
| `notification_preferences` | Per-user notification opt-in/out settings |
| `marketplace_listings` | Marketplace item listings (EUR pricing) |
| `events` | Platform events |
| `event_rsvps` | Per-user RSVP status per event |
| `calendar_reminders` | Personal calendar reminders |
| `jobs` | Job listings |
| `job_applications` | Applications per job per user |
| `cv_experience` | Work experience entries per user |
| `cv_education` | Education entries per user |
| `cv_languages` | Language proficiency entries per user |
| `companies` | Company profiles |
| `company_members` | Company membership + role |
| `company_followers` | Company follow relationships |
| `company_posts` | Posts authored by companies |
| `company_leads` | CRM-style lead tracking per company |
| `contact_notes` | Personal notes on other users |
| `skills` | User skills |
| `skill_endorsements` | Skill endorsements between users |
| `ads` | Ad campaigns |
| `ad_impressions` | Impression tracking per ad per user |
| `ad_clicks` | Click tracking per ad |
| `mollie_payments` | Payment records from Mollie |
| `interest_categories` | Admin-managed interest category taxonomy |
| `user_interests` | Per-user interest selections |
| `interest_signals` | Raw behavioural signals for interest graph |
| `interest_scores` | Computed interest scores per user |
| `badges` | Badge definitions |
| `badge_earned` | Per-user earned badges |
| `referrals` | Referral tracking per invite |
| `moderation_reports` | User-submitted content reports |
| `moderation_actions` | Admin/moderator action log |
| `keyword_filters` | Moderation keyword list |
| `audit_log` | Admin audit trail |
| `user_settings` | Per-user settings (dark mode, notification prefs, etc.) |

### Migrations
- Schema changes use standalone `server/migrate-*.sql` files (49 files total)
- `server/migrate.js` tracks which migrations have been applied and runs pending ones in order
- `server/run-migrations.js` can be called at deploy/startup to auto-apply pending migrations
- Use the npm scripts instead of running SQL manually:

```bash
cd server
npm run migrate:status    # see what's applied and what's pending
npm run migrate:dry-run   # preview what would run
npm run migrate           # apply all pending migrations
```

---

## Platform Features

The `Platform.jsx` component renders these pages (controlled by `page` state):

- **feed** — Post creation, feed with reactions, comments, media, link previews, scheduled posts; Community/Business mode toggle filters feed via `GET /api/feed?mode=privat|business`
- **friends** — Friend list, friend requests, user search, invite system, blocking
- **messages** — Conversations (DM + group chats), mute, rename, leave
- **profile** — User profile, avatar upload, bio, skills, interests, GDPR data tools
- **edit-profile** — Extended profile editor
- **settings** — Privacy, sessions, notifications, language, dark mode, billing/subscription
- **marketplace** — Listings with categories, location filter, boost, EUR pricing
- **events** — Event creation, RSVP, cover image
- **calendar** — Personal calendar with event view and reminders
- **jobs** — Job listings, applications, saved jobs, tracked jobs, job sharing
- **cv** — AI-assisted CV builder (experience, education, languages, cover letter generation)
- **reels** — Short-video reel creation, like, comment (`Reels.jsx`)
- **stories** — 24-hour ephemeral story posts (via `StoryBar.jsx`)
- **explore** — Trending hashtags, suggested posts, discovery feed (`ExplorePage.jsx`)
- **search** — Global search across posts, users, companies
- **companies** — Company profiles, members, followers, posts, leads
- **business-directory** — Browse and follow businesses (`BusinessDirectory.jsx`)
- **ad-manager** — Ad campaign management for business accounts (`AdManager.jsx`)
- **interest-graph** — Interest signal visualization and score tuning (`InterestGraphPage.jsx`)
- **analytics** — Business analytics dashboard (profile views, engagement, post insights)
- **visitor-stats** — Per-profile visitor analytics
- **notifications** — Notification feed and preferences
- **badges** — Earned badges and achievement progress
- **referrals** — Referral dashboard and leaderboard
- **moderation** — Moderation queue, keyword filters, user actions (moderators only)
- **admin** — Admin settings, platform stats, environment status, feed weight config

### User Modes
- **privat** — Standard personal account mode
- **business** — Business account mode (unlocks analytics, endorsements, profile views, ads, leads)
- Stored in `localStorage` as `fellis_mode` and synced to server via `PATCH /api/me/mode`

### Feed Mode Separation
- Every post stores `user_mode` (ENUM `'privat'`/`'business'`) at INSERT time via `(SELECT mode FROM users WHERE id = ?)` — records the author's mode at the moment of posting
- `GET /api/feed` accepts optional `?mode=privat|business`; returns 400 for any other value; omitting it returns the original mixed feed (backward-compatible)
- The frontend (`FeedPage` in `Platform.jsx`) defaults to the current user's own mode and renders a two-tab toggle ("Fællesskab" / "Erhverv" in Danish, "Community" / "Business" in English) — switching resets the cursor and reloads
- Migration: `server/migrate-feed-mode-separation.sql` (adds column, backfills, adds composite index on `user_mode, created_at`)
- Translation keys: `feedModePrivat` / `feedModeBusiness` in `src/i18n/feed.js`

### Easter Eggs
Five hidden interactions are implemented (see `src/components/easter-eggs/` and `src/hooks/`):
- Konami code → party confetti
- Long-press avatar → Chuck Norris joke
- Multiple rapid taps → Matrix rain
- Key sequence → riddle banner
- Specific scroll hold → Rick Roll
Admin can configure which are active via `PUT /api/admin/easter-eggs/config`.

---

## Git Branches

Development follows a `claude/` branch naming convention:
- Feature branches: `claude/<description>-<session-id>`
- Push with: `git push -u origin <branch-name>`
