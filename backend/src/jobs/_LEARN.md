# \_LEARN.md - `backend/src/jobs/`

> The prep team in the back room. Eight files. Seven of them are
> long-running operations that don't fit in a single HTTP request;
> one is the queue manager that runs them.

---

## The story of this folder

Imagine the restaurant kitchen again. The window cooks (controllers)
handle "make me a sandwich" orders in a minute. But some operations
take much longer - slow-roasting a brisket, kneading a sourdough,
brewing kombucha. These can't happen at the window; they happen in
the **back room** while customers' sandwiches are being made out
front.

That's what `jobs/` is. When a customer says "analyze this whole
90-minute video for stance across every topic," the controller
doesn't wait for it. It writes a small ticket ("analyze_video for
video123"), drops the ticket into a tray, and returns `202 Accepted`
instantly. A separate worker in the back room picks up tickets from
the tray and works through them serially.

The **tray** is `jobRunner.ts`. The **work** is the seven other files,
each one a single function that takes a job ID + payload and does
the long-running work.

---

## File-by-file

### `jobRunner.ts`

**What it is:** a tiny in-process job queue (in plain terms: a to-do
tray that lives inside the same app - no separate background server)
with two public methods: `enqueue(name, fn)` and `drain()` (test-only).
The runner extends Node's `EventEmitter` (a built-in tool for "shout
when something happens, and other parts can listen") and emits
`"empty"` whenever the queue clears, so `drain()` can wait for the tray
to be empty without constantly peeking at it.

**Why it exists:** background work is async. Without a queue, a
controller would have to either (a) block on the work (terrible UX,
HTTP times out) or (b) spawn a Promise and forget it (no error
handling, no cancellation, no observability). The queue gives us
serial execution, swallow-and-log error handling, and per-job
log lines.

**Why "in-process" and not Redis/BullMQ:** for a portfolio demo, an
in-memory queue is fine - it's simpler, has zero external deps, and
makes the project boot in seconds. The trade-off (queue lost on
process restart - in plain terms, if the back room closes for the
night, any tickets still in the tray are gone) is documented in
ADR-0001 and on the README roadmap as "BullMQ migration" (BullMQ is a
real grown-up job queue that uses Redis to remember tickets across
restarts) for production.

**`drain()` is test-only:** added during the flaky-test investigation.
When test A enqueues a job and test B asserts on DB state that the
job is in the middle of mutating, race conditions follow (think of it
as: the building inspector is checking the freezer while a prep cook
is still rearranging it - they get different readings depending on the
exact moment they look). `drain()` in test B's `beforeEach` makes the
queue quiescent - wait until the tray is fully empty - before
assertions. ADR-0010 has the full story.

**Used by:** every job-enqueueing controller, every job file in
this folder, the test suite's `jobs.test.ts`.

---

### `analyzeVideo.job.ts`

**What it is:** the **central pipeline**. `analyzeVideoJob(videoId)`
runs the full per-video analysis end-to-end:

1. **Generate embeddings** for any chunks that don't have one
   (uses `embedding.service.ts`, **upsert** pattern - see ADR-0004)
2. **Detect topics** in the video's transcript
   (calls `topicDetection.service.ts`)
3. **Stance classification** per (chunk, topic) pair
   (calls `stanceAnalysis.service.ts`)
4. **Per-topic video summaries** roll up the chunk classifications
   (calls `videoSummary.service.ts`)
5. **Mark the video** as `analysisStatus="completed"` in the DB

Each step creates an `AnalysisRun` row tracking what was attempted,
which provider, what prompt version, and timing. If any step throws,
the catch-all marks the video as `"failed"` and records the error
message.

**Why it exists:** this is **the** function that turns a transcript into
analyzed data. Everything else (charts, reports, comparison views)
reads from the rows this job writes.

**The job-level catch is intentionally swallowed:** any error becomes
`analysisStatus="failed"` with a message - it never re-throws, because
re-throwing in the job runner aborts the whole queue and silently halts
all subsequent enqueues. We want **one** bad video to fail, not the
whole system (one burnt brisket shouldn't shut down the back room).
The catch path is `c8 ignore`'d (a comment that tells the coverage
checker "skip counting this line" - c8 is the coverage tool) because
forcing the pipeline to throw transiently - that is, to fail
unpredictably for a moment and then recover - requires integration
tests, not unit tests.

