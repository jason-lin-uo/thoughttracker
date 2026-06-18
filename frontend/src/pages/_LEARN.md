# \_LEARN.md — `frontend/src/pages/`

> Seventeen files. Every URL the app responds to. Each one is a "screen."

---

## The story of this folder

If `components/` is the brick pile, `pages/` is the **set of rooms**
built from those bricks. Each file in this folder is mounted by a
`<Route>` in `App.tsx` — open the URL, you see the page.

A page is the **conductor** of its own URL. It:

1. Reads route params (`useParams()` — the helper that pulls values
   out of the URL, like grabbing `abc123` out of `/creators/abc123`)
   and query strings (`useSearchParams()` — same idea for the
   `filter=foo&page=2` part).
2. Fetches data with `useQuery()` from React Query (the standard
   "ask the backend and remember the answer" helper), pointing at
   `lib/api.ts`.
3. Handles loading / error / empty states (using `<LoadingState>`,
   `<ErrorState>`, `<EmptyState>` from `components/States.tsx`).
4. Renders the data using bricks from `components/`.
5. Wires up any actions the user can take (clicking a card to
   navigate, filling out a form to submit a search, etc.).

The folder has 17 files — one per URL the app supports. None of them
are huge (largest is `VideosPage.tsx`, which has filters + pagination +
table view + virtualization). Most are around 150-200 lines.

---

## File-by-file

### `DashboardPage.tsx`

**What it is:** the **home page** at `/`. Leads with a single
**FeaturedShift hero**: the latest generated topic report when it maps to
analyzed data, otherwise the strongest analyzed fallback from the server's
`featuredInsight`. Below it: a row of four clickable `<StatCard>`s (creators /
videos / topics / evidence, each linking to its list) and rails of recent
creators, recent imports, and recent reports.

**Endpoints used:** `GET /api/dashboard`.

**Why it exists:** the user lands here first; the dashboard answers
"what's in the system right now" without making them dig.

---

### `ImportsPage.tsx`

**What it is:** the page at `/imports`. Lists all import jobs (one per
batch upload), shows their status, and has a form section at the top
to **start a new import** (paste a YouTube channel handle or a CSV of
URLs).

**Endpoints used:** `GET /api/import-jobs`, `POST /api/import-jobs/bulk`.

---

### `ImportJobDetailPage.tsx`

**What it is:** the page at `/imports/:jobId`. Shows one specific
import job's details: progress bar, per-item statuses (which videos
imported successfully, which failed, which are still processing), and
a refresh button. Auto-refreshes every 5 seconds while the job is
in progress.

**Endpoints used:** `GET /api/import-jobs/:id`, `GET /api/import-jobs/:id/items`.

---

### `AddCreatorsPage.tsx`

