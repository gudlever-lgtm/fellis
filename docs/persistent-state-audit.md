# Persistent UI State Audit

> Audit only — no code changes. Generated 2026-04-28.

## Background

Fellis uses a custom single-state router inside `Platform.jsx`. There is no React Router. The entire platform lives at `/`, and navigation is handled by two React state variables:

- `page` — current section string (`'feed'`, `'messages'`, `'marketplace'`, …)
- `navParam` — optional sub-parameter passed alongside `page` (e.g. `{ tab: 'billing' }`, `{ slug: 'my-group' }`)

URL-based routing already exists in three narrow cases:
- `/@handle` → resolves to userId via API, stashed in `sessionStorage`, URL cleaned to `/`
- `?post=<id>` → `initialPostId` prop, URL cleaned immediately
- `?page=<page>` → `initialPage` prop, URL cleaned immediately

Everything else resets to `page='feed'` on every reload.

---

## 1. States Lost on Reload

### Platform-level (Platform.jsx ~L222–510)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `page` | `'feed'` | User lands on feed regardless of where they were |
| `viewUserId` + `page === 'view-profile'` | null / 'feed' | Profile view lost; no URL to share |
| `navParam` | null | Sub-params (tab, companyId, slug, reelId) lost |
| `openConvId` | null | Deep-linked conversation collapses |
| `highlightPostId` | null | Highlighted post lost (shallow: scroll target) |
| `feedTypeFilter` | `'all'` | Content-type filter (posts/reels/events/media) resets |

### FeedPage (~L2613)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `feedContext` | derived from `mode` (`'social'` or `'network'`) | Feed tab (Social / Network / Business) resets |
| `feedCategoryFilter` | null | Interest category filter cleared |
| `postContext` | derived from `mode` | Composer audience context resets |
| scroll position | `savedFeedScroll.current` (in-memory ref) | Feed scroll lost; user returns to top |

### ProfilePage — own profile (~L5015)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `profileTab` | `'about'` | Active tab (about / posts / photos / scheduled / notes / badges / adfree / portfolio / hashtags) resets |

### EditProfilePage (~L5653)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'profile'` | Active edit tab (profile / interests / work / education / languages / extended / business) resets |

### SettingsPage (~L6285)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'konto'` | Active settings tab (konto / privatliv / sikkerhed / notifikationer / billing / nav / sprogtheme / leverandoerer) resets |

### MessagesPage (~L11207)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `activeConv` | `0` (list view) | Open conversation collapses |

### FriendsPage (~L10065)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `filter` | `'all'` | Active filter (all / friends / requests / followers / following) resets |

### EventsPage (~L11945)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'my'` | Active tab (my / discover) resets |

### JobsPage (~L14859)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'all'` | Active tab (all / saved / tracked / applied / shared / my) resets |
| `filterType` | `''` | Job type filter cleared |
| `filterLocation` | `''` | Location filter cleared |
| `filterKeyword` | `''` | Keyword search cleared |

### MarketplacePage (~L15824)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'browse'` | Active tab (browse / my / saved / stats / alerts) resets |
| `filters.category` | `''` | Category filter cleared |
| `filters.location` | `''` | Location filter cleared |
| `filters.q` | `''` | Search query cleared |
| `selectedListing` | null | Open listing detail collapses |

### CompanyListPage (~L12706)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `tab` | `'my'` | Active tab (my / discover) resets |
| `selectedCompany` | null | Open company detail collapses |

### CalendarPage (~L17844)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `year` / `month` | current month | Navigated month resets to today |
| `selectedDay` | null | Selected day cleared |

### SearchPage (~L11051)

| State variable | Default on reload | Effect of loss |
|---|---|---|
| `query` | `''` | Search query lost |

---

## 2. Recommended Persistence Method per State

### Legend
- **URL** — put in the browser URL (path or query param); survives reload and can be shared/bookmarked
- **localStorage** — persist as user preference; survives browser close; not shareable
- **none** — ephemeral UI; intentionally reset on reload

---

### Full state table

