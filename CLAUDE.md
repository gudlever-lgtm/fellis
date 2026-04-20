# CONFIG v1.0

## CORE
API=request() | AUTH=CSRF | I18N=EXT

## STACK
FE: React19/Vite7 | BE: Node/Express (ESM) | DB: MariaDB 11.8+ | SRV: lighttpd
Auth: session+cookie, Google/LinkedIn OAuth | Payments: Mollie | Uploads: Multer | SMS: 46elks | AI: Mistral

## TASKS
- Keep tasks small and focused — one feature or fix at a time
- Never trigger `npm run build`, `npm run migrate`, or `pm2 reload` automatically
- Do not chain multiple long-running commands in a single task

## RULES

### API
- `src/api.js` → `request()` — single source of truth for all API calls
- Never call `fetch()` directly from components; always add new functions to `api.js`
- `request()` returns `null` when unreachable (offline/demo mode)
- File uploads (avatar, media): use `fetch()` directly with `formHeaders()`
- `tests/check-api-routes.js` runs before every build — every new endpoint needs a route in `server/index.js` AND an export in `src/api.js`

### AUTH
- Session-based; session ID in `fellis_sid` HTTP-only cookie, stored in `sessions` table (30-day expiry)
- `X-CSRF-Token` required on all state-changing requests (POST/PUT/PATCH/DELETE)
- Token: HMAC-SHA256(sessionId, CSRF_SECRET) — fetched via `GET /api/csrf-token` after login
- Stored in `localStorage` as `fellis_csrf_token`, read by `getCsrfToken()` in `api.js`
- CSRF token must be fetched before platform mounts; pre-auth endpoints exempt
- For multipart/FormData: use `formHeaders()` (not `headers()`)

### I18N
- Primary: `da` | Files: `src/i18n/*.js` — one segment per feature/page
- Each segment exports `{ da: {…}, en: {…} }`; `src/i18n/index.js` deep-merges into `PT`
- Global/shared strings: `data.js` under `PT`; page-specific: relevant segment file
- Never hardcode UI strings — always `const t = PT[lang]`, then `t.keyName`
- Exceptions: JS date locale strings (`'da-DK'`/`'en-US'`), bilingual DB field selectors, large long-form blocks
- DB: bilingual columns are `text_da`/`text_en`, `bio_da`/`bio_en`

### CURRENCY
- `formatPrice()` from `src/utils/currency.js` — EUR, de-DE locale (`1.234,56 €`)
- Never hardcode currency symbols or `.toFixed(2)`

### MIGRATIONS
- `server/migrate-*.sql` (incremental, 49 files) — run manually by developer
- `npm run migrate` — never triggered by Claude

### BUILD
- `npm run build` — never triggered by Claude (route check → Vite build)
- Verify manually after task completion

### GIT
- Never push directly to `main` — always push to a branch first, then open a PR via GitHub MCP tools
- Do not create feature branches unless explicitly asked

### CONTEXT-MODE
- Use `ctx_batch_execute()` first when gathering data (multiple ops, one call)
- Use `ctx_search()` to query previously indexed content
- Use `ctx_execute()` to process large files/output — never read raw data into context
- Use `ctx_fetch_and_index()` instead of WebFetch for all URLs
- Never use `curl`, `wget`, or inline HTTP — route through `ctx_execute()`
- Write analysis scripts with `console.log()` for only the result, not full data
- Response length: ≤500 words; artifacts go to files, not inline output

---

## Repository Structure

```
fellis/
├── src/
│   ├── main.jsx / App.jsx / Landing.jsx / Platform.jsx
│   ├── Analytics.jsx / Reels.jsx / InterestGraphPage.jsx
│   ├── BusinessDirectory.jsx / AdManager.jsx / ExplorePage.jsx
│   ├── PaymentSuccess.jsx / PaymentFailed.jsx
│   ├── api.js              # All API client functions
│   ├── data.js             # Mock data + shared utilities + PT global strings
│   ├── i18n/
│   │   ├── index.js        # Merges segments into PT
│   │   └── *.js            # Feature segments (feed, profile, settings, marketplace…)
│   ├── App.css / index.css / index.html
│   ├── components/
│   │   ├── AdBanner.jsx / BadgeToast.jsx / BusinessBadge.jsx / BusinessCard.jsx
│   │   ├── LocationAutocomplete.jsx / ModeGate.jsx / StoryBar.jsx
│   │   └── easter-eggs/    # ChuckBanner, MatrixRain, PartyConfetti, RickRoll, RiddleBanner
│   ├── hooks/              # useEasterEggs, useKonamiCode, useKeySequence, useLongPress,
│   │                       # useTapCount, useScrollHold, useAvatarClick
│   ├── badges/             # badgeDefinitions.js, badgeEngine.js
│   └── utils/currency.js
├── server/
│   ├── index.js            # All API routes
│   ├── db.js / sms.js / migrate.js / run-migrations.js
│   ├── schema.sql / seed.js / seed-bots.js
│   ├── cleanup-*.js / import-keyword-lists.js / migrate-bcrypt-passwords.js
│   ├── migrate-*.sql       # 49 incremental migrations
│   └── package.json / .env.example
├── tests/check-api-routes.js
├── public/sw.js
├── package.json / vite.config.js / eslint.config.js / resolve-merge.py
```

