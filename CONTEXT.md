# Fellis.eu – Projektkontext

## Stack

- Frontend: Vite 7 + React 19 (JSX, ingen TypeScript)
- Backend: Node.js (ESM), Express 4, MySQL2/MariaDB
- Database: MariaDB 11.8+ / MySQL 8+
- Hosting: Yggdrasilcloud.dk (nginx)
- Repo: github.com/gudlever-lgtm/fellis

## Hvad er fellis.eu

En social media platform med to tilstande:

- **Common mode** – privat brug, inkl. Reels-feature
- **Business mode** – erhverv

Betalt tier hedder **PlanGate**.

## Brand

- Farve: #2D6A4F
- Font: Playfair Display (serif)
- Logo: bogstavet "F" med bladmotiv

## Integrationer

- **Sightengine** – content moderation (EU/GDPR), admin review queue, DSA-compliant
- **Parachord** – open source musik-app, embeddable button til musik-URL detection i posts

## Databasestruktur

Databasen hedder `fellis_eu` og bruger `utf8mb4_unicode_ci`.

### Kernetabeller

| Tabel | Formål |
|-------|--------|
| `users` | Brugerkonti (email/password + Facebook OAuth) |
| `sessions` | Auth-sessioner (30 dages udløb) |
| `friendships` | Tovejsvenskaber (bidirektionale rækker) |
| `friend_requests` | Afventende/accepterede/afviste venneanmodninger |
| `posts` | Feed-opslag (tosprogede + JSON-mediearray) |
| `post_likes` | Like-tracking per bruger/opslag |
| `comments` | Kommentarer til opslag (tosprogede) |
| `messages` | Legacy direkte beskeder (erstattet af conversations) |
| `conversations` | Gruppe- og DM-tråde |
| `conversation_participants` | Deltagermedlemskab + mute-tilstand per bruger |
| `invitations` | Invitationslinks til nye brugere |
| `reels` | Vertikale videoopslag (Common mode) |
| `reel_likes` | Likes på reels |
| `reel_comments` | Kommentarer på reels |

### GDPR-tabeller

| Tabel | Formål |
|-------|--------|
| `gdpr_consent` | Registrering af eksplicit samtykke (GDPR art. 6 & 7) |
| `audit_log` | Log over databehandlingsaktiviteter (GDPR art. 30) |

### Moderationstabeller

| Tabel | Formål |
|-------|--------|
| `user_blocks` | Blokeringer mellem brugere (skjuler indhold tovejs) |
| `reports` | Brugerindberetninger af opslag, kommentarer og brugere |
| `moderation_actions` | Admin-handlingslog (advarsel, suspension, ban) |
| `keyword_filters` | Automatisk flagning/blokering af søgeord |

### Vækst- og gamification-tabeller

| Tabel | Formål |
|-------|--------|
| `referrals` | Registrering af vellykkede invitationskonverteringer |
| `rewards` | Katalog over badges/belønninger |
| `user_badges` | Optjente badges per bruger |
| `share_events` | Tracking af eksterne delinger til analytik |

### Vigtige relationer

```
users (1) ──< friendships >── (1) users          [tovejs, unique(user_id, friend_id)]
users (1) ──< friend_requests >── (1) users       [unique(from_user_id, to_user_id)]
users (1) ──< posts                               [CASCADE delete]
posts (1) ──< comments                            [CASCADE delete]
posts (1) ──< post_likes >── (1) users            [unique(post_id, user_id)]
users (1) ──< conversation_participants >── conversations
conversations (1) ──< messages (legacy)
users (1) ──< reels ──< reel_likes / reel_comments
users (1) ──< invitations ──< referrals
users (1) ──< gdpr_consent
users (1) ──< user_badges
```

### Bilinguale kolonner

Indhold gemmes i parallelle kolonner:

- `text_da` / `text_en` (posts, comments, messages)
- `bio_da` / `bio_en` (users)
- `time_da` / `time_en` (posts)
- `description_da` / `description_en` (conversations, rewards)
- `title_da` / `title_en` (rewards)

## Nginx / serveropsætning

- Subdomain: test.fellis.eu
- Backend kører på port 3001 (Node.js/Express)
- Frontend (Vite build) serveres som statiske filer fra repo-root (`assets/`, `index.html`)

```nginx
server {
    listen 80;
    server_name test.fellis.eu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name test.fellis.eu;

    # SSL-certifikat (Let's Encrypt anbefalet)
    ssl_certificate     /etc/letsencrypt/live/test.fellis.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.fellis.eu/privkey.pem;

    root /var/www/fellis.eu;
    index index.html;

    # API-proxy til Node.js backend
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Facebook OAuth callback
    location /auth/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Uploadede filer
    location /uploads/ {
        alias /var/www/fellis.eu/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }

    # SPA-fallback: alle andre routes sendes til index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Sikkerhedsheaders
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
```

## Kodestil og konventioner

### Generelt

- **Sprog:** Dansk UI-strenge og kommentarer er fine; kode (variabelnavne, funktioner) skrives på engelsk
- **Indrykning:** 2 mellemrum
- **Semikolon:** Bruges (ES-standard)
- **Citationstegn:** Enkle `'` i JS, undtagen JSX-attributter

### Frontend (React/JSX)

- **Ingen TypeScript** — ren JavaScript (JSX)
- Inline styles med `const s = { ... }` pattern — ingen CSS-framework
- Alle `fetch()`-kald goes through `src/api.js` — aldrig direkte fra komponenter
- `PT`-objektet i `data.js` holder alle UI-oversættelser — tilføj altid både `da` og `en`
- ESLint 9 flat config; `no-unused-vars` er en fejl (undtagen `UPPER_CASE` konstanter)

### Backend (Node.js/Express)

- **ESM modules** (`import`/`export`, ikke `require`)
- Alle routes defineres i `server/index.js`
- Nye API-endpoints kræver **begge:** route i `server/index.js` OG eksporteret funktion i `src/api.js`
- `tests/check-api-routes.js` verificerer konsistens automatisk ved build

### Database

- Alle migrationer er standalone `.sql`-filer i `server/` — ingen migration runner
- Brug `ADD COLUMN IF NOT EXISTS` i migrationer for idempotens
- Bilingualt indhold i parallelle `_da`/`_en` kolonner

## Vigtige ting at huske

- Push altid til main, når du er færdig
- Test **alle** API/fetch-kald for HTTP 404 og 500 — håndter begge eksplicit i koden
- Skriv kode der er let at forstå og vedligeholde
- `npm test` kører API-route-tjekket — kør det inden build
- GDPR: bevar `apiDeleteAccount()` og `apiExportData()` funktionsdygtige
- Facebook-tokens krypteres med AES-256-GCM — aldrig i klartekst i DB
- Sessioner sendes som `X-Session-Id` header (ikke cookies)
