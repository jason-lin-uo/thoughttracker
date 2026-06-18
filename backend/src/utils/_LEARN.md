# \_LEARN.md - `backend/src/utils/`

> The toolbox. Eleven tiny files, each doing one boring-but-essential job
> that would otherwise be reinvented in every service.

---

## The story of this folder

Picture a workshop. The big rooms have the big machines (the band saw,
the lathe, the welding station). But every workshop also needs a
**pegboard wall** holding the small tools - the hammer, the screwdriver,
the tape measure, the level. Without them, the big machines are
useless because every project needs to measure, cut, fasten, and
verify.

This folder is that pegboard. Each file is one tool:

- a **hammer** for retry-with-backoff
- a **measuring tape** for pagination
- a **screwdriver** for hashing
- a **level** for date math
- a **stencil** for slug generation
- a **first-aid kit** for typed errors
- a **megaphone** for logging
- a **vote counter** for stance aggregation
- a **lint roller** for cleaning up messy evidence quotes
- a **guest list** for validating enum query params
- a **labeled jar** for shared numeric constants

No tool here knows about the others (well, almost - `retry.ts` uses the
logger and `enums.ts` uses `errors.ts`; those are the only intra-folder
dependencies). Every service, controller, and job reaches into this
folder for whichever tool they need.

---

## File-by-file (alphabetical)

### `constants.ts`

**What it is:** shared numeric constants - currently `MIN_EVIDENCE_RELEVANCE`
(0.4), the minimum per-chunk topic-relevance score for a
`ChunkTopicAnalysis` row to count as real "evidence".

**Why it exists:** the threshold was a bare magic number copy-pasted across
several queries; defining it once (and documenting WHY 0.4) prevents the
drift bug where one call site is bumped and others silently aren't - so
"evidence" means the same thing on every page.

**Used by:** `dashboard.controller`, `creators.controller`,
`search.controller`, `evidence.service`, `creatorComparison.service`,
`jobs/generateReport.job` - anywhere evidence is counted or filtered.

---

### `dates.ts`

**What it is:** two pure functions - `monthKey(date)` returns `"YYYY-MM"`
in UTC, and `parseDateParam(value)` safely turns a `from=2026-03-01`
query-string into a Date or null.

