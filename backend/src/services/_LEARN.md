# \_LEARN.md - `backend/src/services/`

> The chefs. Seventeen files of business logic (fifteen `*.service.ts`
> plus the `topicTaxonomy.ts` data module and the `dashboardInsight.ts`
> selector). Each one does one thing and does it well.

---

## The story of this folder

In the kitchen analogy, **services** are the actual chefs. Each chef
specializes:

- **The transcript chef** breaks long transcripts into bite-sized
  chunks
- **The topic chef** reads a transcript and lists the topics inside
- **The stance chef** judges (gently!) what position the speaker
  takes on each topic
- **The summary chef** rolls up per-chunk classifications into per-
  video and per-creator-per-topic summaries
- **The chart chef** turns rows in the database into the data shapes
  charts can render
- **The comparison chef** computes side-by-side stats for multiple
  creators
- **The YouTube-import chef** brings in new transcripts from outside
- **The report chef** writes the long-form analyses
- **The featured-report chef** restores the clean one-report state
- **The evidence chef** fetches and contextualizes individual evidence
  rows
- **The embedding chef** turns chunks into vectors for owner/offline
  maintenance workflows
- **The timeline chef** turns chronological summaries into trend
  conclusions

Services don't know about HTTP. They take typed arguments, return
typed results, throw typed errors. **Controllers wrap them; jobs use
them; tests call them directly.** This separation is the single
biggest reason the backend has 100% line coverage on the business
logic - testing services means testing the actual brain, with no HTTP
machinery in the way.

---

## File-by-file

### `chunking.service.ts`

**What it does:** takes a raw transcript (potentially 30,000 words)
and splits it into **chunks** of ~150-300 tokens each, with small
overlaps. Each chunk gets a `chunkIndex`, optional `startSeconds` /
`endSeconds` (if the transcript carries timestamps), and a deduplicated
text body.

**Why it exists:** LLMs and embedding models have **context limits**
(8K tokens, 128K tokens, etc.). You can't paste a 90-minute transcript
into a single prompt and expect a usable analysis. Chunking is the
foundational transform that makes everything else possible - every
LLM call later operates on one chunk, not a whole video.

**Used by:** `services/transcript.service.ts` (when a transcript is
saved), `controllers/transcripts.controller.ts` (manual paste +
rechunk endpoints), `jobs/importChannel.job.ts` (per-imported-video).

---

### `transcript.service.ts`

**What it does:** small helpers around `Transcript` rows - `countWords`
counts words in a transcript text. Other transcript work
(persisting, chunking, deleting) is done inline in the controllers
since it's a simple CRUD pattern.

**Why it exists:** at one point this file had more functions; over
time most got inlined into the controllers or moved into `chunking.
service.ts`. What's left is the smallest helpers that don't justify
a dedicated controller method.

**Used by:** transcript controllers and import jobs (rarely).

---

### `topicDetection.service.ts`

**What it does:** two exports. `detectTopicsForTranscript(text)` calls
the LLM via `ai/llmClient.ts` with the `topicDetection` prompt,
validates with the schema, returns a typed list of detected topics.
`upsertTopicsBySlug(detected)` takes that list and creates-or-updates
the corresponding `Topic` rows in the DB (using the slug as the
unique key).

**Why it exists:** the analysis pipeline starts by figuring out
*what topics to classify against*. The taxonomy isn't fixed - every
new video can introduce new topics. The LLM does the detection; this
service handles the resulting taxonomy management.

