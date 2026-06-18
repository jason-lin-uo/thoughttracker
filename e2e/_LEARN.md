# \_LEARN.md — `e2e/`

> Five Playwright spec files (Playwright is a tool that drives a real
> browser the way a person would — clicking, typing, scrolling). The view
> from a real browser. Not jsdom — that's a fake, pretend-browser that
> only lives in memory — but actual Chromium (the open-source guts of
> Chrome) driving real HTTP calls against the running stack.

---

## The story of this folder

The backend has unit tests. The frontend has component tests. Both run
in headless JavaScript runtimes (headless = no visible window, just code
pretending to be a browser in memory) and verify pieces work in isolation.
But neither catches the bug where:

- The backend serves `{ items: [...] }` but the frontend expects `{ data: [...] }`.
- A route in `App.tsx` was added but isn't wired to nav.
- Dark mode breaks on a specific page when the user navigates back.
- Lazy-loading fails because of a typo in the dynamic `import()`.

To catch those, you need to **actually run the whole app and click
through it like a person would**. That's what `e2e/` does. It boots up
Postgres + backend + frontend, opens a real Chromium browser via
**Playwright**, and steps through user flows.

If unit tests are inspecting the freezer's thermostat in isolation,
end-to-end tests are buying groceries, putting them in the freezer,
coming back tomorrow, and verifying the chicken is still frozen.

---

## File-by-file

### `golden-path.spec.ts`

**What it is:** the **canary spec**. Walks a fresh visitor through
the five highest-traffic flows in order:

1. Land on the dashboard, see stat cards populated.
2. Click into a creator, see their overview + timeline chart.
3. Drill into a topic, see the per-topic analysis + evidence.
4. Open one evidence card detail, verify the chunk citation.
5. Open reports or compare creators to verify the insight surfaces.

**Why it exists:** if this spec breaks, the demo is broken. It's the
"recruiter just opened the app on a Monday morning" test. Every
push-to-deploy should pass this.

**Prerequisites:** Postgres up + seed run + backend on :4000 + frontend
on :5173 + `ENABLE_MOCK_MODE=true` (so no real LLM keys are needed).

---

### `compare.spec.ts`

**What it is:** focused spec for the **multi-creator Compare flow**.
Verifies the chip-style picker (select 2-5 creators), the three result
sections (coverage stat cards, shared-topics table, stance-over-time
overlay chart), and the cap at 5 creators.

**Why it exists:** Compare is the most interaction-heavy page in the
app — lots of state, lots of conditional rendering depending on
selection count. Component tests can't catch the "two creators
selected but the chart axis labels overlap" kind of bug. This spec can.

**Prerequisites:** at least 3 seeded creators with overlapping topics.

---

### `a11y.spec.ts`

**What it is:** runs **axe-core** (think of it as an automatic
accessibility inspector — "a11y" is short for "accessibility," the practice
of making sites usable for people with disabilities; axe-core is the
industry-standard rule engine) against every top-level routed page. For
each route, the test:

1. Navigates to the URL.
2. Runs axe with the WCAG 2.1 AA ruleset (WCAG is the global rulebook for
   web accessibility; "AA" is the middle, widely-adopted strictness level).
3. Asserts no serious/critical violations.

**Why it exists:** a recruiter or hiring manager landing on any route
should never see a screen-reader-broken or keyboard-unusable page. This
spec encodes that promise. Adding a new top-level route Add it to the
`PAGES_TO_AUDIT` list — one test per entry.

**What it catches:** missing `alt` text, missing `aria-label` on icon
buttons, color contrast failures, broken focus order, role mismatches.

---

### `visuals.spec.ts`

**What it is:** a **screenshot smoke spec**. Captures full-page
screenshots in:

- Light mode + desktop viewport
- Dark mode + desktop viewport
- Light mode + mobile viewport

Across the main routes. The PNGs land in `test-results/visuals/`
(gitignored). The test asserts the H1 is present *before* taking the
screenshot, so a broken page produces a loud failure instead of a
blank image.

**What it deliberately doesn't do:** pixel-diff regression (think of it
as comparing today's screenshot to yesterday's screenshot pixel by pixel
and failing if anything moved — even by one dot). Recharts + font hinting

- browser version create sub-pixel diffs (tiny, invisible differences)
  across machines. We'd rather have reliable tests than chase those.

**Why it exists:**

- Confirms during dev that a theme/layout change didn't break another
  mode (eyeball the screenshots).
- Useful README/portfolio fodder.
- Cheap regression signal that "this route still renders content."

---

### `trained-model-demo.spec.ts`

**What it is:** the **real-corpus screenshot spec**. Captures screenshots
of the app populated with the restored real creator corpus. The test asserts
on the literal text "Andrew Huberman."

**The smart skip:** the spec probes the dashboard once up front. If
"Andrew Huberman" isn't visible (meaning the real corpus has not been
restored), the test cleanly skips itself. Against the restored corpus, it
captures the full flow.

**Why it exists:** the real-corpus run is a portfolio-worthy result: a real
ML model classifying real transcript data. The screenshots document that
achievement. The skip pattern means CI runners do not fail when the local
real-data dump is absent.

**Prerequisites:** trained-model seed (see `PERSONAL_MACHINE_SETUP.md`).

---

## How specs are organized — by user flow, not by page

Note that the spec names don't mirror page names (no `dashboard.spec.ts`,
`creators.spec.ts`, etc.). Instead, they're named for **user flows**:

- `golden-path` — the main demo
- `compare` — the comparison flow
- `a11y` — the accessibility audit (cross-cutting concern)
- `visuals` — the screenshot capture (cross-cutting concern)
- `trained-model-demo` — the trained-model showcase

This is intentional. E2E tests are slow (seconds per test); the value
they add over unit tests is **exercising real user paths**, not
checking each page in isolation (the component tests already do that).
A flow-based organization aligns with what the test is actually
proving.

---

## How e2e/ connects to everything else

```
[Postgres :5432] ◀─── prisma client ─── [backend :4000] ◀─── HTTP ─── [frontend :5173]
 ▲
 │
 Chromium driven by
 │
 ▼
 Playwright runner
 │
 ▼
 e2e/*.spec.ts
```

The whole stack has to be running for these to pass. The
`playwright.config.ts` (at the repo root) is configured to start the
servers automatically via `webServer.command`.

---

## "Where do I look when X happens"

| You want to fix...                                | Open...                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `golden-path.spec.ts` failing                     | Run the app locally, do the flow by hand, fix whatever's broken                                   |
| A11y violation                                    | The test will name the rule (e.g. `color-contrast`) and the element — fix the component           |
| New page needs a11y coverage                      | Add to `PAGES_TO_AUDIT` in `a11y.spec.ts`                                                         |
| Want a new screenshot variant                     | Add it to `visuals.spec.ts`                                                                       |
| Real-corpus screenshot spec skipping unexpectedly | Check that the real-data dump was restored and Huberman is visible on the dashboard               |
| Test timeouts                                     | E2E tests need real network calls; bump the timeout in `playwright.config.ts` for slow operations |