**Why it exists:** every chart in the app buckets data into months. If
every chart wrote its own "convert this Date to a year-month string"
logic, they'd subtly disagree at timezone boundaries - a video uploaded
at 7 PM PST on Dec 31 would land in "December" for one chart and
"January" for another. By centralizing on **UTC bucketing** (in plain terms: everyone agrees to use one shared world-clock so nobody argues about whose midnight counts), every
chart agrees. The functions are pure (no clock, no I/O, no mutation - meaning they don't peek at the time, don't touch files or the network, and don't quietly change anything on the side),
which makes them trivially testable and impossible to introduce
heisenbugs (sneaky bugs that vanish the moment you try to look at them) into.

**Used by:** `services/chartData.service.ts`, `services/creatorComparison.service.ts`,
date-range filters in many
controllers.

---

### `errors.ts`

**What it is:** a small class hierarchy of **typed HTTP errors**:
`HttpError` (the base), `NotFoundError`, `BadRequestError`,
`ValidationError`, `RateLimitedError`, `UpstreamUnavailableError`, etc.
Each has a `status` (HTTP code) and a `code` (machine-readable string
like `"NOT_FOUND"`).

**Why it exists:** Express's default error handling is "if you throw,
the user gets a 500 with an HTML stack trace." That's terrible UX. With
this file, any controller or service can `throw new NotFoundError("Creator
not found")` and the error middleware catches it and shapes a clean
JSON response: `{ error: "NOT_FOUND", message: "Creator not found",
requestId: "abc-123" }`. The frontend can show that message directly to
the user.

**The `ApiErrorCode` union:** every possible error code is enumerated in
a TypeScript union type - in plain terms, a fixed list of allowed labels, like a menu where only the printed dishes can be ordered. That means typos like `"NOT_FUND"` are caught
at compile time (caught before the kitchen even opens, not at dinner service). New error types must be added here first.

**Used by:** every controller (when validating input), every service
(when DB lookups fail), the error middleware (which catches and shapes
the response).

---

### `enums.ts`

**What it is:** `parseEnumParam(value, enumObject, paramName)` - validates
an optional query-string value against a Prisma enum's members, returning
the typed value or `undefined`.

**Why it exists:** controllers used to cast raw query params straight to a
Prisma enum with `as` and pass them into a `where`; an invalid value
(`stanceLabel=bogus`) then reached Postgres and surfaced as an opaque 500. This helper rejects unknown values up front with a 400 that lists the
allowed ones - the correct HTTP semantics for bad client input.

**Used by:** list controllers that filter on enum columns -
`reports.controller` (`reportType`), `videos.controller`,
`evidence.controller`, etc.

---

### `hashing.ts`

**What it is:** two thin wrappers around Node's `crypto.createHash`:
`sha256(str)` returns a hex digest, and `inputHash(...parts)` joins
multiple values with a separator before hashing.

**Why it exists:** SHA-256 is used in three places:

1. **LLM cache keys** - same prompt + same model = same hash = cache
   hit
2. **`AnalysisRun.inputHash`** - fingerprints what inputs an analysis
   was based on, so "did we already analyze this exact thing" is a
   single string comparison
3. **Stable fingerprints** - deterministic hashes keep caches and analysis
   provenance reproducible across runs without storing full prompt inputs
   We use SHA-256 over MD5/SHA-1 because the inputs occasionally include
   text that might be PII (personally identifiable information - names, emails, anything that could trace back to a real person), and SHA-256 has stronger collision resistance (in plain terms: it's much harder for two different inputs to accidentally produce the same fingerprint)
   for free. The extra CPU cost is unnoticeable.

**Used by:** `ai/llmBudget.ts` (cache key building) and
`jobs/analyzeVideo.job.ts` (inputHash for AnalysisRun rows).

---

### `logger.ts`

**What it is:** the **Pino-based structured logger**. In dev it pretty-prints
with colors; in prod it emits newline-delimited JSON suitable for log
aggregators (Datadog, CloudWatch, etc.). Exports two things:
`pinoLogger` (the raw Pino instance, used by `pino-http` middleware) and
`logger` (a thin wrapper that lets the rest of the code call
`logger.info(message, meta)` without remembering Pino's argument order).

**Why it exists:** `console.log` is fine for hobby code; production needs
**structured logging** - in plain terms, log entries that look like neat spreadsheet rows instead of a sticky note pile, so a computer can search them later. Structured logs are queryable ("show me every
error from the last hour where requestId starts with abc-"), redactable
(automatic PII scrubbing - sensitive-info blackout, like the marker a librarian uses to cover patron names before sharing a record - see the `redact:` config that strips
Authorization headers, request-body passwords, tokens, etc.), and
greppable. Pino is the fastest Node.js logger; using it sets a low
performance ceiling.

**The redaction config:** the `redact` paths list - in plain terms, the list of spots inside a log entry where sensitive data tends to hide, so the logger knows exactly which fields to blot out (12 entries) covers
common PII vectors - `req.headers.authorization`, `req.headers.cookie`,
`req.body.password`, `req.body.token`, `req.body.email`, plus wildcards
like `*.password`, `*.apiKey`. Anything matching becomes `[REDACTED]` in
the log output. Without this, an accidental log of `req.headers`
would publish whoever's API key was attached.

**Used by:** **everywhere**. Most call the back-compat `logger` shim;
`middleware/requestId.ts` uses the raw `pinoLogger` to feed pino-http.

---

### `pagination.ts`

**What it is:** `parsePagination(query, defaults)` - takes the raw
`req.query` object (where everything is `string | undefined`), returns
a clean `{ page, pageSize, skip, take }` object with sane defaults and
caps (pageSize maxes at 100 to prevent abuse).

**Why it exists:** every list endpoint needs pagination, and if every
controller hand-rolled "default page to 1, cap pageSize to 100, coerce
strings to ints," the defaults would drift across endpoints. Centralizing
ensures `/api/videos`, `/api/evidence`, `/api/reports` all behave
identically.

**Used by:** every list-style controller -
`controllers/videos.controller.ts`, `controllers/evidence.controller.ts`,
`controllers/reports.controller.ts`, `controllers/importJobs.controller.ts`,
etc.
**Used by:** `ai/llmBudget.ts` (cache key building) and
`jobs/analyzeVideo.job.ts` (inputHash for AnalysisRun rows).

### `reportText.ts`

**What it is:** the report-quote toolkit. `cleanReportQuote(raw)` decodes
HTML entities and strips caption junk (`>>`, `[Music]`, leading speaker
dashes, dangling partial words); `isUsableQuote(cleaned)` hard-rejects
unambiguous garbage (too short, bare questions, ASR stutter, garble); and
`selectReportQuotes(candidates, opts)` picks a balanced, on-topic subset -
ranked by quality (topic relevance, an evaluative/stance cue, completeness)
and stratified so the report LEADS with the dominant stance yet still
surfaces the dissenting minority.

**Why it exists:** evidence quotes are sliced out of auto-captions, so raw
values are messy and skew one-sided; dumping them verbatim made reports
look broken. The functions are pure/deterministic, so they're testable and
reused by the real report-writing paths.

**Used by:** `jobs/generateReport.job.ts` (the topic-report quote pipeline).

---

### `retry.ts`

**What it is:** `withRetry(fn, options)` - a generic helper that retries
a Promise-returning function with **exponential backoff and jitter**.
You give it a function and a config (`attempts: 3, baseDelayMs: 100,
factor: 3, shouldRetry: (err) => ...`), and it handles the rest.

**Why it exists:** when calling external services (OpenAI, Anthropic,
the ML classifier), transient failures are a fact of life - TCP blips,
rate-limit nudges, brief 5xx responses. Retrying with backoff turns
those into invisible recoveries. **Jitter** (random variation in the
delay) is added to prevent the "thundering herd" problem: if 100
requests all fail at the same moment and all retry exactly 100ms later,
they all collide again.

**The `shouldRetry` predicate:** the default predicate skips 4xx errors
(client errors - your request was bad, retrying won't help) and retries
5xx errors and network errors. Each provider client passes its own
predicate when needed.

**Used by:** `ai/llmClient.ts` (wrapping OpenAI/Anthropic calls),
`ai/mlClassifierClient.ts` (wrapping the predict call).

---

### `slugify.ts`

**What it is:** `slugify(name)` - turns "Andrew Huberman microphone" into
`"andrew-huberman"`. Unicode-aware (strips accents via NFKD
normalization), case-insensitive, collapses non-alphanumeric runs into
single dashes, caps at 96 characters.

**Why it exists:** every `Creator` and `Topic` row has both a `name`
(human-readable) and a `slug` (URL-safe). Slugs let URLs like
`/creators/huberman` stay stable even if the creator's display name is
later edited. The slug is the historical identifier; the name is the
display label.

**Used by:** `services/youtubeImport.service.ts` (when ingesting a new
channel), `services/topicDetection.service.ts` (when upserting topics),
`scripts/seed.ts` (when seeding initial creators).

---

### `stance.ts`

**What it is:** one generic function - `dominantStance(tally)` - that
takes either a `Map<StanceLabel, number>` or a `Record<string, number>`
and returns the most-frequent stance, with `"insufficient_evidence"` as
the fallback for empty tallies.

**Why it exists:** two different files (`controllers/creators.controller.ts`
and `services/creatorComparison.service.ts`) both needed to "pick the
dominant stance from a tally." Before this extraction, each had its own
copy and they had **drifted slightly** on the empty-tally fallback (one
returned the typo string `"insufficient evidence"` with a space, the
other returned `"insufficient_evidence"` with underscore). Single source
of truth = no drift. ADR-0008 has more detail.

**TypeScript overload trickery:** the function has two overload
signatures so callers using `Map<StanceLabel, number>` get back the
proper enum type (not a widened `string`), and callers using `Record`
get back `string`. Implementation body is one shared function.

**Used by:** `controllers/creators.controller.ts:getCreatorTopics`,
`services/creatorComparison.service.ts:getCreatorComparison`.

---

## How utils/ connects to everything else

The directional rule for this folder is simple: **utils/ has no
dependencies on anything else in `src/`.** It only depends on Node's
stdlib (crypto, etc.) and a couple of npm libs (pino). That means you
can read every file in this folder cold, in any order, and never need
to look elsewhere.

Conversely, **everyone else depends on utils/.** A quick grep for
`from "../utils"` would show 50+ importers across services, controllers,
jobs, and middleware.

```
utils/ <- (nobody imports anything from outside)
 ^
 |
 +-- used by services/ (most)
 +-- used by controllers/ (errors, pagination)
 +-- used by jobs/ (hashing, retry, logger)
 +-- used by middleware/ (errors, logger)
 +-- used by ai/ (retry, hashing, logger)
```

---

## "Where do I look when X happens"

| You want to fix...                             | Open...                                   |
| ---------------------------------------------- | ----------------------------------------- |
| Bad-shape error response                       | `errors.ts` and the error middleware      |
| Wrong default page size                        | `pagination.ts`                           |
| Chart bucket mismatch                          | `dates.ts` (UTC vs local time bug)        |
| Slug collision or weird URL chars              | `slugify.ts`                              |
| Log line missing the request ID                | `logger.ts` and `middleware/requestId.ts` |
| Need to add a new retryable provider           | `retry.ts` (write a `shouldRetry`)        |
| Stance fallback returning wrong value          | `stance.ts`                               |
| Cache key not matching identical inputs        | `hashing.ts`                              |
| Report quotes look garbled / one-sided         | `reportText.ts`                           |
| Bad enum query param returns 500 not 400       | `enums.ts` (`parseEnumParam`)             |
| "Evidence" threshold inconsistent across pages | `constants.ts` (`MIN_EVIDENCE_RELEVANCE`) |