**Used by:** `controllers/analysis.controller.ts:runVideoAnalysis`
(when a user manually triggers re-analysis); `jobs/importChannel.job.
ts` (when a freshly imported video is analyzed automatically);
`jobs/bulkImport.job.ts` (the bulk-import variant of the same trigger).

---

### `analyzeCreator.job.ts`

**What it is:** `analyzeCreatorJob(creatorId)` - the creator-wide
roll-up. After per-video analysis, this job iterates every topic the
creator covers, calls `analyzeCreator(...)` logic to build a
`CreatorTopicTimeline` (with trend label) per (creator, topic).

**Why it exists:** the per-creator chart on the Creator Overview page,
the per-(creator, topic) timeline on the Topic Analysis page, the
overlay timeline on the Compare page - all of them read from
`CreatorTopicTimeline` rows. This job is what writes them.

**Pipeline:**

1. Find every (creator, topic) pair the creator has summaries for
2. For each pair, gather chronologically-ordered video summaries
3. Call the creator-timeline LLM prompt
4. Validate via `ai/schemas/creatorTimeline.schema.ts`
5. Upsert a `CreatorTopicTimeline` row with `trendLabel`, `summary`,
   `evidence`

**Used by:** `controllers/analysis.controller.ts:runCreatorAnalysis`
(manual re-trigger), `jobs/importChannel.job.ts` (after all videos for
the channel are analyzed).

---

### `importChannel.job.ts`

**What it is:** the **bulk channel import**. `importChannelJob(jobId)`
takes an `ImportJob` ID, looks up the channel URL, calls the YouTube
provider, fetches metadata for the most recent N videos, fetches each
transcript, chunks them, persists everything, and chains into per-video
`analyzeVideoJob` for each imported video and a final
`analyzeCreatorJob` after all videos finish.

**Why it exists:** "import this YouTube channel" is the **most-used
entry point** for new data. Without this job, every video has to be
added manually.

**Idempotency considerations:** (idempotency = "running it twice gives
the same result as running it once" - think of it as a prep cook who
checks if the prep is already done before redoing it) at multiple
steps the job upserts-or-skips - `prisma.transcriptChunk.deleteMany`
followed by recreation if the transcript changed; `prisma.video.upsert`
respecting `(sourceVideoId)`. This lets a re-run on the same channel
pick up new videos without duplicating old ones.

**Per-item status tracking:** the `ImportJob` has many `ImportJobItem`
rows, one per video. The job updates each item's status as it
progresses (`metadata_imported`, `transcript_imported`,
`analysis_completed`, or `failed`). The UI shows progress by polling
the items list.

**Used by:** `controllers/importJobs.controller.ts:createImportJob`
(the `POST /api/import-jobs/youtube-channel` endpoint).

---

### `bulkImport.job.ts`

**What it is:** `bulkImportJob(jobId, captured)` - the second bulk
import path, for when you have **already-fetched** transcripts on
disk (or inline in the request). Reads a `_manifest.json` and per-video
transcript files from a folder, creates the corresponding DB rows, and
chains into `analyzeVideoJob` per video.

**Why it exists:** the `importChannel.job.ts` flow assumes a working
YouTube provider. For real transcript folders already fetched and stored
with the project, or for owner workflows where transcripts were fetched
offline (`PERSONAL_MACHINE_SETUP.md` covers this), this is the entry point.

**Two payload shapes accepted:** `{ folderPath: "..." }` for a
real path on disk, or `{ inline: { manifest, transcripts } }` for
test scenarios where everything is passed in-memory. The latter is
materialized to a tmpdir before processing.

**Used by:** `controllers/importJobs.controller.ts:createBulkImportJob`
(the `POST /api/import-jobs/bulk-import` endpoint).

---

### `chunkTranscript.job.ts`

**What it is:** `chunkTranscriptJob(videoId)` - background re-chunking of
one video's transcript. Loads the video + transcript, deletes the old
chunk rows, rebuilds chunks from the cleaned text (honoring timestamped
segments when present), marks the video `analysisStatus = "pending"`, and
enqueues `analyzeVideoJob` so stance/topic/summary work follows the new
chunks.

**Why it exists:** the manual-transcript-paste and re-chunk endpoints used
to run the chunking loop INLINE - dozens of serial `create`s holding the
HTTP socket open. Moving it to a job lets the controller return `202` + a
poll handle immediately. Idempotent (delete-then-recreate); on a mid-write
error it flips the video to `failed` so the UI doesn't spin on "pending".

**Used by:** `controllers/transcripts.controller.ts` (the paste-transcript

- rechunk endpoints).

