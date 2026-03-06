# Skills Reference — fellis.eu

A quick-reference guide of recurring patterns, conventions, and techniques used in this codebase. Consult this when implementing new features or making changes.

---

## Frontend Patterns

### Adding a New Page

1. Add a new component or section inside `Platform.jsx`, rendered conditionally based on the `page` state variable.
2. Add a navigation entry in the sidebar/nav that sets `page` to the new page name.
3. If the page needs API data, add the fetching functions to `src/api.js` (never call `fetch()` directly from components).

### Translations (Bilingual UI Strings)

All UI strings live in the `PT` object in `src/data.js`. Always add both `da` and `en` entries:

```js
// src/data.js
export const PT = {
  // ...
  myNewLabel: { da: 'Min tekst', en: 'My text' },
};

// Usage in component
{PT.myNewLabel[lang]}
```

### Styles

Follow the existing `const s = { ... }` inline style pattern — no CSS classes, no external framework:

```jsx
const s = {
  container: { display: 'flex', gap: 12, padding: 16 },
  title: { fontSize: 18, fontWeight: 600 },
};

return <div style={s.container}><span style={s.title}>...</span></div>;
```

### Making API Calls

All API functions go in `src/api.js` and use the `request()` helper:

```js
// src/api.js
export async function apiGetSomething(id) {
  return request(`/api/something/${id}`);
}
```

For file uploads use `fetch()` directly with `formHeaders()`:

```js
export async function apiUploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/api/upload`, { method: 'POST', headers: formHeaders(), body: fd });
  return res.ok ? res.json() : null;
}
```

### Graceful Degradation

When an API call returns `null` (server unreachable), fall back to mock data from `src/data.js`:

```js
const data = await apiGetPosts() ?? POSTS;
```

---

## Backend Patterns

### Adding a New API Route

1. Register the route in `server/index.js`.
2. Export a matching function from `src/api.js`.
3. The route checker (`tests/check-api-routes.js`) will validate consistency on every build.

```js
// server/index.js
app.get('/api/something/:id', requireAuth, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM something WHERE id = ?', [req.params.id]);
  res.json(rows[0] ?? null);
});
```

### Authentication Middleware

Use `requireAuth` for any route that needs a logged-in user. It attaches `req.user` and `req.sessionId`:

```js
app.post('/api/protected', requireAuth, async (req, res) => {
  const userId = req.user.id;
  // ...
});
```

### Database Queries

Use the `db` pool from `server/db.js`. Always use parameterised queries — never interpolate user input:

```js
const [rows] = await db.query(
  'SELECT id, name FROM users WHERE email = ?',
  [email]
);
```

### Bilingual Database Columns

Store bilingual content in parallel columns. Always write and read both:

```sql
-- Schema pattern
text_da VARCHAR(1000),
text_en VARCHAR(1000)
```

```js
// Insert
await db.query('INSERT INTO posts (text_da, text_en) VALUES (?, ?)', [textDa, textEn]);

// Select — return both, let the frontend pick based on lang
res.json({ text_da: row.text_da, text_en: row.text_en });
```

---

## Database Migrations

Schema changes use standalone SQL files named `server/migrate-<description>.sql`. There is no migration runner — apply manually:

```bash
mysql -u root fellis_eu < server/migrate-add-my-column.sql
```

Always add a comment in `server/schema.sql` with the equivalent `ALTER TABLE` for new installs vs. existing installs.

---

## GDPR Checklist

When adding features that handle personal data:

- [ ] Does it store new personal data? Document in schema comments.
- [ ] Does data export (`apiExportData`) need updating?
- [ ] Does account deletion (`apiDeleteAccount`) cascade-delete the new data?
- [ ] Is any sensitive data (tokens, secrets) encrypted at rest?
- [ ] Is consent required before processing?

---

## Running Checks

```bash
npm test          # API route consistency check
npm run lint      # ESLint
npm run build     # Route check + Vite build
```

ESLint treats `no-unused-vars` as an error. Names matching `/^[A-Z_]/` are exempt (constants/components).

---

## Common Gotchas

- **FormData headers:** Use `formHeaders()` not `headers()` for multipart requests — `headers()` sends `null` for the Content-Type which breaks uploads.
- **ESM on the server:** All server files use ESM (`import`/`export`). Do not use `require()`.
- **Session header:** The `X-Session-Id` header must be present on every authenticated request. It is set automatically by `headers()` / `formHeaders()` in `src/api.js`.
- **`emptyOutDir: false`:** Vite is configured not to wipe the output directory. Static assets in the repo root are preserved after a build.
- **Language default:** Default language is `da` (Danish). Always supply Danish copy first.
