# \_LEARN.md — `frontend/src/components/`

> Nineteen files — eleven reusable UI bricks here, plus an eight-file
> `topic-analysis/` subtree of analyst-console parts. The bricks every
> page is built from.

---

## The story of this folder

Think of the frontend as a brick building. The **pages** in
[`../pages/`](../pages/_LEARN.md) are the rooms — each room (URL) has a
purpose. But you don't build a room by gluing concrete together; you
build it with **bricks**. Standard, reusable, well-shaped bricks.

This folder is the brick pile. Every component here is a re-usable
piece of UI that has no opinion about *which page* it's on — it just
takes props, renders, and gets out of the way. The pages do the data
fetching and arrange the bricks.

The bricks split into a few families:

- **Layout bricks** — `AppLayout` (the page chrome: desktop sidebar +
  mobile top bar/drawer), `AppHeader` (the desktop full-width brand
  banner above the content column), `ErrorBoundary` (the crash net).
- **Display bricks** — `StatCard` (big number on the dashboard),
  `Cards` (the lozenge-shaped content cards), `Badges` (the colorful
  pills for stance / confidence / status), `Charts` (Recharts wrappers).
- **State bricks** — `States` (loading, error, empty states + form
  field helpers).
- **Behavior bricks** — `VirtualizedList` (long lists without rendering
  10,000 DOM nodes), `ThemeToggle` (the dark-mode switch).
- **Analyst-console bricks** — `StanceTimeline` (the verdict + dotted
  stance timeline) plus the `topic-analysis/` subtree (`VerdictHero`,
  `StanceTrajectoryChart`, `StanceRibbon`, `StanceHeatmap`,
  `EvidenceList`, `EpisodeModal`, `DateRangeBar`, `ConsoleStats`) — the
  parts the topic-analysis page composes.

---

## File-by-file

### `AppLayout.tsx`

**What it is:** the **page chrome**. Every page renders inside this. It
provides:

- A persistent left sidebar (the brand lockup + nav links: Dashboard,
  Imports, Add Creators, Creators, Compare, Videos, Topics, Evidence,
  Reports; the order comes straight from the `NAV`
  array).
- The full-width `<AppHeader>` brand banner across the top of the
  content column (a separate component — see below).
- A `<main>` container where the actual page content goes.
- Responsive collapse: on mobile, the sidebar becomes a hamburger
  drawer and the banner is hidden, so a compact top bar (brand + theme
  toggle + hamburger) owns the chrome instead.

**Why it exists:** without it, every page would have to re-render the
sidebar + header on every navigation. With it, the layout sits stable
and only the route content changes (smoother user feel, less flicker).

**Used by:** `App.tsx` (wraps all routes).

---

### `AppHeader.tsx`

**What it is:** the **desktop brand banner** — a full-width bar across
the top of the content column (`hidden lg:block`, so it only shows on
`lg+`). Neutral background (white / `ink-950` in dark mode) with a slim
amber keyline along the bottom; the gradient "ThoughtTracker" wordmark
is the page's largest element so the eye lands on the product first. On
the right sit the always-reachable global actions: a Search link, an
"Add creator" link, and the `<ThemeToggle>`.

**Why it exists:** these global actions used to be duplicated in each
page's title bar (e.g. the dashboard's "new import" + search). Hoisting
them into one banner removes the duplication and gives the app a
consistent identity row. On mobile the banner is hidden — the
`AppLayout` top bar + drawer carry the brand and actions there instead.

**Used by:** `AppLayout.tsx` (rendered atop the content column).

---

### `ErrorBoundary.tsx`

**What it is:** React's official **error-catching mechanism** (think
of it as a safety net stretched under the trapeze), used once at the
top of the tree. If any descendant throws (crashes) during render,
ErrorBoundary catches it, logs to console, and shows a friendly
"Something went wrong" screen with a "Reload" button — instead of the
white-screen-of-death that an uncaught error would cause.

**Why it exists:** React errors don't bubble like normal exceptions —
if a component throws and nothing catches it, React unmounts the
*entire* root (rips down the whole page). That's catastrophic for user
experience. ErrorBoundary is the safety net.

**Used by:** `main.tsx` (the outermost wrap, so it catches even
provider errors).

---

### `StatCard.tsx`