| State | Component | Current location | Recommended | Proposed key / route |
|---|---|---|---|---|
| Current page | Platform | React state | **URL** | `/feed`, `/messages`, `/profile`, … (see §3) |
| Viewed user profile | Platform | React state | **URL** | `/profile/:userId` or `/@handle` |
| Open conversation | Platform / MessagesPage | React state | **URL** | `/messages/:convId` |
| Marketplace selected listing | MarketplacePage | React state | **URL** | `/marketplace/:listingId` |
| Group detail | Platform / GroupDetail | React state | **URL** | `/groups/:slug` |
| Company detail | CompanyListPage | React state | **URL** | `/companies/:id` |
| Profile tab (own) | ProfilePage | React state | **URL** | `/profile?tab=posts` |
| Settings tab | SettingsPage | React state | **URL** | `/settings?tab=billing` |
| Jobs tab + filters | JobsPage | React state | **URL** | `/jobs?tab=saved&type=remote&location=Copenhagen&q=react` |
| Marketplace tab + filters | MarketplacePage | React state | **URL** | `/marketplace?tab=browse&category=electronics&location=Copenhagen&q=sofa` |
| Events tab | EventsPage | React state | **URL** | `/events?tab=discover` |
| Feed context (social/network/business) | FeedPage | React state | **localStorage** | `fellis_feed_context` → `'social' \| 'network' \| 'business'` |
| Feed type filter | Platform (prop to FeedPage) | React state | **localStorage** | `fellis_feed_type_filter` → `'all' \| 'posts' \| 'reels' \| 'events' \| 'media'` |
| Feed category filter | FeedPage | React state | **none** | Too specific; reset is fine |
| Feed scroll position | Platform (savedFeedScroll ref) | In-memory ref | **none** | Already partially handled; sessionStorage not worth the complexity |
| Calendar month/year | CalendarPage | React state | **none** | Reset to current month is expected UX |
| Friends filter | FriendsPage | React state | **none** | Ephemeral per visit |
| Search query | SearchPage | React state | **URL** | `/search?q=query` (URL bar is the natural home for a search query) |
| Edit-profile tab | EditProfilePage | React state | **URL** | `/edit-profile?tab=interests` |
| Open conversation (MessagesPage internal) | MessagesPage | React state | **URL** (same as above) | Covered by `/messages/:convId` |
| showAvatarMenu | Platform | React state | **none** | Transient overlay |
| showMobileMenu | Platform | React state | **none** | Transient overlay |
| showNotifPanel | Platform | React state | **none** | Transient overlay |
| showModeModal | Platform | React state | **none** | Transient modal |
| showKeyboardHelp | Platform | React state | **none** | Transient modal |
| showQRCode | Platform | React state | **none** | Transient modal |
| pollModalPostId | Platform | React state | **none** | Transient modal |
| makeOfferListing | Platform | React state | **none** | Transient modal |
| All loading / saving / error states | various | React state | **none** | Always ephemeral |
| Comment draft texts | FeedPage | React state | **none** | Ephemeral composer state |
| Post draft (newPostText / mediaFiles) | FeedPage | React state | **none** | Could use sessionStorage, but out of scope for this audit |
| Easter egg active flags | Platform | React state | **none** | Intentionally session-scoped |
| Camera state (facingMode, zoom, etc.) | CameraModal | React state | **none** | Hardware-dependent per session |

---

## 3. React Router Changes Needed

There is currently **no React Router** in the project. Two implementation paths exist:

### Option A — Add React Router v6 (recommended for long-term)
Install `react-router-dom`. Replace the `page`/`navParam` state machine with `<Routes>` + `<Route>` declarations and `useNavigate` / `useParams` / `useSearchParams` hooks. All proposed routes below map directly to route components that already exist as page functions in `Platform.jsx`.

### Option B — Extend the existing History API pattern (minimal change)
The app already uses `window.history.replaceState`. Extend `navigateTo()` to call `window.history.pushState` and add a `popstate` listener to restore `page`/`navParam` from the URL. Read URL on mount in `App.jsx` (already partially done for `?post=`, `?page=`, `/@handle`).

Either option requires the same route map:

### Proposed route map