## Key Conventions

### React Components
- All pages rendered inside `Platform.jsx` (manages `page` state)
- `App.jsx`: session validation, OAuth callbacks, invite tokens, GDPR consent, routing
- Inline styles used extensively — follow `const s = { … }` pattern; no external CSS framework

### ESLint
- ESLint 9 flat config (`eslint.config.js`)
- `no-unused-vars` is an error, except names matching `/^[A-Z_]/`
- React Hooks and React Refresh rules enforced

### GDPR
- Consent: `apiGiveConsent()`, `apiWithdrawConsent()`, `apiGetConsentStatus()`
- Account deletion and data export endpoints must remain functional
- localStorage: only session ID and language preference

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Accounts (email/pw + OAuth) |
| `sessions` | Auth sessions (30-day) |
| `friendships` / `friend_requests` / `user_blocks` | Social graph |
| `posts` | Feed posts (bilingual + JSON media); `user_mode` = author mode at INSERT |
| `post_likes` / `post_views` / `comments` / `comment_reactions` | Post interactions |
| `stories` / `story_views` | 24-hr ephemeral posts |
| `reels` / `reel_likes` / `reel_comments` | Short-video posts |
| `messages` / `conversations` / `conversation_participants` | Messaging |
| `invitations` / `notifications` / `notification_preferences` | Invites + notifications |
| `marketplace_listings` | EUR-priced listings |
| `events` / `event_rsvps` / `calendar_reminders` | Events + calendar |
| `jobs` / `job_applications` | Job board |
| `cv_experience` / `cv_education` / `cv_languages` | CV data |
| `companies` / `company_members` / `company_followers` / `company_posts` / `company_leads` | Company profiles |
| `contact_notes` / `skills` / `skill_endorsements` | Profile enrichment |
| `ads` / `ad_impressions` / `ad_clicks` / `mollie_payments` | Ads + payments |
| `interest_categories` / `user_interests` / `interest_signals` / `interest_scores` | Interest graph |
| `badges` / `badge_earned` / `referrals` | Gamification |
| `moderation_reports` / `moderation_actions` / `keyword_filters` / `audit_log` | Moderation |
| `user_settings` | Per-user settings |

## Platform Pages (`Platform.jsx` `page` state)

feed, friends, messages, profile, edit-profile, settings, marketplace, events, calendar, jobs, cv, reels, stories, explore, search, companies, business-directory, ad-manager, interest-graph, analytics, visitor-stats, notifications, badges, referrals, moderation, admin

## User Modes

- `privat` — personal account | `business` — unlocks analytics, endorsements, ads, leads
- Stored in `localStorage` as `fellis_mode`, synced via `PATCH /api/me/mode`

## Feed Mode Separation

- Every post stores `user_mode` at INSERT
- `GET /api/feed?mode=privat|business` (400 for other values)
- Toggle: "Fællesskab" / "Erhverv" | Migration: `server/migrate-feed-mode-separation.sql`
- i18n keys: `feedModePrivat` / `feedModeBusiness` in `src/i18n/feed.js`

## Easter Eggs

Five interactions (see `src/components/easter-eggs/`, `src/hooks/`):
Konami → confetti | Long-press avatar → Chuck | Rapid taps → Matrix | Key seq → riddle | Scroll hold → Rick Roll

Admin config: `PUT /api/admin/easter-eggs/config`

## Production Routing (lighttpd)

| Path | Handler |
|---|---|
| `/api/*`, `/uploads/*` | Proxy → Node.js `localhost:3001` |
| `/assets/*` | Static, immutable cache |
| `*` | Fallback → `/index.html` |

- `mod_proxy` before `mod_rewrite`; SSE: `server.stream-response-body = 2`
