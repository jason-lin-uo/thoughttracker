# \_LEARN.md — `frontend/src/lib/`

> Seven TypeScript files. Mostly plain TypeScript (one small hook). The
> plumbing under the React UI.

---

## The story of this folder

If `components/` and `pages/` are the visible furniture in a house,
`lib/` is the **plumbing and wiring behind the walls**. You don't see
it, but if it's broken, nothing works. Most of these seven files have
no React at all — pure TypeScript modules, no JSX, no components (the
lone exception is `useFilters.ts`, a small shared hook). They do generic
work the React code calls into.

The files split the plumbing by topic:

- `api.ts` is the connection to the kitchen (the backend).
- `types.ts` is the shared vocabulary (the type definitions for what the
  kitchen sends back).
- `format.ts` is the polish (turning raw numbers and dates into things
  humans can read).
- `useFilters.ts` is the one React hook here — shared filter/page state
  for the list pages.
- `dashboard.ts`, `topicAnalysis.ts`, and `stanceTimeline.ts` are pure
  derivations (the "what should we feature / what's the verdict" math)
  kept out of the components so they're unit-testable.

---

## File-by-file

### `api.ts`

**What it is:** the **only place** in the frontend that calls
`fetch()` (the built-in browser function for sending a request to a
server). Exposes an `api` object with two methods (`api.get()`,
`api.post()`) and an `ApiError` class (a custom error type — think of
it as a labeled envelope for backend failures, with the status code
and message tucked inside) for when things go wrong.

**Why it exists:** every component could call `fetch()` directly, but
that would mean every component would need to:

- Build the URL (with the `BASE_URL` prefix)
- Encode query parameters
- Set the `Content-Type: application/json` header (the label that
  tells the server "I'm sending JSON")
- Parse the response as JSON (and handle when it's not JSON)
- Check `res.ok` and throw a meaningful error

Doing that in 60 places means 60 places to update if the API ever
changes shape. Centralizing it in one file means one place. Standard
software-engineering instinct: **isolate the I/O boundary** (keep all
the talk-to-the-outside-world code in one room).

**The `BASE_URL` trick:** reads from `VITE_API_BASE_URL` env var (an
environment variable — a setting passed in from outside the code, so
the same code can point at different backends), falls back to
`"/api"`. In dev, Vite's proxy rewrites `/api/*` to the backend (a
proxy is a forwarder — calls come in here, get rerouted there). In
production, nginx does the same. So most of the time, the frontend
doesn't know or care where the backend lives.

**Used by:** every `pages/X.tsx` file (via React Query), plus a couple
of `components/X.tsx` files that mutate state (forms etc.).

---

### `types.ts`

**What it is:** the shared TypeScript type definitions for everything
the API returns. About 200 lines, mostly `export interface` and
`export type` declarations.

Example types:

- **Enums:** `StanceLabel`, `ConfidenceLabel`, `TrendLabel`,
  `TranscriptStatus`, `AnalysisStatus`, `ImportJobStatus`.
- **Page wrapper:** `Page<T>` — the standard `{ items, page, pageSize,
total, totalPages }` shape every paginated endpoint returns.
- **Domain entities:** `Creator`, `Video`, `Topic`, `Evidence`,
  `Report`, `ImportJob` — each with the fields the backend serializes.
  (`Report.evidence` — renamed from `evidenceJson` — is the body JSON:
  the `sections` + the citation `evidence` list.)
- **Specialty composites:** `CreatorOverview`, `VideoDetail`,
  `TopicAnalysis`, `DashboardResponse` (note its `featuredInsight`, the
  dashboard hero's data) — the shapes returned by specific endpoints
  that aggregate across tables.

**Why it exists:** when a `pages/X.tsx` calls
`api.get<Creator>('/creators/abc')`, TypeScript needs to know what
`Creator` is. Without these types, the frontend would be untyped JSON
soup, and every typo (`.creator_name` vs `.creatorName`) would only
show up at runtime in the browser.

**The mirror problem:** these types live in the frontend, but they
*describe* what the backend sends. If the backend's Prisma schema (the
database blueprint) changes, these types can drift (get out of sync —
like a menu that hasn't been updated after the kitchen swapped
ingredients). The OpenAPI spec at `/api/openapi.json` (a machine-readable
description of every endpoint and its data shape) is the source of
truth that *could* generate these — we don't auto-gen them, but
`REVERSE_ENGINEERED_PROMPT.md` flags this as a possible future
improvement.

**Used by:** every file that talks to the API. Heavily imported.

---

### `format.ts`

**What it is:** a collection of pure functions that turn machine values
into human values. About 10 functions, each tiny.

