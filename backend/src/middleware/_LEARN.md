# \_LEARN.md - `backend/src/middleware/`

> The six security guards / receptionists who handle every request
> *before* it reaches the kitchen, and every response *after* it leaves.

---

## The story of this folder

Imagine an office building. Every visitor - whether they're a customer,
a delivery person, or a job applicant - has to walk through the lobby
on the way in. The lobby has:

- **A receptionist** (`requestId.ts`) who stamps your visitor badge
  with a unique ID so any later report can refer back to you.
- **A signed waiver desk** (`requestIdAndLogger` + `httpLogger`) - every
  visit gets logged with the timestamp, who came in, what they wanted,
  and how long they stayed.
- **A bouncer** (`rateLimiter.ts`) who enforces "no more than 100
  customers per minute" and "no more than 10 of the expensive ones
  per minute."
- **A stopwatch holder** (`timeout.ts`) who starts a 15-second timer
  on every visit and politely shows you out if you overstay.
- **A duplicate-request screener** (`idempotency.ts`) who notices if
  you just made the same request 30 seconds ago and gives you the
  cached answer instead of asking the kitchen twice.
- **An ID-checker at the staff door** (`adminPin.ts`) who blocks every
  *destructive* request (generate/delete reports, imports, analysis,
  onboarding...) unless it carries a valid `x-admin-pin` - and in
  production/demo fails CLOSED if no PIN is configured.
- **A complaints department** (`errorHandler.ts`) at the back door -
  if anything went wrong during your visit, this person shapes the
  bad news into a polite, structured response.

In Express, "middleware" is just a function that takes
`(req, res, next)` and decides whether to keep the request moving or
short-circuit it (in plain terms: each middleware is one greeter standing along the hallway who either waves the visitor along to the next greeter or turns them around right there). Each file in this folder exports one or more of those.
The order they run in is set by `app.ts`.

---

## File-by-file

### `requestId.ts`

**What it is:** two exports. `requestIdAndLogger` is a tiny middleware
that assigns every incoming request a UUID (`req.id`), or honors a
client-provided `X-Request-Id` header if it matches a strict regex.
`httpLogger` is the `pino-http` middleware that logs every request and
response with that ID attached.

**Why it exists:** when something breaks in production, the first thing
the operator wants is "show me everything related to request `abc-123`."
Without a request ID, you can't correlate "the error log line" with
"the response line" with "the SQL query log line." With it, all three
share `requestId: abc-123` and `grep` does the rest.

