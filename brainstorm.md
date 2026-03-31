# Brainstorm — fellis.eu

A living document for ideas, future directions, and open questions. Nothing here is committed — use it to think out loud.

---

## Shipped ✓

Items that have been implemented:

- **Stories** — 24-hour ephemeral posts with story bar timeline
- **Dark mode** — System-preference-aware dark theme, user-togglable
- **Events RSVP** — Event creation, RSVP tracking, cover images
- **Reactions beyond likes** — Comment reactions (on individual comments)
- **Suggested friends** — Interest-based and mutual-friend recommendations (`GET /api/users/suggested`)
- **Invite campaigns** — Shareable invite links with referral tracking and leaderboard
- **Audience demographics** — Aggregate visitor insights for business profiles
- **2FA / SMS MFA** — SMS-based two-factor via 46elks, account lockout on brute force
- **Service Worker / PWA** — Cache shell (`public/sw.js`) for fast repeat loads
- **DB migration runner** — `server/migrate.js` tracks and applies `migrate-*.sql` in order
- **Rate limiting** — Per-IP and per-user limits on write endpoints
- **Health check endpoint** — `GET /api/health` returning DB status and uptime
- **Sponsored posts / Post boost** — Paid reach boost for business accounts via Mollie
- **Review / endorsement system** — Skill endorsements between users, business endorsements
- **Hashtags / Topics** — Interest categories with tag-based feed filtering

---

## Feature Ideas

### Social / Community
- **Groups** — Interest-based communities with their own feeds, distinct from the main friend feed
- **Polls** — Quick opinion posts embedded directly in the feed
- **Shared albums** — Collaborative photo collections between friends
- **Events RSVP reminders** — Push/email notification X hours before an event the user has joined
- **Recurring events** — Weekly meetups, monthly clubs

### Messaging
- **Read receipts** — Show when a message has been read in conversations
- **Message reactions** — React to individual messages with emoji
- **Voice messages** — Short audio clips in DMs
- **Message search** — Full-text search across conversations
- **Pinned messages** — Pin important messages in group chats

### Discovery & Growth
- **Local feed** — Posts from users in the same city/region (opt-in location)

### Business / Analytics
- **Product catalogue** — Business profiles can list products/services, distinct from the marketplace
- **Analytics export** — CSV/PDF export of analytics data for business accounts

### Privacy & Trust
- **Granular post visibility** — Per-post: public / friends only / specific friend list / only me
- **Friend lists** — Organise friends into lists (close friends, colleagues, etc.) for visibility targeting
- **Content warnings** — Collapsible content with a user-supplied label before reveal
- **Trust levels** — Let users mark certain contacts as "trusted" with expanded sharing rights
- **Passkeys** — WebAuthn passkey support as a password alternative

### Accessibility & UX
- **Font size preference** — Stored per-user, applied globally
- **Keyboard navigation** — Full keyboard accessibility for feed and messaging
- **Screen reader audit** — ARIA labels, live regions for new messages/notifications
- **Offline indicator** — Clearer UI when running in demo/offline mode

---

## Technical Improvements

### Performance
- **Feed pagination cursor** — Replace offset-based pagination with cursor-based for stable feeds
- **Image lazy loading** — Defer off-screen media in the feed
- **Push notifications** — Web Push for new messages and activity
- **DB indexes audit** — Profile slow queries on `posts`, `messages`, `friend_requests` tables under load

### Developer Experience
- **Integration test suite** — End-to-end tests (e.g. Playwright) covering login, posting, messaging
- **Storybook or component playground** — Isolated rendering of UI components for faster iteration
- **API versioning** — `/api/v1/` prefix to allow non-breaking evolution
- **OpenAPI / Swagger spec** — Auto-generated docs from route definitions

### Infrastructure
- **Redis sessions** — Move session storage from MySQL to Redis for horizontal scaling
- **CDN for uploads** — Serve user media via a CDN rather than directly from the server
- **Background jobs** — Queue for email sending, notification delivery, analytics aggregation

---

## Open Questions

- Should the marketplace be integrated more tightly with business profiles, or remain a separate feature?
- What is the right scope for the analytics dashboard — is it only for business mode, or useful for all users?
- How should content moderation work? User reports, admin review queue, automated filters?
- Should the platform support non-Danish/English languages in the future? What is the localisation strategy?
- What is the long-term plan for Facebook OAuth — keep it, replace with other providers (Google, Apple), or phase out?
- Should groups have their own messaging, or share the existing conversations system?

---

## Scratchpad

_Use this section for rough notes, half-formed ideas, and things to revisit._

- Consider a "quiet mode" — suppress all notifications for a set period, useful for evenings/weekends
- The `data.js` mock data is getting stale — worth refreshing with more realistic Danish-language content
- The `resolve-merge.py` utility could be extended to handle trilateral conflicts from long-running feature branches
- Explore whether `PT` translations in `data.js` should be split into a dedicated `i18n.js` file as they grow (see WISHLIST.md for the split-to-locales plan)
