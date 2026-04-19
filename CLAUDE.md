# CONFIG v1.0

## CORE
API=request() | AUTH=CSRF | I18N=EXT

## STACK
FE: React19/Vite7 BE: Node/Express DB: MariaDB SRV: lighttpd

## TASKS
- Keep tasks small and focused — one feature or fix at a time
- Never trigger `npm run build`, `npm run migrate`, or `pm2 reload` automatically
- These are manual steps run by the developer after review
- Do not chain multiple long-running commands in a single task

## RULES

### API
- `src/api.js` → `request()`
- no `fetch()` in components

### AUTH
- session-based
- `X-CSRF-Token` required (state change)

### I18N
- primary: `da`
- `src/i18n/*`
- no inline strings

### CURRENCY
- `formatPrice()`
- EUR, de-DE

### MIGRATIONS
- `/server/*.sql` (incremental)
- `npm run migrate` — run manually by developer, never triggered by Claude

### BUILD
- `npm run build` — run manually by developer, never triggered by Claude
- Build steps: route check → Vite build
- Verify manually after task completion

### GIT
- Always push to `main`
- `git push -u origin main`
- Do not create feature branches unless explicitly asked

### CONTEXT-MODE
- Use `ctx_batch_execute()` first when gathering data (multiple ops, one call)
- Use `ctx_search()` to query previously indexed content
- Use `ctx_execute()` to process large files/output — never read raw data into context to analyze it mentally
- Use `ctx_fetch_and_index()` instead of WebFetch for all URLs
- Never use `curl`, `wget`, or inline HTTP — route through `ctx_execute()`
- Write analysis scripts with `console.log()` for only the result, not full data
- Response length: ≤500 words; artifacts go to files, not inline output

---

## Project Overview
fellis.eu is a Danish social platform hosted in the EU, built as a privacy-first alternative to mainstream social networks. It is GDPR-compliant and bilingual (Danish/English).

## Stack

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

## Development Workflow

### Context Mode (Claude Code plugin)
Reduces context window usage by ~98% via sandboxed execution, FTS5/BM25 search, and session continuity across compactions.

Install once (global, per developer):
```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```
Verify: `/context-mode:ctx-doctor`

With hooks active (Claude Code native): ~98% context savings.
Without hooks (routing rules only): ~60% savings.

### Prerequisites
- Node.js (with ESM support)
- MariaDB 11.8+ or MySQL 8+

### Setup

Frontend:
```
npm install          # from repo root
npm run dev          # Vite dev server (default: http://localhost:5173)
```

Backend:
```
cd server
cp .env.example .env # fill in DB credentials
npm install
npm run start        # node --env-file=.env index.js (port 3001 by default)
```

Database:
```
# Initial setup
mysql -u root < server/schema.sql

# Apply all migrations (idempotent — safe to re-run)
cd server && npm run migrate

# Seed with demo data
cd server && npm run seed
```

## Environment Variables (`server/.env`)

| Variable | Description | Default |
|---|---|---|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | (empty) |
| `DB_NAME` | Database name | `fellis_eu` |
| `PORT` | Server port | `3001` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | (optional) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | (optional) |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL | `https://fellis.eu/api/auth/google/callback` |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth Client ID | (optional) |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth Client Secret | (optional) |
| `LINKEDIN_REDIRECT_URI` | LinkedIn OAuth callback URL | `https://fellis.eu/api/auth/linkedin/callback` |
| `MAIL_HOST` | SMTP host | (optional) |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_SECURE` | Use TLS | `false` |
| `MAIL_USER` | SMTP username | (optional) |
| `MAIL_PASS` | SMTP password | (optional) |
| `MAIL_FROM` | From address | (optional) |
| `SITE_URL` | Base URL | `https://fellis.eu` |
| `46ELKS_USERNAME` | 46elks API username | (optional) |
| `46ELKS_PASSWORD` | 46elks API password | (optional) |
| `46ELKS_SENDER` | SMS sender name/number | `fellis.eu` |
| `UPLOADS_DIR` | Media upload directory | `/var/www/fellis.eu/uploads` |
| `MISTRAL_API_KEY` | Mistral AI key | (optional) |
| `MOLLIE_API_KEY` | Mollie payment API key | (optional) |
| `NODE_ENV` | Set to `production` for production behaviour | (optional) |
| `CSRF_SECRET` | CSRF token signing secret | (auto) |

The server reads `.env` manually at startup (not via `--env-file`) for PM2 compatibility.

## Production Server (lighttpd)

### Routing rules

| Path | Handled by |
|---|---|
| `/api/*` | Proxied to Node.js `localhost:3001` |
| `/uploads/*` | Proxied to Node.js `localhost:3001` |
| `/assets/*` | Static files — `Cache-Control: immutable, max-age=31536000` |
| Everything else | Fallback to `/index.html` (React SPA routing) |

