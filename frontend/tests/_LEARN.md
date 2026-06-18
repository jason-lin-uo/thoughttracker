# \_LEARN.md — `frontend/tests/`

> The proof that the UI works. Same shape as `backend/tests/`, but for
> React instead of Express. 100% line coverage.

---

## The story of this folder

The backend has a building inspector who walks through the kitchen and
verifies every appliance. The frontend has the same — but for **the
dining room**. Each component, hook, and page is mounted in a real
React tree (powered by jsdom), then poked, clicked, and inspected to
verify it behaves correctly.

The tests are organized so each file targets one slice of the UI. The
structure mirrors `src/` exactly:

```
src/components/X.tsx ──── tested by ────▶ tests/components/X.test.tsx
src/pages/X.tsx ──── tested by ────▶ tests/pages/X.test.tsx
src/lib/X.ts ──── tested by ────▶ tests/lib/X.test.ts
src/hooks/X.ts ──── tested by ────▶ tests/hooks/X.test.tsx
src/theme/, toast/ ──── tested by ────▶ tests/theme/, tests/toast/
```

If you want to fix a test for `Cards.tsx`, you open
`tests/components/Cards.test.tsx`. The 1:1 mapping is intentional.

---

## File-by-file

### `App.test.tsx`

**What it is:** smoke tests for `App.tsx` — verifies routes render the
expected page component, that the catch-all `*` route hits
`NotFoundPage`, and that the lazy-loaded pages don't blow up on first
load.

**Used for:** catching routing regressions when someone renames a route
or forgets a `<Route>` registration.

---

### `components/` — one file per component

Each component has a matching test file:

- `AppLayout.test.tsx` — sidebar nav, hamburger toggle, theme button.
- `Badges.test.tsx` — typed wrappers produce the right colors, labels
  are humanized correctly.
- `Cards.test.tsx` — card variants render their props, evidence card
  formats the citation.
- `Charts.test.tsx` — chart wrappers mount Recharts with the right
  data structure (we don't deeply test Recharts' rendering — that's
  their job).
- `ErrorBoundary.test.tsx` — throws a child, asserts the fallback UI.
- `StatCard.test.tsx` — value, label, trend hint render.
- `States.test.tsx` — loading/error/empty states render their text;
  `Field` wraps `<input>` correctly and the label clicks focus the input.

---

### `hooks/useApiCall.test.tsx`

**What it is:** tests the custom hook in isolation. Uses
`@testing-library/react`'s `renderHook()` (a helper for testing a hook
on its own, in a tiny pretend component, without needing a real page)
to call the hook outside any page, mocks the API call (a "mock" is a
stand-in — fake answers we feed in so the test doesn't need a real
backend), and asserts that toasts fire correctly on success and
failure.

---

### `lib/` — one file per lib module

- `api.test.ts` — mocks `global.fetch` (replaces the real network
  call with a fake we control), asserts the request URL and body
  shape, asserts `ApiError` thrown on non-2xx (any response code
  outside the 200-range, i.e. anything that isn't "").
- `format.test.ts` — every formatter function tested with realistic
  inputs + edge cases (`null`, invalid dates, zero, negative).

---

### `theme/theme.test.tsx`

**What it is:** tests for `ThemeProvider` — initial mode resolution,
localStorage persistence, OS-preference live update via mocked
`matchMedia`, applied `dark` class on `<html>`.

---

### `toast/toast.test.tsx`

**What it is:** tests for `ToastProvider` — `showToast()` adds a
toast, auto-dismiss after duration, manual dismiss via button,
cap-at-5 enforcement, role/aria correctness for each kind.

---

### `pages/` — page tests

This is where the bulk lives because pages do the most work.

| File                                  | What it covers                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `pages.test.tsx`                      | Each page's happy path — mount with mocked API, assert headline content renders    |
| `pages-interactions.test.tsx`         | User interactions — clicking filters, submitting forms, navigating between pages   |
| `ComparePage.test.tsx`                | The most interaction-heavy page (picker, side-by-side rendering) gets its own file |
| `coverage-page-filters.test.tsx`      | First-pass file for filter dropdowns + edges the main page tests didn't hit        |
| `coverage-page-interactions.test.tsx` | Second pass — error states, empty states, edge query params                        |
| `coverage-page-stragglers.test.tsx`   | Final-mile branches for honest 100% line coverage                                  |

Like `backend/tests/`, the `coverage-*` files exist because getting to
100% requires hitting branches the natural happy-path tests don't
visit (error responses, empty data, query params with edge values).
Rather than weakening the coverage gate to 95%, we wrote focused
files.

---

## Tools used in tests

| Tool                            | What it does                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vitest**                      | The test runner — the program that finds your test files, runs them, and reports pass/fail (replaces Jest; faster, same API mostly)                                                   |
| **@testing-library/react**      | The "render this React tree in jsdom" library — best practice for testing components by behavior (what the user sees), not by implementation (the internal code structure)            |
| **@testing-library/user-event** | Simulates real user interactions (clicks, typing) with proper event order — a fake user driving the app                                                                               |
| **@testing-library/jest-dom**   | Adds matchers (readable assertion words) like `toBeInTheDocument()`, `toBeVisible()`, `toHaveAccessibleName()`                                                                        |
| **jsdom**                       | A Node-based DOM implementation — in plain terms, a pretend browser made of code that provides `document`, `window`, etc., so React can render in tests without a real browser window |

---

## The "render and query" pattern

Most tests follow this shape:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("clicking the retry button refetches", async () => {
 // mock fetch with a failure, then a success
 fetchMock.mockResponseOnce(JSON.stringify({ error: "..." }), { status: 500 });
 fetchMock.mockResponseOnce(JSON.stringify({ items: [...] }));

 render(<TestWrapper><CreatorsPage /></TestWrapper>);
 // initial fetch fails; error UI renders
 expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
 // click retry
 await userEvent.click(screen.getByRole("button", { name: /retry/i }));
 // success UI renders
 expect(await screen.findByText(/jane doe/i)).toBeInTheDocument();
});
```

`render` + `screen.findBy*` + `userEvent.click` is the canonical
React-Testing-Library style. **Never query by class name** (the CSS
hooks like `.btn-primary` — those change with styling) — query by
role (button, link, heading), label, or visible text (the same way a
user or screen reader would actually find things).

---

## How tests/ connects to everything else

```
src/* (production code)
 ▲
 │ imported and rendered by
 │
tests/*.test.tsx
 │
 │ rendered into test results by
 │
vitest.config.ts
 │ reads
 ▼
src/test-setup.ts (polyfills jsdom-missing browser APIs)
```

`tests/` is downstream of `src/`. Production code never imports from
tests.

---

## "Where do I look when X happens"

| You want to fix...                                      | Open...                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Specific test failing                                   | `tests/<mirror-of-src>.test.tsx`                                                                             |
| Coverage dropped below 100%                             | `vitest --coverage` to see which lines are uncovered; likely a `coverage-*` file needs updating              |
| Test crashes on import with "matchMedia is not defined" | Add a polyfill to `src/test-setup.ts`                                                                        |
| Tests pass locally but fail in CI                       | Usually a timing issue — wrap an async assertion in `findBy*` instead of `getBy*`                            |
| Want to test something hard to test                     | If a component does too much, refactor the logic out into a pure helper in `lib/` and unit-test that instead |
