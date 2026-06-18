# \_LEARN.md — `frontend/src/`

> Where the actual React app lives. Two entry files, seven subfolders,
> and one stylesheet.

---

## The story of this folder

Look at this folder as a **tree with two roots**:

- `main.tsx` is the **soil-level root** — it's the first JavaScript that
  runs when the browser loads the page. It plants the React app onto
  `<div id="root">` and wires up the providers that everything else
  needs (theme, toast, React Query, router).
- `App.tsx` is the **trunk** — once `main.tsx` boots, control passes to
  `App.tsx`, which is the top-level component holding the route table.
  Every URL the user visits is matched here and routed to the right
  page component.

Below the trunk, the tree branches into seven subfolders, each with a
specific purpose. Below those, the leaves are the actual `.tsx` files
that get rendered to the screen.

---

## File-by-file (root of `src/`)

### `main.tsx`

**What it is:** the **bootstrap file**. It:

1. Creates a `QueryClient` (the React Query cache — think of it as a
   smart sticky-note board that remembers backend answers so we don't
   re-ask the same questions) with sensible defaults — retry once,
   don't refetch on window focus, keep previous list data visible while
   filters/page changes load, and treat data as fresh for two minutes.
2. Seeds the first-paint cache from the committed real-data bootstrap
   snapshot, then marks those queries stale so live API data refreshes in
   the background.
3. Finds `<div id="root">` in the HTML and tells React to take over
   that element.
4. Wraps the whole `<App />` in a stack of providers (a "provider" is
   a wrapper that hands a shared service down to every component
   inside it, like running electricity to every room from one panel):
   StrictMode → ErrorBoundary → Theme → Toast → QueryClient →
   BrowserRouter.

**The provider order matters.** ErrorBoundary (a safety net that
catches crashes and shows a friendly fallback instead of a white
screen) has to be outside theme so the fallback UI itself has access
to *something*; theme has to be outside toast so toasts can be themed;
React Query has to be outside the router so data fetches survive route
changes; the router has to be inside everything (it's the consumer, not
the provider).

**Why it exists:** every React app needs an entry point. This is ours.

**Used by:** the browser, via `<script src="/src/main.tsx">` in
`index.html`.

---

### `App.tsx`

**What it is:** the **route table**. About 50 lines. Defines every URL
the app responds to and which page component handles it.

```tsx
<Route path="/" element={<DashboardPage />} />
<Route path="/creators" element={<CreatorsPage />} />
<Route path="/creators/:creatorId" element={<CreatorOverviewPage />} />
...
<Route path="*" element={<NotFoundPage />} />
```

Also wraps the route content in `<AppLayout>` so every page gets the
chrome for free. The chrome was split in the brand redesign: a desktop
sidebar (brand lockup + nav), a separate full-width `AppHeader` banner
(the prominent wordmark + global search / add-creator / theme actions),
and a mobile top bar + slide-in drawer.

**Why it exists:** without a route table, React Router doesn't know
where to send the user. This is the dispatch board.

**Lazy loading:** two pages (`TopicAnalysisPage`, `ComparePage`) are
loaded via `React.lazy()` — in plain terms, the code for those pages
sits on the shelf and only gets fetched when the user actually walks
to them, instead of shipping with everything else up front. They're
the only pages that import `recharts` — our heaviest dependency at
~383KB raw / ~105KB gzipped. Users who never visit a chart page never
download it. This is a real, measurable improvement to first-paint
speed (how quickly the user sees something on screen).

**Used by:** `main.tsx` (renders `<App />` inside its provider stack).

---

### `index.css`

**What it is:** the **global stylesheet**. Imports Tailwind's three
layers (`base`, `components`, `utilities`) and adds a few global rules
for things Tailwind doesn't cover well:

- `:root` and `[data-theme="dark"]` CSS custom properties for theme
  colors (so the chart library can read them).
- `body` and `html` defaults (font-family, scroll behavior).
- A handful of `.btn`, `.card` `@apply` shortcuts.

**Why it exists:** Tailwind is fantastic but it doesn't generate CSS
variables (which Recharts needs). It also doesn't set body defaults.
This file fills those gaps.

**Used by:** `main.tsx` (imported for its side effects — the styles
are injected into the page).