**What it is:** a small card that shows a single big number with a
label and an optional one-line hint. The kind of thing you see at the
top of dashboards: "**1,247** total videos". An optional `tone` tints
the card (blue / teal / violet / amber / rose) so a cluster carries
real color, and an optional `to` turns the whole tile into a router
`<Link>` drill-down (the dashboard's tiles link to /creators, /videos,
/topics, /evidence).

**Why it exists:** the dashboard shows a row of these, and they also
appear on the creator overview and compare clusters. One reusable
component, many instances.

**Props:** `{ label, value, hint, icon, to, tone }`. Pure
presentation; no data fetching.

**Used by:** `DashboardPage`, `CreatorOverviewPage`, `ComparePage`.

---

### `Cards.tsx`

**What it is:** the **content-card family** — `Card`, `CardHeader`,
`CardBody`, plus specialty cards like `EvidenceCard` (formats a
chunk's evidence quote with a citation), `TopicCard` (a topic name +
mention count + relevance bar). About 300 lines total.

**Why it exists:** lozenge-shaped content cards are the dominant visual
pattern in this app — every list of "stuff" renders as a stack of
cards. Centralizing the styling means every card on every page has
the same rounded corners, the same border, the same hover state.

**Used by:** virtually every page that lists items.

---

### `Badges.tsx`

**What it is:** the **colored-pill family**. Has a low-level `Badge`
primitive plus typed wrappers — `StanceBadge`, `ConfidenceBadge`,
`StatusBadge`, `TrendBadge`.

The typed wrappers encode the label-to-color mapping so the colors
stay consistent. "Supportive" is always blue. "Opposed" is always red.
"Mixed" is always purple. The wrapper knows that mapping; pages just
pass the label.

**Why it exists:** if you let every page choose its own color for
"opposed," you end up with red on one page and orange on another. The
typed wrappers prevent that drift.

**Used by:** every page that shows stance, confidence, status, or
trend labels (almost all of them).

---

### `Charts.tsx`

**What it is:** Recharts wrappers (Recharts is the third-party
chart-drawing library we use — wrappers are our thin custom layer on
top so the rest of the code talks to *us*, not the library directly) —
`StanceTimelineChart`, `TopicFrequencyChart`, etc. About 220 lines.
Reads CSS variables (named color slots like `--chart-line` that the
stylesheet defines — think of them as labeled paint cans the chart
code can dip into) from the document root to color chart elements
correctly in both light and dark mode.

**Why it exists:** Recharts is powerful but verbose; we'd otherwise be
copying 30 lines of `<LineChart><Line><XAxis>...</...>` setup at every
chart usage site. The wrappers reduce that to `<StanceTimelineChart
data={...} />`.

**The dark-mode trick:** Recharts can't read Tailwind classes
directly. So we set CSS variables (`--chart-line`, `--chart-axis`,
etc.) in `index.css` that change with the theme, and the wrappers
pass `getComputedStyle(document.documentElement).getPropertyValue('--chart-line')`
(a browser built-in that returns the current value of one of those
labeled paint cans) into Recharts.

**Used by:** `TopicAnalysisPage`, `ComparePage`, `DashboardPage`,
`CreatorOverviewPage`. Notable: this is the heaviest dependency in the
app (~105KB gzipped), which is why the two big chart pages are
lazy-loaded.

---

### `States.tsx`

**What it is:** the catch-all file for **loading / error / empty
states** AND the **form-field wrapper**. About 260 lines.

Exported pieces:

- `<LoadingState>` — the spinner + "Loading…" text shown during fetches.
- `<ErrorState>` — the friendly error display with a retry button.
- `<EmptyState>` — the "Nothing here yet" placeholder with an icon + CTA
  (call to action — the button or link nudging the user to do the next
  thing).
- `<Field>` — a `<label>` wrapper that pairs a visible label with the
  input it wraps. Used in every form so WCAG label associations (WCAG
  is the web's official accessibility rulebook; label associations
  mean each input is officially linked to its label so screen readers
  announce it correctly) stay baked in.

**Why "States" + "Field" share a file:** they're all small UI pieces
that don't have a richer home. Lumped together so we don't have a
folder of single-component files.

**Used by:** every page that has loading/error states (all of them),
and form-heavy pages such as ImportsPage.

---

### `ThemeToggle.tsx`

**What it is:** the three-state segmented control (Light / System /
Dark) that rides in the desktop `AppHeader` banner and the mobile top
bar. Reads from `useTheme()` and calls `setMode()`.

