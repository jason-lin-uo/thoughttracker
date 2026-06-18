# UI Redesign References

A bookmark file for frontend visual polish. An **initial redesign has
already landed** — the neutral `AppHeader` banner with its amber keyline
and navy `ThoughtTracker` wordmark, the navy brand palette, accent-toned
and clickable `StatCard` tiles, and the dashboard featured-insight hero.
The UI is functional, accessible, and
tested at 100% coverage, and no longer reads as purely "engineer-built."

These references stay useful for the **remaining polish** — pushing the
data-dense pages (especially the Topic Analysis page and the comparison
charts) further toward "designer-built" territory.

The rule when iterating: **pick ONE reference and copy its visual
language closely**. Mixing styles produces something worse than
copying a single reference well. The Tier 1 list is where to start.

---

## Tier 1 — Closest analogues to ThoughtTracker

These products are the nearest neighbors to what ThoughtTracker is.
Their information architecture and UX patterns can be borrowed
nearly wholesale.

### Ground News — [ground.news](https://ground.news)

**The single best reference.** Ground News shows news outlets and
topics over time with political-bias indicators and beautiful
timeline comparisons. Their "blindspot" feature is conceptually
identical to what a contradiction detector would be in
ThoughtTracker. Profile pages for individual outlets are the model
for what `CreatorOverviewPage` should aspire to.

**Steal:** the outlet/topic detail pages, the bias-spectrum
visualization, the per-story timeline view, the comparative-coverage
panel.

### AllSides — [allsides.com](https://allsides.com)

Same concept as Ground News (media bias visualization) but less
polished. Worth studying for the information architecture even if
the visual execution is less impressive.

**Steal:** how they structure "this outlet on this topic" pages.

### Bellingcat — [bellingcat.com](https://bellingcat.com)

Long-form investigative analysis with great timelines. Their
analyses of how specific actors' positions shifted over time are
conceptually identical to ThoughtTracker's per-creator-per-topic
timeline.

**Steal:** how they present a timeline of evidence — quotes with
dates, sources linked, visual progression.

---

## Tier 2 — Adjacent SaaS dashboards (clean visual language)

Not the same domain, but the dashboard pattern is the right template
for ThoughtTracker's analytics pages.

### PostHog — [posthog.com](https://posthog.com) (signed-in dashboard)

**The cleanest open-source analytics dashboard.** Sidebar nav + main
canvas + stat cards + chart panels. **This is the visual template
to clone for ThoughtTracker's dashboard.** Their detail pages
(per-person, per-event) map directly onto ThoughtTracker's
per-creator and per-topic pages.

**Steal:** the entire dashboard chrome (sidebar, header, stat cards),
the chart panel styling, the empty-state aesthetic.

### Plausible Analytics — [plausible.io/demo](https://plausible.io/demo)

Minimal, data-dense, fast-feeling. Single-page focus that loads
many charts at once without feeling cluttered.

**Steal:** how they fit many charts onto one page without it
feeling crowded; the typography hierarchy.

### Linear — [linear.app](https://linear.app)

Not a data app, but the gold standard for "engineer-designed UI
that doesn't look engineer-designed." Dense, dark, fast.

**Steal:** typography, density, dark mode treatment, keyboard-first
interaction patterns, motion polish.

### Vercel dashboard — [vercel.com/dashboard](https://vercel.com/dashboard)

The reference for clean Tailwind + shadcn/ui aesthetics. Recruiters
recognize this look immediately.

**Steal:** light-mode color palette, button styles, dialog/modal
patterns.

---

## Tier 3 — Data viz / journalism (for chart inspiration)

When the dashboard pattern is solid but the individual charts need
to feel more meaningful.

### The Pudding — [pudding.cool](https://pudding.cool)

Some of the best data-driven journalism on the web. Per-actor
timelines, comparative analyses, custom visualizations.

**Steal:** how to make a chart feel *editorial* — annotations,
callouts, narrative framing around the data.

### FiveThirtyEight — [fivethirtyeight.com](https://fivethirtyeight.com)

Classic polling/stats viz. `StanceOverTimeChart` should feel like
one of theirs.