**Used by:** `jobs/analyzeVideo.job.ts` (step 2 of the pipeline:
detect topics for this video's transcript).

---

### `topicRelevance.service.ts`

**What it does:** `scoreChunkRelevanceForTopic({ topic, chunkText })`
(and the boolean wrapper `isChunkRelevantForTopic`) - the **relevance
gate** that decides whether a chunk is actually ON a topic before it is
classified. Resolves a backend from `TOPIC_RELEVANCE_PROVIDER`
(`heuristic` default, or `custom_ml`) and respects
`TOPIC_ASSIGNMENT_PROVIDER`: the `curated_reranker` / `final_policy`
tiers pick topics themselves and short-circuit to relevant; otherwise
the keyword heuristic runs, and `custom_ml` can call the ML classifier
(falling back to the heuristic, marked `fallback`, on any failure).

**Why it exists:** keeps off-topic / name-drop chunks out of stance
tallies so a passing mention can't sway a creator's apparent stance -
the gate side of the `MIN_EVIDENCE_RELEVANCE` story.

**Used by:** the analysis pipeline (`jobs/analyzeVideo.job.ts` /
`stanceAnalysis` flow) when deciding which (chunk, topic) pairs to score.

---

### `stanceAnalysis.service.ts`

**What it does:** `classifyChunkForTopic({ chunkText, topicName })`

- the **central classification function**. Picks the provider based on
  `STANCE_ANALYSIS_PROVIDER` env var:

- `llm` -> real LLM (OpenAI/Anthropic)
- `custom_ml` -> call `ai/mlClassifierClient.ts` (the
  thoughttracker-ml FastAPI service)
- `hybrid` -> ML for the label, LLM for the rationale + evidence quote

Returns a typed `{ stanceLabel, confidenceScore, ... }` object that
goes directly into `ChunkTopicAnalysis` rows.

**Why it exists:** the provider switch is the **most valuable
abstraction** in the AI layer. Lets you compare LLM vs custom-ML vs
hybrid empirically. The hybrid path is recommended in production: the
fine-tuned model is more reliable for the *label*, and the LLM is
better at extracting evidence and writing rationale.

**Used by:** `jobs/analyzeVideo.job.ts` (step 3: per-chunk
classification). The most-called service in the entire pipeline.

---

### `videoSummary.service.ts`

**What it does:** `summarizeVideoForTopic({ topicName, videoTitle,
chunkAnalyses })` - takes all per-chunk classifications for one
(video, topic) and asks the LLM (via `ai/llmClient.ts` with the
`videoTopicSummary` prompt) to produce a roll-up: `dominantStance`,
`mentionCount`, `summary`, `notableEvidence`. Returns the validated
result.

**Why it exists:** the UI doesn't show 50 chunk classifications per
video; it shows one **per-(video, topic) summary**. This is the
function that produces those summaries.

**Used by:** `jobs/analyzeVideo.job.ts` (step 4 of the pipeline).

---

### `timeline.service.ts`

**What it does:** `buildTimelineEvidence(summaries)` - sorts video
summaries by published date and shapes them into the evidence-array
format the creator-timeline prompt expects.

**Why it exists:** thin shaping layer between the DB rows and the LLM
prompt. Keeping this in a service keeps the prompt-call logic clean.

**Used by:** `services/creatorComparison.service.ts:getCreatorComparison`
(when building the timeline portion of the comparison view).

---

### `evidence.service.ts`

**What it does:** two functions. `listEvidence(filters)` is the paginated
listing for the Evidence Explorer page. `getEvidenceDetail(id)` fetches
one ChunkTopicAnalysis row, plus the previous + next chunks in the
transcript (for context), plus related evidence on the same topic.

**Why it exists:** the Evidence Explorer is the **"show me the
receipts"** page - every classification can be drilled into to see the
full chunk in transcript context. This service builds that drill-down
view.

**Used by:** `controllers/evidence.controller.ts`.

---

### `chartData.service.ts`

**What it does:** three exports. `getStanceOverTime({ creatorId, topicId })`
returns time-bucketed stance data. `getTopicFrequency({ creatorId })`
returns month-by-month topic mention counts. Each function aggregates
DB rows into the JSON shape the corresponding chart component expects.

**Why it exists:** the chart components in the frontend
(`StanceOverTimeChart`, `TopicFrequencyChart`) want pre-shaped data
arrays. Doing aggregation in the controller would be too low-level;
doing it in the component would require shipping too much raw data.
Services are the right home for it.

**Used by:** `controllers/charts.controller.ts`.

---

### `creatorComparison.service.ts`

**What it does:** `getCreatorComparison(creatorIds)` - the heavyweight.
Takes 2-5 creator IDs/slugs, returns:

- per-creator stat blocks (video count, transcript count, topic
  count, evidence count)
- shared topics (topics >=2 of the compared creators cover) with
  per-creator dominant stance
- overlay timeline (month-by-month average stance score per creator)

**Why it exists:** the **Compare Creators** page is one of the
flagship features. This is the function that powers it.

**Performance notes:** this is where the polish-round perf work shows
up most. Originally had O(N^2) `.find()` calls inside `.map()`; rewritten
with **indexed Maps** (`Map<creatorId, ...>`) built once before the
loop. ADR-0005 has the details.

**Used by:** `controllers/creators.controller.ts:compareCreators`.

---

### `embedding.service.ts`

**What it does:** two exports. `pgvectorAvailable()` checks whether
Postgres has the vector extension installed (memoized after first
call - in plain terms, the chef checks the pantry once and remembers
the answer instead of walking back every time). `generateEmbeddingsForChunks(chunkIds)`
and `generateEmbeddingsForCreator(creatorId)` batch-embed transcript
chunks and persist the vectors (turn each chunk into a list of numbers
that represents its meaning, then save those number-lists to the
database).

**Why it exists:** owner/offline analysis workflows may need persisted
vectors. This service is what fills the `Embedding` table.

**The upsert pattern:** writes use `prisma.embedding.upsert` (upsert =
"update if it exists, insert if it doesn't" - one safe atomic step)
instead of `findUnique -> create`. This closes a check-then-create race

- think of two chefs both checking the shelf, both seeing it empty,
  and both trying to add the same jar at once. The old way crashed
  concurrent embedding jobs with `P2002` unique-constraint errors (the
  database's "no duplicates allowed" rule). ADR-0004 explains.

**The native-write + fallback:** there are two storage columns. The
writer first creates the row with `vectorJson` populated, so the chunk keeps
a portable vector representation even if the native write fails. When pgvector is available, it
then writes the same vector into the native `vector(768)` column via raw
SQL and clears `vectorJson` to SQL `NULL` so the vector is not stored
twice. When pgvector is absent - OR the native write throws despite the
extension being present - the JSON value remains as the portable fallback.
(768 is fixed to match `EMBEDDING_DIM` / the local `ml` provider; see
schema.prisma.)

**Test-only export:** `__resetPgvectorCacheForTests` lets unit tests
reset the memoized "is pgvector available" result. Production code
never calls this.

**Used by:** `jobs/generateEmbeddings.job.ts` and
`controllers/embeddings.controller.ts`.

---

### `youtubeImport.service.ts`

**What it does:** `getYoutubeProvider()` currently fails closed for runtime
YouTube imports. The production-quality transcript refresh is owner-operated
from the sibling `thoughttracker-ml` scripts, then restored through the real
data snapshot / bulk-import path.

**Why it exists:** it keeps the HTTP import endpoint explicit: this backend
does not create unverified creator records or generated transcripts. If the
owner wants new videos, they run the refresh pipeline and commit the resulting
real transcript snapshot.

**Used by:** `jobs/importChannel.job.ts` (the import pipeline).

---

### `reportGeneration.service.ts`

**What it does:** two main exports. `generateCreatorReport(args)` writes
the creator-wide report (`creator-report-v3` - a finding-led SYNTHESIS
with 3-6 thematic sections, NOT one-section-per-topic). `generateTopicReport
(args)` writes the focused per-(creator, topic) report (`topic-report-v5`

- a quote-grounded, trend-aware digest). Both take **pre-gathered**
  structured args (not ids), call the LLM via `ai/llmClient.ts`, validate
  against `ai/schemas/report.schema.ts`, and fall back to a safe stub if
  validation fails.

**Why it exists:** the **Reports** page is a flagship deliverable - long-
form analyses you can read like a journalist's article. These are the
functions that write them.

**The pipeline per report** (the gather + persist steps live in
`jobs/generateReport.job.ts`, not here):

1. The **job** gathers the relevant DB rows (timelines, per-video
   summaries, per-topic stance distribution; for a topic report it also
   pulls candidate evidence quotes and runs `utils/reportText.ts` to
   clean + stratify them so the report leads with the dominant stance yet
   still surfaces dissent).
2. The **service** builds the LLM prompt from that structured input.
3. Calls the LLM (via `ai/llmClient.ts`).
4. Validates with `ai/schemas/report.schema.ts` (-> stub on failure).
5. The **job** persists a `Report` row (`evidence` = `{ sections,
evidence }`).

**Used by:** `jobs/generateReport.job.ts` (which is what the controller
enqueues - see `controllers/reports.controller.ts`).

---

### `starterReport.service.ts`

**What it does:** `resetReportsToStarter()` deletes every generated `Report`
row, then recreates exactly one deterministic topic report: Marques Brownlee on
foldable smartphone reviews. `buildStarterReport()` shapes that report from
real timeline rows, per-video summaries, and transcript evidence already in the
database.

**Why it exists:** the public hosted app is shared by multiple interviewers,
and local installs should open in the same clean state. This service gives the
owner one reset action that returns both experiences to a useful default without
calling OpenAI, Ollama, or the ML service.

**Used by:** `controllers/reports.controller.ts:resetReportsToStarterController`
and the PIN-gated Add Creators admin panel.

---

### `dashboardInsight.ts`

**What it does:** pure selection/mapping helpers for the dashboard's hero
"featured insight". `selectFeaturedTimeline(candidates)` scores analyzed
`CreatorTopicTimeline` rows (sharpest, best-supported stance shift,
requiring `MIN_VIDEOS_FOR_FEATURE` videos) and picks the fallback hero;
`toFeaturedInsight(timeline, report)` maps the selected pair to the
payload, preferring a backing topic report title/summary/id when present.

**Why it exists:** the dashboard controller now prefers the latest topic
report when it maps to analyzed data, which keeps a fresh/reset public snapshot
from opening on an empty report surface. These helpers keep the fallback hero
honest when no report-backed topic is available.

**Used by:** `controllers/dashboard.controller.ts:getDashboard`.

---

### `topicTaxonomy.ts`

**What it does:** the controlled topic vocabulary -
`CONTROLLED_TOPIC_TAXONOMY` (slug/name/domain/aliases per topic),
`DEFAULT_TOPIC_TAXONOMY` (just the display names handed to the
topic-detection prompt), and `topicKeywords(slug, name)` (distinctive
lowercased keywords, minus stopwords, used to score whether an evidence
quote is on-topic).

**Why it exists:** a single source of truth for the curated taxonomy and
its aliases/keywords, so detection, relevance scoring, and report-quote
ranking all agree on what a topic "is".

**Used by:** `services/topicDetection.service.ts` (candidate vocab),
`jobs/generateReport.job.ts` (quote relevance via `topicKeywords`).

---

### `creatorOnboardingPipeline.service.ts`

**What it does:** `startCreatorOnboardingPipeline(req)` - spawns the
**detached** local `add_creator_pipeline.mjs` script (from the sibling
`thoughttracker-ml` repo) that discovers + ingests new creators, and
returns run handles (`processId`, `statusPath`, `logDir`) immediately.
Resolves the script path, Node binary, and the API base the child calls
back into, all overridable by env.

**Why it exists:** the owner-only "add creators" flow is a long offline
job; this runs it out-of-process so the request returns 202 right away.
Surfaces `UpstreamUnavailableError` when the pipeline isn't present on
the host (e.g. a cloud deploy without the ML repo).

**Used by:** `controllers/creatorOnboarding.controller.ts:startCreatorOnboardingRun`.

---

## How services connect to everything else

```
 controllers/ + jobs/
 | |
 v v
 +-------------------------+
 | services/ |
 +----------+--------------+
 |
 +--------+--------+
 v v
 ai/ config/prisma
 (LLM/ML/embed) (database)
```

Services are the **only** layer that talks to both the AI clients and
the database. Controllers don't. Jobs don't (well, jobs use services
to do anything substantive). This means: if you want to change how
something is computed, you change it here. If you want to change how
something is exposed over HTTP, you change a controller. The
separation is what makes the system testable.

---

## "Where do I look when X happens"

| You want to fix...                    | Open...                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Wrong stance label on a chunk         | `stanceAnalysis.service.ts`                                                                 |
| Wrong topic detection                 | `topicDetection.service.ts`                                                                 |
| Chart shows wrong shape               | `chartData.service.ts`                                                                      |
| Compare page wrong numbers            | `creatorComparison.service.ts`                                                              |
| Chunks too big / too small            | `chunking.service.ts`                                                                       |
| Report content wrong                  | `reportGeneration.service.ts` + corresponding prompt in `ai/prompts/`                       |
| Report quotes look broken / one-sided | `utils/reportText.ts` (clean + stratified selection), wired in `jobs/generateReport.job.ts` |
| Off-topic chunks polluting stance     | `topicRelevance.service.ts` (relevance gate) + `MIN_EVIDENCE_RELEVANCE`                     |
| Dashboard hero wrong / empty          | `dashboardInsight.ts` (selection + report deep-link)                                        |
| Imports not getting videos            | Run the owner transcript refresh pipeline, then restore/import the real snapshot            |
| Evidence detail page missing data     | `evidence.service.ts`                                                                       |
| Need a new analysis step              | New service file here + wire into `jobs/analyzeVideo.job.ts`                                |
