---
name: graphify
description: "Generate Mermaid diagrams and visual representations from code, database schema, or API structure. Use when the user asks to visualize, diagram, or graph something in the codebase. Examples: \"Show me the DB schema\", \"Diagram the auth flow\", \"Graph the API routes\", \"Visualize the component hierarchy\""
---

# Graphify — Codebase Visualization

Generate clear Mermaid diagrams from code, schema, and architecture in the fellis project.

## When to Use

- "Show me the database schema"
- "Diagram the auth flow"
- "Visualize the API routes"
- "Graph the component hierarchy"
- "Map the social graph relationships"
- "Show how X connects to Y"

## Workflow

```
1. Identify what to visualize (DB schema, flow, hierarchy, API, etc.)
2. Read the relevant source files (server/schema.sql, server/index.js, src/Platform.jsx, etc.)
3. Choose the right diagram type (see below)
4. Generate the Mermaid diagram
5. Annotate key relationships or constraints if helpful
```

## Diagram Types

### Entity-Relationship (DB Schema)
Use for tables, foreign keys, and relationships.
```
erDiagram
    users ||--o{ posts : "writes"
    users ||--o{ friendships : "has"
    posts ||--o{ post_likes : "receives"
```
**Source:** `server/schema.sql`

### Flowchart (Auth / Request Flows)
Use for request lifecycle, auth steps, or multi-step processes.
```
flowchart TD
    A[Client] -->|POST /api/login| B[Express]
    B --> C{Valid credentials?}
    C -->|yes| D[Create session]
    C -->|no| E[401 Unauthorized]
```
**Source:** `server/index.js` routes, `src/api.js`

### Sequence Diagram (API Interactions)
Use for client-server exchanges or multi-service flows.
```
sequenceDiagram
    participant FE as Frontend
    participant BE as Express
    participant DB as MariaDB
    FE->>BE: GET /api/feed?mode=privat
    BE->>DB: SELECT posts WHERE user_mode='privat'
    DB-->>BE: rows[]
    BE-->>FE: { posts: [...] }
```

### Graph (Social / Interest Relationships)
Use for user connections, interest categories, or signal flows.
```
graph LR
    U[User] --> I1[Interest: Tech]
    U --> I2[Interest: Sport]
    I1 -->|signal: like| S1[Score boost]
    I2 -->|signal: scroll_past| S2[Score decay]
```
**Source:** `src/InterestGraphPage.jsx`, `server/index.js` interest routes

### Component Hierarchy (React)
Use for page structure and component nesting.
```
graph TD
    App --> Platform
    Platform --> Feed
    Platform --> Profile
    Platform --> Messages
    Feed --> StoryBar
    Feed --> PostCard
```
**Source:** `src/Platform.jsx`, `src/App.jsx`

## Key Files to Read

| What to visualize      | Read these files                                         |
|------------------------|----------------------------------------------------------|
| Database schema        | `server/schema.sql`, `server/migrate-*.sql`              |
| API routes             | `server/index.js`                                        |
| Auth flow              | `server/index.js` (session/CSRF routes), `src/api.js`    |
| Frontend pages         | `src/Platform.jsx`, `src/App.jsx`                        |
| Interest graph         | `src/InterestGraphPage.jsx`, `src/api.js` interest fns   |
| Feed / post flow       | `src/data.js`, `server/index.js` feed routes             |
| Social graph           | DB tables: `friendships`, `friend_requests`, `user_blocks`|

## Output Format

Always wrap diagrams in a fenced code block with the `mermaid` language tag:

````
```mermaid
erDiagram
    ...
```
````

For complex schemas, split into focused sub-diagrams (e.g., "Auth tables", "Social tables", "Content tables") rather than one overwhelming diagram.

## Fellis-Specific Notes

- **Bilingual columns**: `text_da`/`text_en`, `bio_da`/`bio_en` — show as single logical field in diagrams
- **Feed mode**: every post has `user_mode` (`privat`|`business`) — worth annotating in feed flow diagrams
- **Session auth**: `fellis_sid` cookie → `sessions` table → CSRF token flow
- **Interest signals**: `like`, `comment`, `share`, `click`, `dwell_short`, `dwell_long`, `scroll_past`, `quick_close`, `block`
