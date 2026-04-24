# fellis.eu

A Danish social platform built for the EU — privacy-first, GDPR-compliant, bilingual (Danish/English).

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, JavaScript (JSX) |
| Backend | Node.js (ESM), Express 4 |
| Database | MariaDB 11.8+ / MySQL 8+ |
| Web server | lighttpd 1.4.46+ (reverse proxy + static files) |
| Auth | Session-based + Google / LinkedIn OAuth |
| Payments | Mollie |
| File uploads | Multer |
| Email | Nodemailer (optional) |
| SMS MFA | 46elks (optional) |
| AI | Mistral AI (optional, CV generation) |

## Quick Start

**Frontend:**
```bash
npm install
npm run dev          # http://localhost:5173
```

**Backend:**
```bash
cd server
cp .env.example .env   # fill in DB credentials
npm install
npm start              # http://localhost:3001
```

**Database:**
```bash
mysql -u root < server/schema.sql
cd server && npm run migrate      # apply all migrations
npm run seed                      # optional demo data
```

## Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Route check + production build |
| `npm test` | API route consistency check |
| `npm run lint` | ESLint |

**Server scripts (`cd server`):**

| Command | Description |
|---------|-------------|
| `npm start` | Start Express server |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:status` | Show migration status |
| `npm run migrate:dry-run` | Preview pending migrations |
| `npm run seed` | Seed demo data |
| `npm run seed-bots` | Seed fake users for testing |
| `npm run cleanup-bots` | Remove bot accounts |

## 🛠️ Implemented features

| Feature | Description |
|---------|-------------|
| **Feed** | Posts with reactions, comments, media, link previews, scheduled posts; Community / Business feed toggle with mode separation |
| **Friends** | Friend requests, bidirectional connections, blocking, family relationships |
| **Messaging** | DM and group chats, mute, read receipts |
| **Stories** | 24-hour ephemeral posts with story bar timeline |
| **Reels** | Short-video reel creation, likes, comments |
| **Events & Calendar** | Event creation with RSVP, cover images, personal calendar with reminders |
| **Marketplace** | Listings with categories, location filter, boost, EUR pricing |
| **Jobs & CV** | Job board, applications, saved/tracked jobs, AI-assisted CV builder (experience, education, cover letter) |
| **Companies** | Company profiles, members, followers, posts, CRM leads |
| **Business directory** | Browse and follow business accounts |
| **Ad manager** | Ad campaign creation, targeting, and Mollie payment integration |
| **Analytics** | Business analytics: profile views, post engagement, audience demographics |
| **Interest graph** | Behavioural signal engine + interest-based feed ranking |
| **Badges & achievements** | Badge catalogue, award engine, per-user display |
| **Referrals** | Invite tracking, referral dashboard, leaderboard |
| **Moderation** | Keyword filters, moderation queue, warnings / suspensions / bans |
| **Admin** | Platform stats, environment status, feed weight config, easter-egg toggle |
| **GDPR** | Consent management, data export, account deletion |
| **Auth** | Session-based auth, Google / LinkedIn OAuth, SMS MFA (46elks), account lockout |
| **Notifications** | Per-user notification feed with opt-in/out preferences |
| **i18n** | Fully bilingual UI (Danish / English), dark mode |
| **PWA** | Service worker for fast repeat loads |

## Environment Variables

See `server/.env.example` for all required and optional variables. Key variables:

```
DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
PORT
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
MAIL_HOST / MAIL_USER / MAIL_PASS / MAIL_FROM
SITE_URL
46ELKS_USERNAME / 46ELKS_PASSWORD
MISTRAL_API_KEY
UPLOADS_DIR          # default: /var/www/fellis.eu/uploads
MOLLIE_API_KEY
```

## Production Server (lighttpd)

fellis.eu is served by **lighttpd** acting as both the static file server and a reverse proxy to the Node.js backend.

The config lives at [`lighttpd.conf`](lighttpd.conf) in the repo root. Copy it to `/etc/lighttpd/lighttpd.conf` on the production host.

### How it works

| Path | Handled by |
|------|-----------|
| `/api/*` | Proxied to Node.js on `localhost:3001` |
| `/uploads/*` | Proxied to Node.js on `localhost:3001` |
| `/assets/*` | Served from `/var/www/fellis.eu/assets/` (immutable cache) |
| Everything else | Falls back to `/index.html` (React SPA routing) |

### Required lighttpd modules

```bash
sudo lighttpd-enable-mod proxy rewrite compress setenv accesslog
```

### Deploy steps

```bash
# 1. Build the frontend
npm run build
# Copies index.html + assets/ to the repo root — rsync these to /var/www/fellis.eu/

# 2. Install / reload lighttpd config
sudo cp lighttpd.conf /etc/lighttpd/lighttpd.conf
lighttpd -t -f /etc/lighttpd/lighttpd.conf   # validate
sudo systemctl reload lighttpd

# 3. Start the Node.js backend (e.g. via PM2)
cd server && npm start
```

### HTTPS / TLS

The config ships with a commented-out HTTPS block. To enable it:

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/fellis.eu -d fellis.eu -d www.fellis.eu
```

Then uncomment the `$SERVER["socket"] == ":443"` block and the HTTP→HTTPS redirect in `lighttpd.conf`.

### chat.fellis.eu vhost

A separate virtual host for `chat.fellis.eu` is included in the same config file. It serves the chat app from `/var/www/fellis.eu/chat/dist/` and proxies `/api` and `/uploads` to the same Node.js backend.

### SSE (Server-Sent Events)

`server.stream-response-body = 2` is set globally so lighttpd does not buffer SSE responses. The `/api/sse` path also gets an extended `proxy.read-timeout = 600` to keep event streams alive.

---

## Project Documentation

- [CLAUDE.md](CLAUDE.md) — Architecture, conventions, and developer guide
- [skills.md](skills.md) — Recurring patterns and how-to reference
- [WISHLIST.md](WISHLIST.md) — Planned and future features
- [brainstorm.md](brainstorm.md) — Ideas and open questions
