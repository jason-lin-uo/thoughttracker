# \_LEARN.md — `frontend/src/theme/`

> Two tiny files. One job: dark mode.

---

## The story of this folder

Imagine your kitchen has a single light switch — flip it up, light;
flip it down, dark. Easy. Now imagine the kitchen has *two* switches:
one that says "light/dark/follow the time of day," and the kitchen
remembers your choice and respects it across visits. That's harder —
you need to *store* the choice, *respect* the system's time-of-day
preference when you're set to "auto," *react* if the user changes their
OS preference live, and *apply* the actual visual change.

That's what these two files do. They split the work in two:

- `themeContext.ts` defines the **shape** (the types, the React
  Context object, the storage key constant).
- `ThemeProvider.tsx` is the **provider component** that holds the
  state, persists it, applies the CSS class, and listens for OS-level
  changes.

The split is forced by React's Fast Refresh rule: a file that exports
a component shouldn't also export non-component values. So we put the
types and constants in one file (`themeContext.ts`) and the component
in another (`ThemeProvider.tsx`).

---

## File-by-file

### `themeContext.ts`

**What it is:** the **type and context declarations**. About 30 lines.
Defines:

- `ThemeMode` — `"system" | "light" | "dark"` (what the user picked).
- `ResolvedTheme` — `"light" | "dark"` (what the user actually sees,
  after `"system"` gets resolved against the OS preference).
- `ThemeContextValue` — the shape of what's in context (Context in
  React is a shared bulletin board any component can read without
  passing the info down by hand): `{ mode, resolved, setMode }`.
- `ThemeContext` — the React Context object itself.
- `THEME_STORAGE_KEY` — the localStorage key (`"thoughttracker.theme"`).
  (localStorage is a small key/value box the browser keeps for each
  site so settings survive page reloads.)
- `useTheme()` — the hook (a hook is just a function React lets you
  call from a component to plug into shared features) components
  actually call. Throws if used outside a `ThemeProvider`.

**Why it's a separate file:** Vite's React Fast Refresh (the dev-mode
feature that swaps your code in without losing what was on screen)
requires that files exporting React components export *only* React
components. Mixing in non-component exports (constants, hooks, types)
breaks HMR (Hot Module Replacement — the underlying mechanism behind
Fast Refresh, the live-swap-while-running trick). So we put the shape
here and the component there.

**Used by:** `ThemeProvider.tsx` (imports the context to provide it),
`components/ThemeToggle.tsx` (imports `useTheme` to consume it),
several other components that need to know whether dark mode is active
(e.g. `Charts.tsx` for chart colors).

---

### `ThemeProvider.tsx`

**What it is:** the actual provider component. The hard work happens
here.

**The flow:**

1. On mount, read the saved mode from `localStorage` — if absent or
   invalid, default to `"system"`.
2. Read the current OS preference (`prefers-color-scheme: dark`).
3. Compute the resolved theme: if mode is `"system"`, follow the OS;
   otherwise, force the user's pick.
4. Apply the resolved theme by adding/removing the `dark` class on
   `<html>` (which Tailwind's dark mode reads) and setting a
   `data-theme` attribute (which the CSS vars read).
5. Listen for OS-level changes via `matchMedia.addEventListener(
"change", ...)`. (`matchMedia` is the browser's way to ask
   questions like "is dark mode on" and get notified if the answer
   changes.) If the user is in `"system"` mode and toggles their OS
   dark mode, the app updates live.
6. When `setMode(next)` is called, update state + write to
   localStorage.

**The flash-of-light-theme problem and how it's solved:** React doesn't
render until after the page is loaded and JS executes. If we waited for
React, the user would see a light flash before dark mode applies. The
fix: an **inline `<script>` in `index.html`** mirrors the resolution
logic and applies the `dark` class *before* React mounts. This file's
header comment warns: "if you change `THEME_STORAGE_KEY` or the
resolution algorithm here, update `index.html` too."

**The SSR-safe pattern:** (SSR is server-side rendering — when the
page's HTML is built on the server and shipped down ready to view,
instead of being built in the browser. In SSR there is no `window` or
`document`, so blind references to them crash.) Every `window` /
`document` access is guarded by `typeof window === "undefined"`. We
don't actually do SSR, but the guards mean tests in jsdom (which has
limited matchMedia support) don't crash on import.

**Used by:** `main.tsx` (wraps the whole app).

---

## How theme/ connects to everything else

```
index.html ───── inline boot script ─────▶ adds `dark` class before React mounts
 │
 │ (prevents flash of light)
 ▼
main.tsx
 │
 │ <ThemeProvider>
 │ <App />
 │ </ThemeProvider>
 │
 ▼
ThemeProvider
 │
 │ reads localStorage, listens to matchMedia
 │ applies `dark` class to <html>
 │
 ▼
<html class="dark" data-theme="dark">
 │
 ▼
Tailwind: every `dark:bg-zinc-900` etc. activates
CSS vars: --color-bg, --color-text resolve to the dark palette
Charts.tsx: reads CSS vars to color chart lines/axes
ThemeToggle.tsx: shows the current mode, calls setMode() on click
```

---

## The three modes

| Mode                 | Behavior                                     |
| -------------------- | -------------------------------------------- |
| `"system"` (default) | Follow OS preference, live-update on changes |
| `"light"`            | Force light, ignore OS                       |
| `"dark"`             | Force dark, ignore OS                        |

The "system" default is intentional — most users have a system-wide
preference, and respecting it is the most accessible default. Power
users can override per-app.

---

## "Where do I look when X happens"

| You want to fix...                    | Open...                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggle button is wrong                | `components/ThemeToggle.tsx`                                                                                                                       |
| App flashes light on load             | The inline script in `index.html` (must match this file's logic)                                                                                   |
| Dark mode looks ugly                  | The CSS vars in `index.css` and Tailwind's `dark:` classes throughout components                                                                   |
| Chart colors look wrong in dark       | `components/Charts.tsx` — reads CSS vars via `getComputedStyle()`                                                                                  |
| localStorage key collides             | Change `THEME_STORAGE_KEY` in `themeContext.ts` AND `index.html` boot script                                                                       |
| Add a new mode (e.g. "high-contrast") | `themeContext.ts` (extend `ThemeMode`), `ThemeProvider.tsx` (handle the new branch), `index.css` (add the vars), `index.html` (update boot script) |