---

### `test-setup.ts`

**What it is:** a 20-line file that runs once before any test file
executes. It:

- Imports `@testing-library/jest-dom` (so tests can use matchers like
  `toBeInTheDocument()` — these are the readable assertions, "is this
  thing on screen").
- Patches `window.matchMedia` (the browser feature that answers "is
  this screen wide enough" or "does the user prefer dark mode" —
  jsdom doesn't implement it) so the theme provider's media-query
  check doesn't crash in tests.
- Patches `IntersectionObserver` (the browser tool that watches when
  things scroll into view — also missing from jsdom) for the
  virtualized list tests (lists that only render the rows you can see,
  for speed — more on this in the components doc).

**Why it exists:** jsdom is *almost* a real browser but missing a few
APIs (built-in browser features) that modern React apps assume exist.
This file polyfills them (a polyfill is a stand-in that fakes a
missing feature) so tests don't crash on import.

**Used by:** Vitest, configured via `setupFiles` in `vitest.config.ts`.

---

### `vite-env.d.ts`

**What it is:** a one-line TypeScript ambient-declaration file —
`/// <reference types="vite/client" />`. Tells TypeScript about Vite's
extra globals (`import.meta.env`, `import.meta.glob`, etc.).

**Why it exists:** without this, TypeScript would complain that
`import.meta.env.VITE_API_URL` is `unknown`. With it, you get
intellisense for environment variables.

**Used by:** the TypeScript compiler.

---

## Subfolders

| Folder        | What lives here                                                     |
| ------------- | ------------------------------------------------------------------- |
| `components/` | Reusable UI bricks — buttons, cards, charts, layout chrome          |
| `pages/`      | One `.tsx` per route — DashboardPage, CreatorOverviewPage, etc.     |
| `lib/`        | Plain TypeScript helpers — API client, formatters, type definitions |
| `hooks/`      | Custom React hooks (currently just `useApiCall`)                    |
| `theme/`      | Dark/light mode context + provider                                  |
| `toast/`      | Toast-notification context + provider                               |
| `i18n/`       | All UI strings, centralized in one file                             |

Each has its own `_LEARN.md`.

---

## How a render flows

When the user navigates to `/creators/abc123`:

1. **`main.tsx`** has already set up providers; doesn't re-run.
2. **`BrowserRouter`** sees the URL change.
3. **`App.tsx`** matches the URL against its `<Route>` table → mounts
   `<CreatorOverviewPage />`.
4. **`AppLayout`** (which wraps Routes) keeps the chrome — sidebar, the
   `AppHeader` brand banner, and the mobile top bar/drawer — stable
   across navigations.
5. **`CreatorOverviewPage`** runs. Inside it:

- `useParams()` extracts `creatorId = "abc123"`.
- `useQuery()` from React Query calls `lib/api.ts` →
  `GET /api/creators/abc123`.
- While loading, render `<LoadingState />` from `components/States.tsx`.
- On error, render `<ErrorState />`.
- On success, render the data using `components/StatCard.tsx`,
  `components/Cards.tsx`, etc.

That's the lifecycle, every time.

---

## What lives in `components/` vs `pages/`

A common confusion. Here's the rule:

- **A `pages/X.tsx` file is mounted by a `<Route>`** in `App.tsx`. It
  has a URL. It does the page-level data fetching. There's exactly one
  page per route.
- **A `components/X.tsx` file is rendered by another component** —
  never by a route directly. It has no opinions about which page it's
  on; it just renders props.

If you find yourself writing a "page" that's reused on multiple routes,
move it to `components/`. If you find yourself writing a "component"
that calls `useParams()` or fetches its own data, it's probably a page.

---

## "Where do I look when X happens"

| You want to fix...       | Open...                                                         |
| ------------------------ | --------------------------------------------------------------- |
| App fails to boot at all | `main.tsx`                                                      |
| New URL needs to exist   | `App.tsx` + a new `pages/X.tsx`                                 |
| Theme/dark-mode bug      | `theme/ThemeProvider.tsx` and `index.css` (CSS vars)            |
| Global style change      | `index.css`                                                     |
| Test imports fail        | `test-setup.ts` (probably need to polyfill another browser API) |
