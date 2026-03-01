# Brainstorm — fellis.eu

A living document for ideas, future directions, and open questions. Nothing here is committed — use it to think out loud.

---

## Feature Ideas

### Social / Community
- **Groups** — Interest-based communities with their own feeds, distinct from the main friend feed
- **Stories** — 24-hour ephemeral posts (images/short video), common expectation on modern social platforms
- **Reactions beyond likes** — Heart, laugh, sad, angry — richer emotional signal without requiring a comment
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
- **Hashtags / Topics** — Tag posts with topics; browse a topic feed without needing to be friends
- **Suggested friends** — Mutual-friend based or interest-based recommendations
- **Local feed** — Posts from users in the same city/region (opt-in location)
- **Invite campaigns** — Shareable invite links with referral tracking for business accounts

### Business / Analytics
- **Sponsored posts** — Paid reach boost for business accounts, shown inline in feeds with a clear label
- **Product catalogue** — Business profiles can list products/services, distinct from the marketplace
- **Review / endorsement system** — Friends endorse specific skills or rate a business
- **Analytics export** — CSV/PDF export of analytics data for business accounts
- **Audience demographics** — Age/location breakdown for business profile visitors (aggregate, anonymised)

### Privacy & Trust
- **Granular post visibility** — Per-post: public / friends only / specific friend list / only me
- **Friend lists** — Organise friends into lists (close friends, colleagues, etc.) for visibility targeting
- **Content warnings** — Collapsible content with a user-supplied label before reveal
- **Trust levels** — Let users mark certain contacts as "trusted" with expanded sharing rights
- **2FA / Passkeys** — Additional login security beyond password + session

### Accessibility & UX
- **Dark mode** — System-preference-aware dark theme
- **Font size preference** — Stored per-user, applied globally
- **Keyboard navigation** — Full keyboard accessibility for feed and messaging
- **Screen reader audit** — ARIA labels, live regions for new messages/notifications
- **Offline indicator** — Clearer UI when running in demo/offline mode

---

## Technical Improvements

### Performance
- **Feed pagination cursor** — Replace offset-based pagination with cursor-based for stable feeds
- **Image lazy loading** — Defer off-screen media in the feed
- **Service Worker / PWA** — Cache shell for fast repeat loads; push notifications via Web Push
- **DB indexes audit** — Profile slow queries on `posts`, `messages`, `friend_requests` tables under load

### Developer Experience
- **Integration test suite** — End-to-end tests (e.g. Playwright) covering login, posting, messaging
- **DB migration runner** — Simple script that tracks and applies `migrate-*.sql` files in order
- **Storybook or component playground** — Isolated rendering of UI components for faster iteration
- **API versioning** — `/api/v1/` prefix to allow non-breaking evolution
- **OpenAPI / Swagger spec** — Auto-generated docs from route definitions

### Infrastructure
- **Redis sessions** — Move session storage from MySQL to Redis for horizontal scaling
- **CDN for uploads** — Serve user media via a CDN rather than directly from the server
- **Rate limiting** — Per-IP and per-user rate limits on write endpoints (posts, messages, auth)
- **Background jobs** — Queue for email sending, notification delivery, analytics aggregation
- **Health check endpoint** — `GET /api/health` returning DB status and uptime, for monitoring

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
- Explore whether `PT` translations in `data.js` should be split into a dedicated `i18n.js` file as they grow