### Key configuration notes
- Module order matters: `mod_proxy` must be listed before `mod_rewrite`
- SSE streaming: `server.stream-response-body = 2` prevents lighttpd from buffering Server-Sent Events. `/api/sse` sets `proxy.read-timeout = 600`
- SPA fallback: `url.rewrite-if-not-file = ( "^/.*" => "/index.html" )`
- chat.fellis.eu: `$HTTP["host"]` vhost block serves chat from `/var/www/fellis.eu/chat/dist/`

### Deploy checklist
1. `npm run build` — builds frontend into `assets/` + updates `index.html`
2. Sync `index.html` and `assets/` to `/var/www/fellis.eu/`
3. `cd server && npm run migrate` — apply any pending DB migrations
4. `pm2 reload fellis` — restart Node.js backend
5. `sudo systemctl reload lighttpd` if the config changed

## Build & Test

```
# Run the API route checker
npm test

# Build for production (runs API route check first, then Vite build)
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

## Key Conventions

### Language & Bilingualism
- Fully bilingual: Danish (`da`) and English (`en`)
- Language preference stored in `localStorage` as `fellis_lang`
- DB stores bilingual content in parallel columns: `text_da` / `text_en`, `bio_da` / `bio_en`
- UI strings in `src/i18n/` — one file per feature/page
- Each segment exports `{ da: { … }, en: { … } }`
- `src/i18n/index.js` deep-merges all segments into a single `PT` object
- Global/shared strings stay in `data.js` under `PT`; page-specific strings go in the relevant segment file
- Default language: Danish (`da`)
- Never hardcode UI strings inline — always use `t.keyName` where `const t = PT[lang]`
- Only accepted exceptions: locale strings for JS date APIs (`'da-DK'`/`'en-US'`), bilingual DB field selectors, large long-form content blocks

### Currency Formatting
- All prices in EUR via `formatPrice()` from `src/utils/currency.js`
- Uses `de-DE` locale: `1.234,56 €`
- Never hardcode currency symbols or use `.toFixed(2)`

### Authentication
- Sessions stored server-side in `sessions` DB table (30-day expiry)
- Session ID in `fellis_sid` HTTP-only cookie
- For multipart/FormData requests, use `formHeaders()` (not `headers()`)

### CSRF Protection
- All state-changing requests (POST/PUT/PATCH/DELETE) require `X-CSRF-Token` header
- Token is HMAC-SHA256(sessionId, CSRF_SECRET) — fetched via `GET /api/csrf-token` after login
- Stored in `localStorage` as `fellis_csrf_token`, read by `getCsrfToken()` in `api.js`
- `CSRF_SECRET` must be stable across restarts
- Pre-auth endpoints are exempt from CSRF
- CSRF token must be fetched before platform mounts

### API Layer (`src/api.js`)
- Single source of truth for all API calls — all `fetch()` calls go through `request()`
- `request()` returns `null` when server is unreachable (demo/offline mode)
- `request()` automatically includes CSRF token via `headers()`
- For file uploads (avatar, media), call `fetch()` directly with `formHeaders()`
- Always add new API functions to this file — never call `fetch()` directly from components

### API Route Consistency
- `tests/check-api-routes.js` runs automatically before every build
- Every new API endpoint needs both: a route in `server/index.js` AND an exported function in `src/api.js`

### React Components
- All pages rendered inside `Platform.jsx` — manages `page` state
- `App.jsx` handles: session validation, OAuth callbacks, invite tokens, GDPR consent, routing
- Inline styles (`style={{ ... }}`) used extensively — follow `const s = { ... }` pattern
- No external CSS framework — all styling is custom

### GDPR Compliance
- Consent tracked in DB — `apiGiveConsent()`, `apiWithdrawConsent()`, `apiGetConsentStatus()`
- Account deletion and data export endpoints must remain functional
- Never store sensitive data in localStorage beyond session ID and language preference

### ESLint Rules
- ESLint 9 flat config (`eslint.config.js`)
- `no-unused-vars` is an error, except names matching `/^[A-Z_]/`
- React Hooks and React Refresh rules enforced

## Database Schema Overview

| Table | Purpose |
|---|---|
| `users` | User accounts (email/password + Google/LinkedIn OAuth) |
| `sessions` | Auth sessions (30-day expiry) |
| `friendships` | Bidirectional friend connections |
| `friend_requests` | Pending/accepted/declined friend requests |
| `user_blocks` | Blocked user pairs |
| `posts` | Feed posts (bilingual text + JSON media array); `user_mode` records author's mode |
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
| `invitations` | Invite links |
| `notifications` | Per-user notification log |
| `notification_preferences` | Per-user notification opt-in/out |
| `marketplace_listings` | Marketplace item listings (EUR pricing) |
| `events` | Platform events |
| `event_rsvps` | Per-user RSVP status |
| `calendar_reminders` | Personal calendar reminders |
| `jobs` | Job listings |
| `job_applications` | Applications per job per user |
| `cv_experience` | Work experience entries |
| `cv_education` | Education entries |
| `cv_languages` | Language proficiency entries |
| `companies` | Company profiles |
| `company_members` | Company membership + role |
| `company_followers` | Company follow relationships |
| `company_posts` | Posts authored by companies |
| `company_leads` | CRM-style lead tracking |
| `contact_notes` | Personal notes on other users |
| `skills` | User skills |
| `skill_endorsements` | Skill endorsements between users |
| `ads` | Ad campaigns |
| `ad_impressions` | Impression tracking per ad per user |
| `ad_clicks` | Click tracking per ad |
| `mollie_payments` | Payment records from Mollie |
| `interest_categories` | Admin-managed interest category taxonomy |
| `user_interests` | Per-user interest selections |
| `interest_signals` | Raw behavioural signals |
| `interest_scores` | Computed interest scores per user |
| `badges` | Badge definitions |
| `badge_earned` | Per-user earned badges |
| `referrals` | Referral tracking per invite |
| `moderation_reports` | User-submitted content reports |
| `moderation_actions` | Admin/moderator action log |
| `keyword_filters` | Moderation keyword list |
| `audit_log` | Admin audit trail |
| `user_settings` | Per-user settings (dark mode, notification prefs, etc.) |

## Migrations

```
cd server
npm run migrate:status    # see what's applied and what's pending
npm run migrate:dry-run   # preview what would run
npm run migrate           # apply all pending migrations
```

- Schema changes use standalone `server/migrate-*.sql` files (49 files total)
- `server/migrate.js` tracks which migrations have been applied
- Run manually after task completion — never triggered automatically by Claude

## Platform Features

`Platform.jsx` renders these pages (controlled by `page` state):

- **feed** — Post creation, feed with reactions, comments, media, scheduled posts; Community/Business mode toggle
- **friends** — Friend list, requests, search, invite system, blocking
- **messages** — Conversations (DM + group chats), mute, rename, leave
- **profile** — User profile, avatar upload, bio, skills, interests, GDPR data tools
- **edit-profile** — Extended profile editor
- **settings** — Privacy, sessions, notifications, language, dark mode, billing/subscription
- **marketplace** — Listings with categories, location filter, boost, EUR pricing
- **events** — Event creation, RSVP, cover image
- **calendar** — Personal calendar with event view and reminders
- **jobs** — Job listings, applications, saved jobs, tracked jobs
- **cv** — AI-assisted CV builder (experience, education, languages, cover letter)
- **reels** — Short-video reel creation, like, comment (`Reels.jsx`)
- **stories** — 24-hour ephemeral story posts (`StoryBar.jsx`)
- **explore** — Trending hashtags, suggested posts, discovery (`ExplorePage.jsx`)
- **search** — Global search across posts, users, companies
- **companies** — Company profiles, members, followers, posts, leads
- **business-directory** — Browse and follow businesses (`BusinessDirectory.jsx`)
- **ad-manager** — Ad campaign management (`AdManager.jsx`)
- **interest-graph** — Interest signal visualization (`InterestGraphPage.jsx`)
- **analytics** — Business analytics dashboard
- **visitor-stats** — Per-profile visitor analytics
- **notifications** — Notification feed and preferences
- **badges** — Earned badges and achievement progress
- **referrals** — Referral dashboard and leaderboard
- **moderation** — Moderation queue, keyword filters (moderators only)
- **admin** — Admin settings, platform stats, environment status, feed weight config

## User Modes

- `privat` — Standard personal account
- `business` — Business account (unlocks analytics, endorsements, ads, leads)
- Stored in `localStorage` as `fellis_mode`, synced via `PATCH /api/me/mode`

## Feed Mode Separation

- Every post stores `user_mode` at INSERT time
- `GET /api/feed` accepts `?mode=privat|business`; returns 400 for other values
- Two-tab toggle in frontend: "Fællesskab" / "Erhverv"
- Migration: `server/migrate-feed-mode-separation.sql`
- Translation keys: `feedModePrivat` / `feedModeBusiness` in `src/i18n/feed.js`

## Easter Eggs

Five hidden interactions (see `src/components/easter-eggs/` and `src/hooks/`):
- Konami code → party confetti
- Long-press avatar → Chuck Norris joke
- Multiple rapid taps → Matrix rain
- Key sequence → riddle banner
- Specific scroll hold → Rick Roll

Admin can configure active easter eggs via `PUT /api/admin/easter-eggs/config`.

## Git

- Always push to `main`: `git push -u origin main`
- Do not create feature branches unless explicitly asked
