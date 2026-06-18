# \_LEARN.md — `backend/src/controllers/`

> Thirteen files. Each one handles HTTP requests for one resource type.
> Controllers are the **thin layer** between HTTP and business logic.

---

## The story of this folder

Imagine the restaurant has thirteen different counters at the front of
the kitchen, each handling one type of order:

- **Dashboard counter** — "give me an overview of everything"
- **Creators counter** — "list creators, get this one, compare these
  five"
- **Videos counter** — "list videos, get this video's transcript"
- **Transcripts counter** — "paste a transcript, re-chunk this one"
- **Topics counter** — "list topics, create one"
- **Evidence counter** — "browse evidence, drill into this one"
- **Reports counter** — "list reports, generate a new one"
- **Analysis counter** — "run analysis on this video / creator"
- **Charts counter** — "stance over time for this creator + topic"
- **Search counter** — "global search"
- **Embeddings counter** — "regenerate embeddings for owner/offline workflows"
- **Import Jobs counter** — "import a YouTube channel; show progress"
- **Creator Onboarding counter** — "kick off the owner-only local
  pipeline that discovers + adds new creators"

Each counter (controller file) takes orders (HTTP requests), validates
them, hands them off to the chef (service), and ships the result back.
**Controllers should be thin** — under 100 lines is the goal. If they
get fat, the logic that bloated them belongs in a service.

---

## The shape of every controller function

All thirteen files share the same shape. Every exported function is an
Express request handler:

```ts
export async function listCreators(req, res, next) {
 try {
 const { skip, take, page, pageSize } = parsePagination(req.query);
 const search = typeof req.query.search === "string"  req.query.search : undefined;
 // ... pull more typed params off req.query ...
 const creators = await someService(...);
 res.json({ items: creators, page, pageSize, total });
 } catch (err) {
 next(err); // ← passes to error-handler middleware
 }
}
```

Three things every controller function does:

1. **Parse + validate** params off `req.query`, `req.params`, `req.body`
2. **Call services** to do the actual work
3. **Shape and return** the JSON response

Everything else (logging, error formatting, rate limiting, idempotency
— "don't accidentally do the same thing twice if the customer
re-clicks") is handled by middleware (small helpers that sit on the
counter and run before or after the main work, like a runner checking
each ticket on the way in) before/after the controller runs.

---

## File-by-file

### `dashboard.controller.ts`

**What it does:** `getDashboard` returns aggregated stats + a
`featuredInsight` hero (latest generated topic report first, then the
highest-scoring analyzed fallback - see `services/dashboardInsight.ts`) +
recent activity for the dashboard landing page. `getSystemStatus` returns
LLM budget + cache snapshot + provider config for the `/api/system/status`
endpoint.

**Why it exists:** the dashboard page wants a single bundled response
(stats + recent items) so it can render with one fetch. This is the
shape-the-response endpoint.

**Used by:** `frontend/src/pages/DashboardPage.tsx`.

---

### `creators.controller.ts`

**What it does:** the **largest controller** by surface area:

- `listCreators` — paginated, with search
- `getCreator` — single creator by id-or-slug
- `getCreatorOverview` — full creator-overview-page payload (creator

* stats + topics + recent videos + latest report)

- `getCreatorTopics` — every topic this creator has touched
- `compareCreators` — the 2-5-creator side-by-side endpoint

**Why it exists:** creators are the central entity. The overview
endpoint bundles many sub-queries so the frontend doesn't fetch
five things separately.

**Perf note:** `listCreators` had an N+1 issue (in plain terms: instead
of one big trip to the pantry to grab everything, the counter was
making one extra trip per creator — fine with 5 creators, painful with
50); one `transcript.count` + one `videoTopicSummary.findMany` per
creator; rewritten with two aggregate queries + indexed `Map`s (one
combined trip plus an instant lookup table). ADR-0005 has the story.

**Used by:** `CreatorsPage`, `CreatorOverviewPage`, `ComparePage`.

---

### `videos.controller.ts`

**What it does:** `listVideos` (with filters: creatorId, topicId,
search, transcriptStatus, analysisStatus, stanceLabel, confidenceLabel,
date range), `getVideo` (single video with creator + transcript +
topic summaries).

**Why it exists:** videos are the unit at which most analysis happens.
The filters on `listVideos` mirror the Videos page's filter sidebar.

**Used by:** `VideosPage`, `VideoDetailPage`.

---

### `transcripts.controller.ts`