**Honoring inbound `X-Request-Id`:** if the client sends one (e.g., the
frontend regenerating a UUID - a long, almost-certainly-unique ID string, like a single-use ticket stub - per fetch call), we use that one so the
client can correlate logs from its side. Strict regex (in plain terms: a strict shape-check that rejects anything that doesn't look like a normal ID) on the format
(8-64 chars of `[A-Za-z0-9-_]`) prevents log-injection attacks - visitors sneaking fake log lines in by smuggling them inside the ID field.

**The `redact:` list in `pinoLogger`:** mentioned in `utils/logger.ts`.
That's what keeps secrets out of these per-request logs.

**Used by:** `app.ts` (mounts both as the second and third middleware
after CORS+JSON parsing).

---

### `errorHandler.ts`

**What it is:** the last-resort Express error middleware. Express
recognizes it as an "error handler" because of the four-argument
signature `(err, req, res, next)`. When any prior middleware, route, or
controller throws or calls `next(err)`, this function catches it.

**Why it exists:** without it, an unhandled throw in a controller would
return a 500 with an HTML stack trace - useless for an API. This file
inspects the error: if it's an `HttpError` from `utils/errors.ts`, it
uses the embedded `status` and `code`. If it's a generic Error, it
becomes a 500 with `code: "INTERNAL_ERROR"`. The response always has
the same shape:

```json
{
  "error": "NOT_FOUND",
  "message": "Creator not found",
  "requestId": "abc-123",
  "details": { "creatorId": "missing" }
}
```

That shape is what the frontend's `ApiError` class parses, what
`integration_contract.md` documents, and what every test asserts on.

**Used by:** `app.ts` (mounted last, after all routes).

---

### `idempotency.ts`

**What it is:** middleware that honors the `Idempotency-Key` header - idempotency, in plain terms, means "doing this twice is the same as doing it once," like pressing an already-pressed elevator button - on
mutating requests (POST, PUT, PATCH, DELETE - the request types that *change* something in the kitchen rather than just look at it). If the client sends the
same key twice within 60 seconds, the second call **replays the cached
response** with the header `Idempotent-Replay: true` instead of
re-executing the work.

**Why it exists:** the user clicks "Generate Report" twice in a row. The
frontend has retry logic. The network is flaky. Without idempotency,
each duplicate click creates a duplicate `Report` row in the DB. With
idempotency, only the first call does the work; the second returns the
already-generated result. The header is opt-in - clients that don't
care about replay safety simply omit it.

**Implementation:** an in-memory LRU cache (Least-Recently-Used - in plain terms, a fixed-size shelf that, when full, pushes out whichever item has been gathering dust the longest), 500 entries max, 60-second
TTL (Time To Live - how long an entry sits on the shelf before it's tossed). Older entries get evicted when full. For a portfolio demo this is
fine; production would back this with Redis so the cache survives
process restart. (It also uses an **in-flight claim** so two concurrent
requests with the same key don't both execute - the second gets a 409 -
and it only caches *successful* responses, never a 4xx/5xx.)

**Admin-gated routes bypass the cache:** a cached replay must never sit in
front of an authorization check, so the middleware skips replay for
admin-gated mutating paths. The static PIN-gated set now includes
`/reports/bulk-delete` (alongside `/import-jobs/*`, `/creator-onboarding/run`,
`/topics`), plus dynamic patterns for analysis-run, manual-transcript /
re-chunk, embedding-regen, and report generation. Without this, a replay
could return a success in front of the `requireAdmin` gate.

**`resetIdempotencyStoreForTests`** - a test-only export that clears the
cache so tests don't leak entries to each other.

**Used by:** `app.ts` (mounted after rate limiters, before routes - see
ADR-0007 for why this order matters).

---

### `rateLimiter.ts`

**What it is:** `apiRateLimiter` (100 requests/minute window, applied to
everything), `expensiveRateLimiter` (10/minute, applied selectively to
LLM-heavy or DB-heavy endpoints), and `configureDemoMode()`, the app-level
hook for public-demo safety settings.

**Why it exists:** when this project is deployed to a public demo URL,
rate limits and admin gates prevent a single visitor from burning through
owner-controlled resources. `DEMO_MODE=true` tightens those guardrails; it
does not switch the app away from configured providers or the real corpus.

**Why the rate-limiters and demo-mode hook live in the same file:**
they share the "protect the public demo" concern. Rate limits cap request
volume, while admin gates control expensive mutations. `buildApp()` calls
`configureDemoMode()` before routes mount so these guardrails are active
from the first request.

### `timeout.ts`

**What it is:** `requestTimeout(ms)` - a middleware factory that wraps
each request with a deadline. If the response hasn't been sent by `ms`
milliseconds, a `503 REQUEST_TIMEOUT` is sent automatically and the
client moves on.

**Why it exists:** without a request timeout, a slow upstream (a hung
LLM call, a stuck DB query) can pin an Express worker indefinitely.
Under enough concurrent stuck requests, the whole server stops
responding. The 15-second default in `app.ts` is "long enough for a
real LLM call, short enough that a stuck request frees its slot."

**Only times out GETs by default:** mutating requests (POST/PUT/PATCH/
DELETE) are exempted because they might legitimately take longer (LLM
report generation, bulk imports) and a half-completed mutation is
worse than a slow one.

**Used by:** `app.ts` (mounted right after logging).

---

### `adminPin.ts`

**What it is:** the admin-PIN gate. `requireAdmin` (an alias of
`requireCreatorOnboardingPin`) is Express middleware applied to ALL
mutating routes - report generate + `bulk-delete`, imports, analysis,
transcripts, topics, embeddings, onboarding. It compares the `x-admin-pin`
header against `ADMIN_ONBOARDING_PIN` in **constant time** (both SHA-256
hashed, then `crypto.timingSafeEqual`).

**Why it exists:** these endpoints mutate data or spend money, so the PIN
is the single authorization control. Policy: fail OPEN in local dev so the
demo runs credential-free, but fail CLOSED (403) in production/demo when
no PIN - or a too-short one (`MIN_ADMIN_PIN_LENGTH = 4`) - is configured,
so a misconfigured deploy can't leave destructive routes wide open.
`isCreatorOnboardingPinRequired()` lets the UI/status tell clients a PIN
is expected.

**Unlike the others, this is route-level:** it's wired inline in the
mutating routers (e.g. `routes/reports.routes.ts`,
`routes/creatorOnboarding.routes.ts`), not mounted globally in `app.ts`.

**Used by:** the mutating `routes/*.routes.ts` files.

---

## How middleware/ connects to everything else

This folder is **upstream of everything**. The order in `app.ts`
defines the request flow:

```
INCOMING HTTP REQUEST
 |
 v
 CORS <- lets the right frontends in
 express.json() <- parse JSON body
 requestIdAndLogger <- stamp with req.id, log start
 httpLogger <- Pino's per-request logger
 requestTimeout(15_000) <- start the 15s clock
 apiRateLimiter <- global rate cap
 expensiveRateLimiter <- extra cap on heavy endpoints
 idempotencyMiddleware <- check for replay
 |
 v
 ROUTES -> CONTROLLERS -> SERVICES -> DB / AI
 |
 v
 errorHandler (only if something threw)
 |
 v
 OUTGOING HTTP RESPONSE
```

Reading top-down: the request walks through every middleware until it
either short-circuits (rate limit hit, idempotent replay) or makes it
to a route. The response then walks back out, with `errorHandler`
sitting at the bottom of the stack to catch anything that exploded
along the way.

Order matters enormously. Putting `idempotency` *before* rate limiting
would cache 429 responses - the client retries with the same key after
the window has cleared and *still gets the cached 429*. ADR-0007 has
the order rationale codified.

---

## "Where do I look when X happens"

| You want to fix...                                       | Open...                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "Where did my request go" - find the requestId          | `requestId.ts`                                                                    |
| 500 errors returning HTML instead of JSON                | `errorHandler.ts`                                                                 |
| User says "I clicked Generate twice and got two reports" | `idempotency.ts`                                                                  |
| User says "the demo is throttling me"                    | `rateLimiter.ts` (rate limits)                                                    |
| Stuck request hanging the server                         | `timeout.ts`                                                                      |
| 403 on a mutation / "who can delete reports"            | `adminPin.ts` (`requireAdmin`, `x-admin-pin`)                                     |
| Need to add a new sensitive header to log redaction      | `utils/logger.ts` (`redact:` list)                                                |
| Demo costing real money                                  | `rateLimiter.ts` + `adminPin.ts`; tighten public limits and gate expensive routes |
