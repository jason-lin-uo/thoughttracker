# \_LEARN.md — `backend/src/ai/prompts/`

> Six LLM prompt templates (plus a shared `fencing.ts` helper). Each
> template is a recipe for asking an AI a specific kind of question.

---

## The story of this folder

When you write to an LLM (Large Language Model — in plain terms, the AI that reads and writes text, like GPT-4 or Claude), you're not running a function — you're
sending **text**. Specifically, two pieces of text per call: a
**system message** ("you are a careful neutral analyst, do X but never
Y" — think of it as the standing instructions tacked to the cook's wall) and a **user message** ("here's the chunk, here's the topic,
please respond in this JSON format" — the actual order ticket).

Each LLM task in this project needs its own recipe for those two
texts:

- How to phrase the role/persona in the system message
- How to interpolate the inputs into the user message
- What output JSON shape to demand

Rather than hardcode those long strings inside each service, they live
here as **template functions**. Each file exports `build*Prompt(input)`
and a `*_PROMPT_VERSION` string.

---

## Why the version strings matter

Picture this: you spend three days tweaking the topic-detection prompt
to be more accurate. You ship the new version. But the LLM cache still
has hits from yesterday's old prompt — meaning many requests will
return the old, less-accurate results.

The fix is the version string. When a prompt is updated, you bump its
`*_PROMPT_VERSION` (e.g., `"topic-detection-v1"` → `"topic-detection-v2"`).
That version is part of the cache key — in plain terms, the label on each saved leftover that says which recipe it came from — (see `ai/llmBudget.ts:buildCacheKey`),
so changing it **invalidates the relevant cache entries** (throws out only the leftovers made with the old recipe) without
clobbering unrelated ones.

It's also written to the `AnalysisRun.promptVersion` column in the
database, so reports can later be traced back to "which prompt version
produced these results."

---

## File-by-file

### `topicDetection.prompt.ts`

**What it asks the LLM:** "Read this transcript. List the topics
discussed, with confidence scores from 0 to 1, and a short rationale
per topic."

**Why it exists:** `analyzeVideo.job.ts` needs to know "what topics
does this video cover" before it can do per-topic stance analysis.
The classifier can't be applied blindly; it needs target topics.

**The prompt's design choices:**

- **Neutral framing**: the system message stresses "name what's
  discussed, don't editorialize"
- **JSON-only output**: the model is forbidden from adding prose;
  must return strict JSON matching `topicDetection.schema.ts`
- **Empty list is valid**: if no topics rise above the relevance
  floor, the model should return `[]` rather than guess

**Used by:** `services/topicDetection.service.ts`.

---

### `stanceClassification.prompt.ts`

**What it asks the LLM:** "Given this transcript chunk and this topic,
what stance is the speaker expressing toward the topic Return one of:
supportive, opposed, neutral, mixed, unclear, insufficient_evidence."

**Why it exists:** the central classification task of the whole
product. This prompt runs once per (chunk, topic) pair — potentially
hundreds of times per video.

**The prompt's design choices:**

- **Six labels** (one more than the ML model — in plain terms, the smaller, faster pre-trained classifier that runs locally — uses; the ML model omits
  `insufficient_evidence`, leaving that as a fallback when even the
  classifier can't decide)
- **Evidence quote required**: the model must extract an exact
  substring of the chunk (a word-for-word copy of part of the transcript, not a rephrasing) as the supporting quote, not paraphrase. This
  is what makes the product "evidence-first" instead of "trust the AI"
- **`claimSummary` + `rationale`**: two separate fields — the
  short claim about the speaker's position and the LLM's reasoning for
  the label. The frontend shows both
- **No private-belief inference**: explicit instruction never to claim
  to know what the speaker *really* thinks beyond what the text says

**Used by:** `services/stanceAnalysis.service.ts`.

---

### `videoTopicSummary.prompt.ts`

**What it asks the LLM:** "Given all per-chunk classifications for
this video on this topic, summarize the speaker's overall position."

**Why it exists:** a 90-minute video might have 50 chunks. Each chunk
got its own stance label. The roll-up — "across the whole video, what
was the overall position on Topic X" — is what shows up on the
Creator Overview page and the Topic Analysis page.

**The prompt's design choices:**

- **Input is structured**: the prompt receives a JSON array of chunk
  classifications, not raw transcripts. The summary is over the
  *labels*, not the text
- **Outputs `dominantStance` + `mentionCount` + `summary`**: the
  dominant stance is what the chart uses; the mention count is for
  "how prominent was this topic in the video"; the summary is
  human-readable prose
- **Notable evidence array**: top-2 or top-3 quotes from the per-chunk
  evidence that best represent the position

**Used by:** `services/videoSummary.service.ts`.

---

### `creatorTimeline.prompt.ts`

**What it asks the LLM:** "Given these per-video summaries on this
topic, ordered chronologically, what's the trend Did the speaker's
stance shift over time"

**Why it exists:** the **core differentiator** of the product is
detecting **shifts in stance over time**. This prompt is the brain
behind that detection. Returns a `trendLabel` (stable / gradual_shift
/ abrupt_shift / mixed / insufficient_data) plus an evidence array
and a summary.

**The prompt's design choices:**

- **Time-ordering matters**: input is sorted by publishedAt, oldest
  first; the prompt reminds the model "later items are more recent"
- **Trend labels mirror DB enum**: the schema only accepts the five
  values from the `TrendLabel` Prisma enum — in plain terms, a fixed list of allowed trend names baked into the database itself, like a multiple-choice question where only five answers are valid. No free-form trends
- **Evidence with dates**: each item in the evidence array carries
  the videoId and publishedAt so the UI can deep-link (jump straight to the exact video and moment)

**Used by:** the `analyze_creator` flow (in `services/creatorComparison.
service.ts` and `jobs/analyzeCreator.job.ts`).

---

### `creatorReport.prompt.ts` (version `creator-report-v3`)

**What it asks the LLM:** "Given trends/timelines across all of this
creator's topics, SYNTHESIZE an insight report — lead with the single
most significant finding, then thematic sections — not a topic recap."

**Why it exists:** the creator-report endpoint generates a single
long-form analysis covering the creator's full topic landscape. This
prompt orchestrates that.

**The prompt's design choices:**

- **Thematic synthesis, not per-topic blocks**: the output is a
  finding-led title + 3-6 sections drawn from a fixed menu (Most
  Outspoken On, Biggest Shift, Where They Stay Neutral, Tensions &
  Contradictions, Limitations). It explicitly must NOT enumerate topics
  or counts — those already show on the dashboard.
- **Uses `dominantStance` + `opinionatedShare`**: each topic carries a
  modal stance and the supportive/opposed share, so the report can call
  out where the creator is most opinionated vs. where they stay neutral.
- **Bounded + fenced input**: the topic array is capped
  (`CREATOR_REPORT_MAX_TOPICS = 80`) and each free-text summary is fenced
  (`fencing.ts`) as untrusted, transcript-derived content.
- **Mandatory caveats**: the prompt insists on a `caveats` field,
  surfaced verbatim in the UI.

**Used by:** `services/reportGeneration.service.ts:generateCreatorReport`.

---

### `topicReport.prompt.ts` (version `topic-report-v5`)

**What it asks the LLM:** "Write a quote-grounded, trend-aware digest of
*one* creator's stance on *one* topic — what they ACTUALLY SAID, over
time."

**Why it exists:** the topic-report endpoint gives a focused per-topic
analysis. Different from creator-report (which is wide and shallow);
topic-report is narrow and deep.

**The prompt's design choices:**

- **`trendLabel` is ground truth for movement**: the prompt only narrates
  a shift when the analyzed label is `gradual_shift`/`abrupt_shift`, and
  otherwise characterizes the consistent stance — it can't invent a shift
  the data doesn't support.
- **Grounded in verbatim `quotes`**: a mandatory "In their own words"
  section must feature 2-4 of the supplied quotes (selected + cleaned by
  `utils/reportText.ts`), each attributed to its video + date + stance. A
  report with no concrete quotes is treated as a failure.
- **Includes the timeline summary** as context (so the model isn't
  re-deriving it); the per-video summaries and quotes are fenced
  (`fencing.ts`) as untrusted input.
- **Per-video evidence array** that the UI uses to render an evidence
  trail at the bottom of the report.

**Used by:** `services/reportGeneration.service.ts:generateTopicReport`.

---

## How prompt files connect to schema files

There's a **1:1 (mostly) pairing**:

| Prompt                           | Paired schema                    |
| -------------------------------- | -------------------------------- |
| `topicDetection.prompt.ts`       | `topicDetection.schema.ts`       |
| `stanceClassification.prompt.ts` | `stanceClassification.schema.ts` |
| `videoTopicSummary.prompt.ts`    | `videoTopicSummary.schema.ts`    |
| `creatorTimeline.prompt.ts`      | `creatorTimeline.schema.ts`      |
| `creatorReport.prompt.ts`        | `report.schema.ts` (shared)      |
| `topicReport.prompt.ts`          | `report.schema.ts` (shared)      |

The schema validates the JSON the LLM returns in response to the
prompt. They're **partners**: changing the prompt's expected output
shape requires updating the schema, and vice versa.

(`fencing.ts` has no paired schema — it isn't an LLM task, just the
shared input-sanitization helper the builders above call.)

---

## "Where do I look when X happens"

| You want to fix...                                           | Open...                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| LLM produces wrong topic list                                | `topicDetection.prompt.ts`                                         |
| Stance label is too aggressive / cautious                    | `stanceClassification.prompt.ts`                                   |
| Per-video summary is too long / too vague                    | `videoTopicSummary.prompt.ts`                                      |
| Trend detection misses gradual shifts                        | `creatorTimeline.prompt.ts`                                        |
| Report is missing caveats                                    | `creatorReport.prompt.ts` / `topicReport.prompt.ts`                |
| You changed a prompt and want to invalidate cached responses | Bump the `*_PROMPT_VERSION` constant at the top of the prompt file |