**What it does:** `getTranscript`, `pasteTranscript` (manual transcript
upload bypass for videos YouTube didn't have captions for),
`rechunkTranscript` (re-run the chunker without losing the transcript
text).

**Why it exists:** sometimes YouTube doesn't have a transcript, or the
auto-caption quality is bad. The paste-transcript endpoint lets a user
provide one manually. The rechunk endpoint lets you retry the chunker
without re-fetching.

**Used by:** `VideoDetailPage` (the paste-transcript form + rechunk
button).

---

### `topics.controller.ts`

**What it does:** `listTopics` (with optional creatorId filter to scope
to topics the creator has touched), `createTopic` (admin-style endpoint
to seed a new topic outside of LLM auto-detection).

**Why it exists:** the Topics dropdown on filter sidebars needs a flat
list of all topics. The createTopic endpoint is for seeding the
canonical taxonomy.

**Used by:** filter dropdowns across the frontend.

---

### `evidence.controller.ts`

**What it does:** `listEvidenceController` (paginated browsing of
ChunkTopicAnalysis rows with filters) and `getEvidenceDetailController`
(single row with prev/next chunks + related evidence).

**Why it exists:** the **Evidence Explorer** page is the "show me the
receipts" surface — every classification can be drilled into.

**Used by:** `EvidencePage`, `EvidenceDetailPage`.

---

### `reports.controller.ts`

**What it does:** `listReports` (paginated + sortable via a server-side
`sort` allowlist: date_desc default / date_asc / title_asc / title_desc),
`getReport` (resolves citations into deep-link ids), `bulkDeleteReports`
(admin-gated `POST /reports/bulk-delete` — `{ ids }` or `{ all: true }`,
returns `{ deleted }`), and the two **async** generate endpoints
`generateCreatorReportController` / `generateCreatorTopicReportController`
(enqueue a job and return `202 { status, analysisRunId }`).

**Why it exists:** reports are long-form analyses. Generation is async
(enqueue + poll the AnalysisRun) because a real-LLM run can take seconds;
the list is paginated/sortable so a large report set stays browsable; and
bulk-delete lets an admin clear single/multi-select or all reports.

**Used by:** `ReportsPage` (list, sort, bulk-delete), `ReportDetailPage`,
`CreatorOverviewPage` (the "Generate creator report" button).

---

### `analysis.controller.ts`

**What it does:** `runVideoAnalysis` (enqueue `analyzeVideoJob` for one
video), `runCreatorAnalysis` (enqueue `analyzeCreatorJob` for one
creator), `getAnalysisRun` (fetch an AnalysisRun row by id),
`getCreatorTopicTimeline` (read the CreatorTopicTimeline row),
`getCreatorTopicAnalysis` (the bundled "everything about this
creator-topic pair" endpoint).

**Why it exists:** **the trigger endpoints for re-analysis.** Lets
the user manually re-trigger analysis without re-importing.

**Used by:** the re-run buttons on the CreatorOverviewPage and
VideoDetailPage; the TopicAnalysisPage (consumes the timeline +
analysis bundle).

---

### `charts.controller.ts`

**What it does:** `stanceOverTime` and `topicFrequency` — each
returns the JSON data shape the corresponding chart component renders.

**Why it exists:** charts want pre-aggregated data, not raw rows.
These two endpoints do the aggregation server-side.

**Used by:** the `Charts.tsx` components on the TopicAnalysisPage and
CreatorOverviewPage.

---

### `search.controller.ts`

**What it does:** `searchAll` — a global search that hits creators,
topics, and videos in parallel and merges results.

**Why it exists:** the top-of-page search bar needs to find anything
("Huberman" → Creator; "AI" → Topic; "Sleep stages" → Video). One
endpoint, three concurrent queries.

**Used by:** the global search bar in `AppHeader` (extracted out of
`AppLayout` into its own header component).

---

### `embeddings.controller.ts`

**What it does:** `regenerateCreatorEmbeddings` (enqueue
`generateEmbeddingsForCreatorJob`).

**Why it exists:** embeddings are computed offline (via the job) for
owner-controlled analysis maintenance and future pipeline work.

**Used by:** owner/admin maintenance flows.

---

### `importJobs.controller.ts`

**What it does:** `createImportJob` (YouTube channel ingestion),
`listImportJobs`, `getImportJob`, `listImportJobItems` (per-video
progress within a job), `createBulkImportJob` (the inline / folder
import path).

**Why it exists:** importing is the **most-visible** background work
in the app. Users want to watch progress, see which videos failed and
why. These endpoints feed the Imports page UI.

**Used by:** `ImportsPage`, `ImportJobDetailPage`.

---

### `creatorOnboarding.controller.ts`

**What it does:** `startCreatorOnboardingRun` — validates an owner-only
request (1-10 channel URLs, `requestedLimit` ∈ {10,25,50,100}, each URL
passing `validateChannelUrl`) and launches the detached local onboarding
pipeline via `services/creatorOnboardingPipeline.service.ts`, responding
`202 Accepted` with the run handles to poll.

**Why it exists:** adding brand-new creators runs a long, local,
ML-assisted pipeline. It's PIN-gated (`requireCreatorOnboardingPin`) and
async-start, so it can't run on a keyless cloud deploy and never blocks
the request.

**Used by:** the owner-only "Add creators" admin flow.

---

## How controllers/ connects to everything else

```
 routes/
 │
 ▼ (maps URL → controller fn)
 controllers/
 │
 ▼
 services/ ←──── ai/ + config/prisma
 │
 ▼
 Result
 │
 ▼
 controllers/ (shapes the response)
 │
 ▼
 middleware/errorHandler (only if something threw)
 │
 ▼
 HTTP response
```

The arrow from `controllers/` only goes downstream — into `services/`,
which then go into `ai/` and `config/prisma`. Controllers never call
the DB or AI clients directly. They never call each other. They never
import jobs — they only `enqueue` them via the runner.

This discipline is what makes the system testable. Every controller can
be tested by sending an HTTP request via supertest (a testing tool that
pretends to be a customer placing an order at the counter, without
needing a real browser) and checking the response shape, without
needing to fake the entire chain of helpers downstream.

---

## "Where do I look when X happens"

| You want to fix...                   | Open...                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Wrong status code                    | The controller for that URL — check the `res.status(...).json(...)` chain            |
| Missing field in JSON response       | Same — the shape of `res.json({ ... })` is what the frontend sees                    |
| Wrong filter behavior on a list page | The controller — parse-params logic is here, query construction is here              |
| New endpoint needed                  | New function here + register in the matching `routes/*.routes.ts`                    |
| 404 on a known URL                   | The corresponding `routes/*.routes.ts` file — route probably not registered          |
| Long-running endpoint                | The controller probably enqueues a job; check the corresponding `jobs/*.job.ts` file |