**What it is:** the page at `/add-creators` (also the dashboard's empty-
state CTA and the header's "Add creator" action). Paste a batch of
YouTube channel URLs / `@handles` (one per line, de-duplicated) and
kick off onboarding. The preferred path posts the whole batch to the
creator-onboarding pipeline; a per-channel import-job fallback deep-
links each row to its job detail page.

After the admin PIN unlocks the page, it also reveals the owner-only
**Reset all reports** control. That clears generated reports and restores the
single default MKBHD foldable-phone report, matching the fresh local and hosted
snapshot state.

**Endpoints used:** `POST /api/creator-onboarding/run` (batch), with a
per-channel import-job fallback, and `POST /api/reports/reset-starter`.

---

### `CreatorsPage.tsx`

**What it is:** the list at `/creators`. Shows every creator in the
system with their video count, topic count, last upload date. Uses
`<VirtualizedList>` so it stays fast even with many creators.

**Endpoints used:** `GET /api/creators`.

---

### `CreatorOverviewPage.tsx`

**What it is:** the detail page at `/creators/:creatorId`. The **most
data-rich page in the app**. Shows: creator metadata, total content,
top topics, the **stance timeline** chart (a line per topic, showing
stance drift over time), a list of recent videos, a list of generated
reports.

**Endpoints used:** `GET /api/creators/:id`, `GET /api/creators/:id/overview`,
`GET /api/creators/:id/topics`, `GET /api/creators/:id/timeline`.

---

### `TopicAnalysisPage.tsx` (lazy-loaded)

**What it is:** the page at `/creators/:creatorId/topics/:topicId`. Drills
into one topic for one creator: stance breakdown chart, per-video stance
timeline, all evidence quotes for that topic. **Lazy-loaded** (its code
is only fetched when a user actually opens this page, not bundled with
the rest of the app upfront) because it imports `Charts.tsx`, which
transitively imports Recharts (~105KB gzipped — "transitively" just
means "indirectly, through a chain"; the file imports something that
imports something that pulls in Recharts). Pages that never visit a
chart-heavy page never download Recharts.

**Endpoints used:** `GET /api/topics/:id/analysis/:creatorId`.

---

### `VideosPage.tsx`

**What it is:** the list at `/videos`. Big page (378 lines) because it
has filters (by creator, by status, by date), pagination, AND
virtualization for large result sets. The most polished list page.

**Endpoints used:** `GET /api/videos`.

---

### `VideoDetailPage.tsx`

**What it is:** the detail page at `/videos/:videoId`. Shows the video's
metadata, the per-topic stance summary, and the raw transcript with
chunk boundaries highlighted. The transcript is rendered chunk-by-chunk
so users can see which chunks contributed to which evidence.

**Endpoints used:** `GET /api/videos/:id`, `GET /api/videos/:id/transcript`,
`GET /api/videos/:id/topics`.

---

### `TopicsPage.tsx`

**What it is:** the topic catalog at `/topics` (reached from the
dashboard's "Topics" stat card). Lists every detected topic with its
coverage counts (videos discussing it + classified mentions), a text
filter, and a sort dropdown (alphabetical / by videos / by mentions /
by recency, each direction). Each card links into the videos index
pre-filtered to that topic (`/videostopicId=…`).

**Endpoints used:** `GET /api/topics`.

---

### `EvidencePage.tsx`

**What it is:** the list at `/evidence`. A searchable, filterable feed
of every (chunk, topic) analysis result in the system. Filters: by
creator, by topic, by stance label, by confidence range. Virtualized.

**Endpoints used:** `GET /api/evidence`.

---

### `EvidenceDetailPage.tsx`

**What it is:** the detail page at `/evidence/:analysisId`. Shows one
specific evidence card with its full context: the chunk text, the
LLM's rationale, the claim summary, the surrounding chunks, links
back to the video and creator.

**Endpoints used:** `GET /api/evidence/:id`.

---

### `ReportsPage.tsx`

**What it is:** the list at `/reports`. Shows generated reports
(creator-level and topic-level) with creator / topic / type filters, a
sort dropdown (newest / oldest / title A–Z / Z–A), and pagination
(12 per page). Each card has a checkbox + delete "×"; a toolbar adds
select-all, delete-selected, and a confirmed delete-all. Report
*generation* now lives on the Creator/Topic analysis pages, not here.

**Endpoints used:** `GET /api/reports`, `GET /api/creators`,
`GET /api/topics`, `POST /api/reports/bulk-delete`.

---

### `ReportDetailPage.tsx`

**What it is:** the page at `/reports/:reportId`. Renders one report as
a full document from its `report.evidence` body JSON: title, summary,
the sections as headed **bullet lists**, a sources/citations list
(deep-linking each cited video / topic), and the caveats panel.
Read-only; no editing.

**Endpoints used:** `GET /api/reports/:id`.

---

### `ComparePage.tsx` (lazy-loaded)

**What it is:** the page at `/compare`. Side-by-side creator
comparison: pick 2-4 creators, see their stance/coverage on a shared
set of topics. Heavy on charts (lazy-loaded for the same reason as
`TopicAnalysisPage`).

**Endpoints used:** `GET /api/creators/compareids=...`.

---

### `NotFoundPage.tsx`

**What it is:** the 404 page. (404 is the standard web code for "the
thing you asked for doesn't exist.") Matches any URL that didn't match
another route (`<Route path="*" />` — the `*` is a catch-all
wildcard). Just renders a "Page not found" message + a link back to
the dashboard. 25 lines.

**Why it exists:** without it, an unknown URL would render an empty
`<AppLayout>` with no main content — confusing UX. The catch-all
ensures every URL produces *something*.

---

## How a page typically reads

```tsx
export function CreatorOverviewPage() {
  const { creatorId } = useParams<{ creatorId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["creator-overview", creatorId],
    queryFn: () => api.get<CreatorOverview>(`/creators/${creatorId}/overview`),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  if (!data) return <EmptyState message={t.creators.notFound} />;
  return (
    <div className="space-y-6">
      <h1>{data.name}</h1>
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={t.creators.totalVideos} value={data.totalVideos} />
        {/* ... */}
      </div>
      <StanceTimelineChart data={data.timeline} />
      {/* ... */}
    </div>
  );
}
```

Every page follows roughly this shape: extract params, fetch, branch
on loading/error/empty, render. Pages are intentionally **not deep** —
the complexity lives in services on the backend and components in
`components/`.

---

## "Where do I look when X happens"

| You want to fix...             | Open...                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Specific URL is broken         | The matching `pages/X.tsx` file                                                   |
| Want to add a new URL          | Add `<Route>` in `App.tsx` + new `pages/X.tsx`                                    |
| Page loads slowly              | Check if it should be `React.lazy()`'d in `App.tsx` (especially chart-heavy ones) |
| All pages broken               | More likely `App.tsx`, `main.tsx`, or a provider (theme/toast/queryClient)        |
| Page fetches wrong endpoint    | Search the page file for `api.get(` or `api.post(` — the path is right there      |
| Filter/pagination doesn't work | Most pages use `useSearchParams()` to keep filter state in the URL; check that    |
