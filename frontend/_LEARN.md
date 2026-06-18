# \_LEARN.md — `frontend/`

> The face of the app. Everything that *shows* lives here.

---

## The story of this folder

If `backend/` is the kitchen, `frontend/` is the **dining room**. It's
what the customer (browser user) actually sees, touches, and clicks. The
tables, menus, lighting, the host who greets you, the printed receipt at
the end — that's all this folder.

The frontend's job is simple to describe and tricky to do well:

1. Ask the backend for data (`GET /api/dashboard`, etc.).
2. Show that data nicely (charts, lists, evidence cards).
3. Let the user click around (drill from a creator to a topic to the
   evidence quote that backed it up).
4. Stay fast, stay accessible, stay pretty.

This folder is built with **React + Vite + TypeScript + Tailwind**. If
you've worked with modern React apps, none of this will be exotic. If
you haven't, the rest of this file is the orientation tour.

---

## File-by-file (top level of `frontend/`)

### `package.json`

**What it is:** the manifest for the frontend specifically. Declares the
React-side dependencies (`react`, `react-dom`, `react-router-dom`,
`@tanstack/react-query`, `@tanstack/react-virtual`, `recharts`, `clsx`)
and dev-side build/test tools (Vite, Vitest, Tailwind, Testing Library,
ESLint, etc.).

**Why it exists:** every Node-based frontend project needs one. This is
the recipe book — `npm run dev` boots the dev server, `npm run build`
produces a production bundle, `npm run test` runs the Vitest suite.

**Used by:** npm, the root workspace `package.json`, every script.

---

### `index.html`

**What it is:** the **single HTML file** the browser actually loads.
It's a tiny stub — a `<div id="root">` and a `<script src="/src/main.tsx">`.
Vite injects the bundled JS and CSS during build.

**Why it exists:** every web app needs an entrypoint. With React, that
entrypoint is a near-empty HTML file because all the actual UI is
generated client-side by React.

**Used by:** the browser (loads this first), Vite (transforms it during
build), `vite.config.ts` (which knows where to find it).

---

### `vite.config.ts`

**What it is:** the configuration for **Vite**, the dev server +
bundler. Tells Vite where the source code is, which plugins to load
(React, PWA), how to proxy API calls during dev (so `/api/*` hits the
backend on port 4000), and how to chunk the production bundle.

**Why it exists:** dev mode needs hot reload + a proxy so the frontend
on port 5173 can call the backend on port 4000 without CORS pain.
Production builds need code-splitting so users don't download the whole
app on first load.

**Used by:** `npm run dev`, `npm run build`, `npm run preview`.

---

### `vitest.config.ts`

**What it is:** the configuration for **Vitest**, the test runner.
Sets up the jsdom environment (jsdom — in plain terms, a pretend
browser made of code so React can paint pages without an actual
browser window), points at the test-setup file (which wires up
`@testing-library/jest-dom`), and configures v8 coverage with the
same 100% line threshold the backend uses.

**Why it exists:** React components can't render in Node by default —
they need a DOM (the live tree of page elements a browser builds from
HTML). jsdom provides one. Coverage thresholds keep the suite
honest as the codebase grows.

**Used by:** `npm run test`, CI.

---

### `tailwind.config.js`

**What it is:** the Tailwind CSS configuration. Tells Tailwind which
files to scan for class names (`./src/**/*.{ts,tsx}`), defines the
custom color palette + breakpoints, and registers any plugins.

**Why it exists:** Tailwind generates CSS on-demand from the class
names you use in your components. It needs to know *where* those class
names live so it can scan them; otherwise it would generate nothing or
generate every possible class (huge bundle).

**Used by:** the Vite plugin pipeline during dev + build.

---

### `postcss.config.js`

**What it is:** the PostCSS configuration — three lines that say "run
Tailwind, then autoprefixer." PostCSS is a CSS assembly line (think
of it as a conveyor belt that passes the CSS through helper tools in
order). Autoprefixer adds vendor prefixes (`-webkit-`, `-moz-` —
little browser-specific tags some properties need to work on older
browsers) automatically.

**Why it exists:** modern CSS needs vendor prefixes for some properties
to work on slightly older browsers. Autoprefixer handles that. PostCSS
is the pipe that connects Tailwind to autoprefixer.

**Used by:** Vite during CSS processing.

---

### `tsconfig.json`

**What it is:** the TypeScript configuration for the frontend. Sets
strict mode, ES2022 target, JSX transformation for React, and path
aliases for cleaner imports.

**Why it exists:** TypeScript can't compile without one. The frontend
has slightly different needs than the backend (JSX support, DOM types
instead of Node types), so it has its own.

