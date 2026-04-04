# fellis.eu

A Danish social platform built for the EU — privacy-first, GDPR-compliant, bilingual (Danish/English).

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, JavaScript (JSX) |
| Backend | Node.js (ESM), Express 4 |
| Database | MariaDB 11.8+ / MySQL 8+ |
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

## Features

- Feed with posts, reactions, comments, media, link previews, scheduled posts
- Friends, friend requests, blocking, family relationships
- Messaging (DM + group chats), mute, read receipts
- Stories (24h ephemeral) and Reels (short video)
- Events with RSVP and Calendar with reminders
- Marketplace listings with boost and EUR pricing
- Jobs board, CV builder (AI-assisted), job applications
- Companies with followers, members, posts, leads
- Business directory and ad campaign management (Mollie payments)
- Analytics dashboard (profile views, engagement, post insights)
- Interest graph and signal-based feed ranking
- Badges and achievements system
- Referral tracking and leaderboard
- Moderation queue, keyword filters, user warnings/suspensions/bans
- Admin dashboard with platform stats and environment status
- GDPR: consent management, data export, account deletion
- Bilingual UI (Danish / English), dark mode, notification preferences
- SMS MFA via 46elks, account lockout after failed logins
- Service worker / PWA shell

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

## Project Documentation

- [CLAUDE.md](CLAUDE.md) — Architecture, conventions, and developer guide
- [skills.md](skills.md) — Recurring patterns and how-to reference
- [WISHLIST.md](WISHLIST.md) — Planned and future features
- [brainstorm.md](brainstorm.md) — Ideas and open questions