| Route | Page state | navParam |
|---|---|---|
| `/` or `/feed` | `feed` | — |
| `/feed?context=social\|network\|business` | `feed` | — (reads from URL) |
| `/reels` | `reels` | — |
| `/reels/:reelId` | `reels` | `{ reelId }` |
| `/messages` | `messages` | — |
| `/messages/:convId` | `messages` | `{ convId }` |
| `/friends` | `friends` | — |
| `/friends?filter=requests\|followers\|following` | `friends` | — |
| `/profile` | `profile` | — |
| `/profile?tab=<tab>` | `profile` | `{ tab }` |
| `/edit-profile?tab=<tab>` | `edit-profile` | `{ tab }` |
| `/profile/:userId` | `view-profile` | `{ userId }` |
| `/@:handle` | `view-profile` | resolved to `{ userId }` |
| `/settings?tab=<tab>` | `settings` | `{ tab }` |
| `/marketplace` | `marketplace` | — |
| `/marketplace?tab=<tab>&category=&location=&q=` | `marketplace` | — |
| `/marketplace/:listingId` | `marketplace` | `{ listingId }` |
| `/events?tab=my\|discover` | `events` | — |
| `/calendar` | `calendar` | — |
| `/jobs?tab=<tab>&type=&location=&q=` | `jobs` | — |
| `/companies` | `company` | — |
| `/companies/:companyId` | `company` | `{ companyId }` |
| `/groups` | `groups` | — |
| `/groups/:slug` | `group-detail` | `{ slug }` |
| `/groups/:slug/settings` | `group-settings` | `{ slug }` |
| `/explore` | `explore` | — |
| `/search?q=<query>` | `search` | — |
| `/analytics` | `analytics` | — |
| `/notifications` | `notifications` | — |
| `/saved-posts` | `saved-posts` | — |
| `/badges` | `badges` | — |
| `/referrals` | `referrals` | — |
| `/admin` | `admin` | — |
| `/moderation` | `moderation` | — |
| `/business-hub` | `business-hub` | — |
| `/ads` | `ads` | — |

### localStorage additions

| Key | Shape | Purpose |
|---|---|---|
| `fellis_feed_context` | `'social' \| 'network' \| 'business'` | Restore last feed tab across sessions |
| `fellis_feed_type_filter` | `'all' \| 'posts' \| 'reels' \| 'events' \| 'media'` | Restore last content-type filter |

Both keys should be written on change and read as initial state in `FeedPage` / `Platform`.

---

## 4. lighttpd Changes Needed

**None.** The current config already handles everything correctly:

```
url.rewrite-if-not-file = ( "^/(?!(api|uploads)/).*" => "/index.html" )
```

This rule is present in both the `fellis.eu` and `test.fellis.eu` vhost blocks. Any path that does not exist as a real file on disk (which covers all proposed routes — `/feed`, `/messages/42`, `/groups/my-group`, etc.) is transparently rewritten to `/index.html`, allowing the React app to read the URL and render the correct page.

The `server.error-handler-404 = "/index.html"` global fallback also provides a safety net.

The only files that must **not** be caught by the SPA rewrite are already correctly excluded:
- `/api/*` → proxied to Node.js
- `/uploads/*` → proxied to Node.js
- `/assets/*` → served as static files with immutable cache headers

No lighttpd changes are needed to support any of the proposed URL routes.

---

## 5. States Deliberately Left Alone

These are intentionally ephemeral — resetting them on reload is correct UX:

- All modal open/close states (`showAvatarMenu`, `showModeModal`, `showKeyboardHelp`, `showCreate`, etc.)
- All in-progress form drafts (comment text, post composer content — too complex to restore reliably)
- Loading, saving, and error states
- Easter egg active flags (session-scoped by design)
- Camera hardware state
- SSE payload buffer (`msgSsePayload`)
- Notification panel state
- Friend refresh key (internal pagination trigger)
- Feed scroll position (partially handled already; further persistence adds complexity without proportional benefit)
- `selectedDay` in CalendarPage (resetting to today is natural)
- `feedCategoryFilter` (transient drill-down; resetting is the right default)