**Used by:** `tsc`, Vite (which uses it for type stripping), VS Code's
language server.

---

### `.eslintrc.cjs`

**What it is:** the ESLint configuration for the frontend. ESLint is a
code-style inspector — think of it as a spell-checker for code that
flags problems before they ship. Includes React, React Hooks, JSX a11y
(accessibility — "a11y" is shorthand because there are 11 letters
between the *a* and the *y*), and prettier-compat plugins (add-on
rule packs). The a11y plugin is the one that flags things like missing
`alt` attributes on images (the text a screen reader speaks when it
can't see the picture).

**Why it exists:** to catch bugs and style issues that TypeScript can't.
TypeScript can't tell you that you forgot to add `aria-label` to an
icon button; ESLint can.

**Used by:** `npm run lint`, the editor's ESLint plugin.

---

### `Dockerfile` / `Dockerfile.production`

**What they are:** two recipes for packaging the frontend into
containers.

- `Dockerfile` is a simple build that runs `vite build` and serves the
  static output.
- `Dockerfile.production` uses a multi-stage build with **nginx** in the
  final stage, which is what you'd actually deploy.

**Why they exist:** the production-ready container needs a real web
server (nginx) to serve the static files efficiently and proxy API
calls. The simple one is for local container testing.

**Used by:** `docker build`, deploy pipelines.

---

### `nginx.conf.template`

**What it is:** the **nginx** configuration that the production
Dockerfile uses. Has `${BACKEND_URL}` placeholders that get filled in at
container startup using `envsubst`. Configures:

- Static file serving with long-cache headers for hashed assets
- Falls back all unknown paths to `index.html` (so the SPA's
  client-side router can handle the URL)
- Proxies `/api/*` to the backend

**Why it exists:** SPAs (single-page apps — websites where one HTML
page swaps content in and out instead of loading fresh pages) need a
server that knows two specific tricks (SPA fallback + API proxy —
forward backend calls along). nginx is fast, small, and battle-tested
for this.

**Used by:** `Dockerfile.production` (copied into the final image).

---

## Subfolders (each has its own `_LEARN.md`)

```
frontend/
├── src/ # the actual React + TypeScript source
│ ├── components/ # reusable UI bricks (cards, badges, charts, layout)
│ ├── pages/ # one file per route — Dashboard, Creator, Video, etc.
│ ├── lib/ # generic helpers — API client, formatters, types
│ ├── hooks/ # custom React hooks
│ ├── theme/ # dark/light mode context + provider
│ ├── toast/ # toast-notification context + provider
│ ├── i18n/ # all UI strings (one file: en.ts)
│ ├── App.tsx # top-level routing + providers
│ └── main.tsx # entry point — boots React onto #root
└── tests/ # vitest tests, mirrors src/ structure
```

---

## How the frontend works, in one breath

The browser loads `index.html`, which loads `main.tsx`, which renders
`App.tsx`, which sets up routing + providers (React Query, Theme,
Toast). React Router decides which `pages/X.tsx` to mount based on the
URL. The page uses `useQuery()` (from React Query) to call `lib/api.ts`,
which hits the backend's `/api/...` endpoints. The data comes back and
the page renders `components/*` bricks (StatCard, Charts, etc.) to
display it.

That's the whole story.

---

## How `frontend/` connects to `backend/`

```
 HTTP (port 4000)
[frontend pages] ─────────────────────────▶ [backend /api/* routes]
 │ │
 │ lib/api.ts uses fetch() │
 │ React Query handles caching/retry │
 │ │
 ▼ ▼
[components render the data] [backend returns JSON]
```

In dev, Vite's proxy forwards `/api/*` from port 5173 to port 4000. In
production, nginx does the same.

---

## "Where do I look when X happens"

| You want to fix...             | Open...                                                 |
| ------------------------------ | ------------------------------------------------------- |
| A specific page is broken      | `src/pages/<Name>Page.tsx`                              |
| All pages share a layout issue | `src/components/AppLayout.tsx`                          |
| API call is broken             | `src/lib/api.ts`                                        |
| Number formatting is wrong     | `src/lib/format.ts`                                     |
| Dark mode quirk                | `src/theme/ThemeProvider.tsx`                           |
| A toast doesn't appear         | `src/toast/ToastProvider.tsx`                           |
| Add a new route                | `src/App.tsx` (route table) and add a new `pages/X.tsx` |
| Add a new component            | `src/components/X.tsx`                                  |
| Need a new UI string           | `src/i18n/en.ts`                                        |