**Why it exists:** users want to control their dark-mode preference
without leaving the app. This is the surface that lets them.

**Used by:** `AppHeader.tsx` (desktop) and `AppLayout.tsx` (the mobile
top bar).

---

### `VirtualizedList.tsx`

**What it is:** a wrapper around `@tanstack/react-virtual` that only
renders the rows currently visible in the viewport (the slice of page
the user can actually see right now) plus a small buffer. For a list
of 10,000 items, only ~20 DOM nodes (the page elements the browser
actually has to keep around and draw) exist at a time. As the user
scrolls, rows render in and out.

**Why it exists:** without virtualization (the trick of only drawing
what's on screen — think of a long parade where only the floats in
front of you exist), listing 1,000 creators would put 1,000 card
components in the DOM. That's slow to render and hurts scroll perf.
With virtualization, the cost stays flat regardless of list size.

**When to use:** lists over ~25-30 items. Smaller lists don't need it
(the virtualizer has overhead of its own; below the threshold a plain
`.map()` is faster and simpler).

**Used by:** `CreatorsPage`, `VideosPage`, `EvidencePage` — the three
list pages that can have large result sets.

---

### `StanceTimeline.tsx`

**What it is:** the **hero of the topic-analysis view** — a single
plain-language verdict up top ("Leans supportive — steady since 2021" /
"Shifted: opposed → supportive in 2023") over a horizontal axis of
stance-colored dots. Selecting a dot reveals that moment's evidence
quote + a link to the source video. The verdict logic lives in
`lib/stanceTimeline.ts` so it's testable without the DOM.

**Used by:** the topic-analysis view (a creator × topic).

---

### `topic-analysis/` (subfolder)

The **analyst-console** bricks the topic-analysis page composes. Each
is a thin renderer over the pure derivations in `lib/topicAnalysis.ts`
(all date-range filtering happens client-side, so these stay
presentational):

- `VerdictHero` — the headline verdict + "{pct}% of {n} videos" meta.
- `StanceTrajectoryChart` — the SVG dot trajectory over time.
- `StanceRibbon` — the "overall balance" proportional stance bar + legend.
- `StanceHeatmap` — a month-bucketed stance grid.
- `EvidenceList` — the filterable / sortable evidence-row list.
- `EpisodeModal` — the focused dialog opened from a dot or heatmap cell.
- `DateRangeBar` — the range presets (All / 90 / 60 / 30) + custom inputs.
- `ConsoleStats` — the compact videos / evidence / avg-confidence / topics row.

---

## How components/ connects to everything else

```
pages/CreatorOverviewPage.tsx
 │
 │ imports: AppLayout (via App.tsx), StatCard, Cards, Charts, Badges, States
 │
 ▼
components/ (each component is independent — they don't import each other much)
 │
 │ uses: lib/types.ts, lib/format.ts, i18n/en.ts, theme/useTheme, toast/useToast
 │
 ▼
DOM
```

Components are **leaves** in the dependency tree — they pull in
`lib/`, `i18n/`, `theme/`, `toast/`, but rarely each other (the
exceptions: `AppLayout` uses `AppHeader` + `ThemeToggle`, `AppHeader`
uses `ThemeToggle`, and the `topic-analysis/` parts reuse `Badges` /
`States`).

---

## "Where do I look when X happens"

| You want to fix...                                                | Open...                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sidebar / mobile drawer layout                                    | `AppLayout.tsx`                                                                         |
| Brand banner / global header actions (search, add-creator, theme) | `AppHeader.tsx`                                                                         |
| App white-screened from an error                                  | `ErrorBoundary.tsx` for the fallback UI; the actual bug is in whichever component threw |
| Number display in a stat card                                     | `StatCard.tsx`                                                                          |
| Card border, padding, hover                                       | `Cards.tsx`                                                                             |
| Wrong color for a stance/confidence/status label                  | `Badges.tsx` — the typed wrapper's color map                                            |
| Chart axis labels wrong in dark mode                              | `Charts.tsx` + check `index.css` chart vars                                             |
| Loading spinner looks wrong                                       | `States.tsx` (`LoadingState`)                                                           |
| Form input has no label                                           | Wrap it in `<Field label="X">` from `States.tsx`                                        |
| Theme toggle button doesn't switch                                | `ThemeToggle.tsx` + `theme/ThemeProvider.tsx`                                           |
| Long list scrolls slowly                                          | Wrap the list in `VirtualizedList`                                                      |