---

### `generateReport.job.ts`

**What it is:** four exports. The async entry points
`enqueueCreatorReportJob(creatorId)` / `enqueueTopicReportJob(creatorId,
topicId)` pre-create a `processing` `AnalysisRun` (so the controller has a
pollable id), enqueue the heavy work, and return that id. The workers
`generateCreatorReportJob` / `generateTopicReportJob` do the generation:
gather DB rows, call the matching `services/reportGeneration.service.ts`
function, persist a `Report`, and flip the run to completed/failed (a
passed-in `existingRunId` is reused so the async path never creates a
second run).

**The topic-report quote pipeline:** before calling the service, the topic
worker over-fetches candidate evidence quotes, then cleans + selects a
balanced, on-topic set via `utils/reportText.ts` (using `topicKeywords`
from `topicTaxonomy`), so even a low-movement topic reads as a grounded
"here's what they actually said" digest. Both workers persist the report
body as `evidence: { sections, evidence }`.

**Why it exists:** report generation is LLM-heavy and can take 10+
seconds. Running it async means the controller responds immediately with
`202 { analysisRunId }` and the user polls the AnalysisRun, instead of
holding the socket open and blocking the serial queue.

**Used by:** `controllers/reports.controller.ts:generateCreatorReportController`
and `generateCreatorTopicReportController`.

---

### `generateEmbeddings.job.ts`

**What it is:** `generateEmbeddingsForCreatorJob(creatorId)` - a thin
delegate to `embedding.service.ts` that batch-embeds every chunk the
creator has across all their videos (768-d for the local `ml` provider,
1536-d for `openai`).

**Why it exists:** embeddings can be added retroactively. If you change
the `EMBEDDING_PROVIDER` env var (for example `ml` local DistilBERT or
openai), you'd want to re-embed existing chunks against the new model.
This job is the convenient single-shot for "embed everything I haven't
yet" - idempotent, so already-embedded chunks are skipped.

**Used by:** `controllers/embeddings.controller.ts:regenerateCreatorEmbeddings`.

---

## How jobs/ connects to everything else

```
controllers/ (HTTP handlers)
 |
 | jobRunner.enqueue("analyze_video", fn)
 v
jobRunner.ts (in-process FIFO queue)
 |
 | serially processes the queue
 v
analyzeVideo.job.ts analyzeCreator.job.ts importChannel.job.ts bulkImport.job.ts
chunkTranscript.job.ts generateReport.job.ts generateEmbeddings.job.ts
 |
 | call services for actual work
 v
services/ (the actual logic)
 |
 v
ai/ + config/prisma (LLM calls + DB writes)
```

Jobs are the **orchestration layer**. They don't implement business
logic themselves; they sequence calls to services. Services do the
work; jobs decide the order.

---

## The big idea: chained jobs

Some jobs **enqueue more jobs**. Reading `importChannel.job.ts` from
top to bottom:

1. Fetch channel metadata + recent videos via the YouTube provider
2. For each video: upsert metadata, fetch transcript, chunk, save
3. **Enqueue** `analyzeVideoJob(videoId)` for each imported video
4. After the loop: **enqueue** `analyzeCreatorJob(creator.id)` so the
   creator-wide timelines update once all the videos are analyzed

The chain is what makes a single "import this channel" click into a
full end-to-end analysis. The queue serializes everything, so the
chain executes in deterministic order.

---

## "Where do I look when X happens"

| You want to fix...                                         | Open...                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Video stuck on `analysisStatus: pending`                   | `analyzeVideo.job.ts` - likely an exception in steps 2-5                                             |
| Video stuck on `analysisStatus: failed`                    | Same file - read the `errorMessage` field on the `AnalysisRun` row                                   |
| Import not bringing new videos in                          | Run the owner transcript refresh pipeline, then restore/import the real snapshot                     |
| Report stuck on `pending`                                  | `generateReport.job.ts` -> service -> LLM call                                                       |
| Paste/re-chunk transcript stuck or slow                    | `chunkTranscript.job.ts` (then it enqueues `analyzeVideo.job.ts`)                                    |
| Need to add a new background task                          | New file in this folder + register in any controller that needs to enqueue it                        |
| Test asserts wrong DB state because a job is still running | Call `jobRunner.drain()` in your `beforeEach`                                                        |
| Job swallowing real bugs                                   | Check the catch block in the specific job file - they intentionally swallow to keep the runner alive |