| Function                | Input → Output                           |
| ----------------------- | ---------------------------------------- |
| `formatDate(d)`         | `"2026-01-15T..."` → `"Jan 15, 2026"`    |
| `formatRelative(d)`     | a Date 8 minutes ago → `"8m ago"`        |
| `formatDuration(s)`     | `5523` seconds → `"1h 32m"`              |
| `formatPercent(n)`      | `0.834` → `"83%"`                        |
| `humanizeLabel(s)`      | `"abrupt_shift"` → `"Abrupt Shift"`      |
| `formatNumber(n)`       | `1234567` → `"1,234,567"`                |
| `fillTemplate(t, vars)` | `"{n} videos"` + `{n: 3}` → `"3 videos"` |

**Why it exists:** every component that shows a date or a number would
otherwise write its own `new Date(s).toLocaleDateString(...)` call —
and would do it slightly differently each time. Centralizing the
formatting means the dashboard, the creator page, and the report page
all format dates the same way.

It also means **changing the format in one place updates the whole app**.
If the team decides "always show relative time, not absolute dates,"
that's one function to change.

**`null`/`undefined` handling:** every function gracefully returns
`"—"` (em-dash) for null/undefined/invalid input. This means UIs that
say `{formatDate(creator.publishedAt)}` don't need to do their own
null-check — the formatter handles it.

**Used by:** roughly every page and most card components.

---

### `dashboard.ts`

**What it is:** pure derivations for the redesigned dashboard. Exports
`featuredHeadline(insight)`, which turns the server's `featuredInsight`
into the hero's `{ eyebrow, title }`, framed honestly by trend (a
sharp/gradual pivot reads as "biggest stance shift", `mixed` as "most
debated", anything steady as a neutral "topic spotlight"). No React, so
the display framing is unit-testable. The backend decides whether the
hero came from the latest topic report or an analyzed fallback.

**Used by:** `DashboardPage.tsx`.

---

### `topicAnalysis.ts`

**What it is:** the **analyst-console** data model + pure derivations.
Adapts the API `TopicAnalysis` payload into the console's own
`StancePoint` / `EvidenceRow` shapes and does every computation the page
leans on: building the trajectory points, filtering EVERYTHING by a
client-side date range, computing the verdict, grouping the heatmap by
month, and sorting/filtering the evidence list. The date range never
hits the backend, so this is the single source of truth for "what's in
range".

**Used by:** `TopicAnalysisPage` + the `components/topic-analysis/` parts.

---

### `stanceTimeline.ts`

**What it is:** the stance-timeline data model + **verdict derivation**
(`deriveVerdict`, `sortMoments`). Pure, so the "clear verdict up top"
logic ("Leans supportive — steady since 2021") is testable in isolation
and reusable by both the `StanceTimeline` component and any
dashboard/aggregate caller. Callers adapt their payload into
`StanceMoment`s; everything downstream works off that one model.

**Used by:** `components/StanceTimeline.tsx`.

---

### `useFilters.ts`

**What it is:** the one React hook in `lib/` — shared filter-state for
the paginated list pages. Holds a flat filter object plus a type-safe
single-field `update(key, value)` that resets `page` to 1 on any change
except a page change (a page index is meaningless against a freshly
filtered result set). Extracted because `VideosPage` and `EvidencePage`
had copy-pasted the same `useState` + setter (drift risk).

**Used by:** `VideosPage`, `EvidencePage`.

---

## How `lib/` connects to everything else

```
pages/CreatorsPage.tsx
 │
 │ useQuery(["creators"], () => api.get<Page<Creator>>("/creators"))
 │
 ▼
lib/api.ts ──── fetch() ───▶ backend /api/creators
 ▲ │
 │ ▼
 │ JSON { items: [...], total, ... }
 │
 ◀ Returns typed Page<Creator> (uses lib/types.ts)
 │
 ▼
components/Cards.tsx
 │
 │ {formatRelative(creator.lastVideoAt)} ◀── lib/format.ts
 │
 ▼
DOM
```

Seven files now, but the original trio is hit constantly: `api.ts` is
the I/O boundary, `types.ts` is the schema, `format.ts` is the polish.
The rest are pure derivations (`dashboard.ts`, `topicAnalysis.ts`,
`stanceTimeline.ts`) plus the shared `useFilters.ts` hook.

---

## "Where do I look when X happens"

| You want to fix...             | Open...                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| API call returns 500 in the UI | `api.ts` for the error class, then check the actual backend response in Network tab |
| Type error on `creator.foo`    | `types.ts` — either the type is wrong or you're using the wrong field name          |
| A date displays weirdly        | `format.ts` — `formatDate` or `formatRelative`                                      |
| Need to call a new endpoint    | No edit to `api.ts` needed — just call `api.get<YourType>("/your-path")`            |
| Backend added a new field      | Add it to the matching interface in `types.ts`                                      |