**Steal:** confidence band visualizations, multi-line comparison
charts, the "this is data, take it seriously" tone.

### NYT Upshot — [nytimes.com/section/upshot](https://www.nytimes.com/section/upshot)

Political analysis with beautiful charts. Reference for how a
chart can carry editorial weight.

**Steal:** the way they pair a chart with a short explanatory caption
that sets context without bloating the page.

### Our World in Data — [ourworldindata.org](https://ourworldindata.org)

Clean, dense, scientific. Great for the "explore by topic" pattern.

**Steal:** the topic-index pages — could inform a future Topics
landing page on ThoughtTracker.

### Bloomberg Graphics — [bloomberg.com/graphics](https://www.bloomberg.com/graphics)

Premium polish; hard to match but worth seeing what's possible at
the high end.

**Steal:** typography, axis treatment, color restraint.

---

## Niche / Domain-Specific

### PolitiFact — [politifact.com](https://www.politifact.com)

Per-figure profile pages with statement history. Visual archetype
for "show me everything a person has said about X over time."

**Steal:** the way each statement card carries metadata (date,
source, claim, verdict) compactly.

### Capitol Trades — [capitoltrades.com](https://www.capitoltrades.com)

Tracks how US senators vote and trade stocks over time. Beautiful
timeline + per-actor profile UX. **Conceptually almost identical
to ThoughtTracker** — different domain (trades vs stance), same
shape (per-actor timeline of behavior over time).

**Steal:** the per-actor profile page layout (stats panel + timeline

- activity feed); the timeline UX itself.

### Glimpse — [meetglimpse.com](https://meetglimpse.com)

Topic trend dashboards. Their topic-detail pages are a great
reference for what `TopicAnalysisPage` could become.

**Steal:** the topic-detail page anatomy — overview stat, trend
chart, related entities, representative content.

---

## Toolkit for the actual rebuild

When the redesign happens, the right kit is:

| Tool                         | Purpose                                                                        | Cost   |
| ---------------------------- | ------------------------------------------------------------------------------ | ------ |
| **v0.dev**                   | AI UI generator that outputs React + Tailwind                                  | $20/mo |
| **Tremor**                   | React dashboard components (charts, KPI cards) — built for this exact use case | Free   |
| **shadcn/ui**                | Baseline components (buttons, cards, dialogs, tables)                          | Free   |
| **Aceternity UI / Magic UI** | Animation snippets for "wow moments" (hero, page transitions)                  | Free   |

**v0 prompt template** (paste this with screenshots of your reference + the existing page):

> Redesign this ThoughtTracker `<page-name>` in the visual style of
> Ground News + PostHog. Match Ground News for the
> topic-coverage breakdown and timeline aesthetic. Match PostHog
> for the sidebar nav, stat cards, and chart panel layout. Use
> Tremor for chart components and shadcn/ui for everything else.
> Dark mode default. Inter typeface. Match these screenshots
> for visual style: [attach screenshots].

---

## The trap to avoid

Generating UI without a specific reference produces **generic
"modern SaaS"** — bright purple accents, lots of gradients,
glassmorphism cards. That look is already dated and screams
AI-generated. Always anchor the AI to a specific reference product
via screenshots and explicit "match this style" instructions.

---

## Process sketch (incremental, not big-bang)

1. Pick a reference (Ground News + PostHog is the recommended pair).
2. Screenshot 5-10 pages of the reference.
3. Install Tremor + shadcn/ui in the existing frontend (additive — doesn't break anything).
4. Redesign **one** page (recommended: `DashboardPage`) using v0 with
   the screenshots as anchors. Iterate until it's clearly better than
   the existing version.
5. Critique loop: take a screenshot of the new page, paste into Claude
   or GPT-4o with a "harsh design critique" prompt, apply the fixes.
6. Once the first page is genuinely good, port the visual vocabulary
   to subsequent pages (same components, same spacing, same typography).
7. Update Playwright `visuals.spec.ts` baselines and any unit tests
   whose text-content assertions break.

Do not commit to a full rewrite up front. Iterate one page at a time.
