# Fellis.eu — Ønskeliste / Wishlist

Idéer og features til fremtidige releases.

---

## Afsluttet / Completed

Features that have been shipped and are no longer wishlist items:

- **Google OAuth sign-in** — "Sign in with Google" + "Connect Google" in profile
- **LinkedIn OAuth sign-in** — "Sign in with LinkedIn" + "Connect LinkedIn" in profile
- **SMS MFA** — Two-factor authentication via 46elks SMS
- **Account lockout** — Brute-force protection (failed login attempts + lockout period)
- **Dark mode** — System-preference-aware and user-togglable dark theme
- **Stories** — 24-hour ephemeral posts with story bar timeline
- **Events with RSVP** — Event creation, cover images, RSVP tracking
- **Interest graph & signals** — Behavioural signal engine + feed ranking by interests
- **DB migration runner** — `server/migrate.js` tracks and applies migrations in order
- **Service Worker / PWA shell** — `public/sw.js` for fast repeat loads
- **Health check endpoint** — `GET /api/health` returns DB status and uptime
- **Reels / short video** — Reel creation, likes, comments
- **Badges & achievements** — Badge engine, admin toggle, per-user display
- **Referral system** — Invite tracking, referral dashboard, leaderboard
- **Mollie payment integration** — Ad payments, subscriptions, ad-free tier purchases
- **Audience demographics** — Visitor/audience insights for business profiles
- **Content moderation** — Keyword filters, moderation queue, warnings/suspensions/bans
- **Rate limiting** — Per-IP and per-user limits on write endpoints
- **Notification preferences** — Per-user opt-in/out for notification types

---

## Kode & Arkitektur

### Oversættelser i separate sprogfiler
Flytte `PT`-objektet i `src/data.js` fra ét stort inline-objekt til separate JSON-filer:

```
src/locales/
  da.json
  en.json
```

Importeres i `data.js` som:
```js
import da from './locales/da.json'
import en from './locales/en.json'
export const PT = { da, en }
```

Ingen ændringer i komponenter — kun flytning af indhold.

**Fordele:** Nemmere for eksterne oversættere · Understøtter tooling (Weblate, POEditor m.fl.) · Gør det trivielt at tilføje et tredje sprog.

**Hvornår:** Relevant hvis et tredje sprog ønskes, eller en ekstern oversætter involveres.

---

## Integrationer

### Google Photos (eller lignende)
Mulighed for at importere billeder direkte fra Google Photos, iCloud Photos el.lign. til opslag og profil.

**Kræver:**
- Google OAuth 2.0 + Google Photos API (`https://photospicker.googleapis.com`)
- Alternativt: brug Google Picker API (viser et in-browser galleri uden fuld OAuth)
- Backend: midlertidig download af valgt billede → gem via eksisterende upload-pipeline (Multer)
- GDPR-note: brugeren skal eksplicit give tilladelse; ingen tokens gemmes permanent

**Varianter der kan overvejes:**
- Google Photos
- iCloud (meget begrænset offentlig API — svær)
- Dropbox / OneDrive (nemmere OAuth-flows)
