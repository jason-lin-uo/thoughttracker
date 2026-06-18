# \_LEARN.md — `backend/tests/`

> 22 files. The proof that the backend works. 100% line coverage,
> 408 tests, stable across 10/10 consecutive runs.

---

## The story of this folder

Imagine a building inspector who walks through the restaurant and
checks **every appliance, every counter, every wiring run** to make
sure it works as designed. Not just "the kitchen serves food" — but
"the freezer holds temperature when the door is opened, the oven
doesn't overheat the surrounding cabinets, the dishwasher's emergency
stop button actually stops it."

That's what this folder is. Each test file inspects one slice of the
backend:

- The **utility helpers** `utils.test.ts` checks them all.
- The **middleware** `middleware.test.ts` mounts each one and verifies
  the request flow.
- The **HTTP routes** `controllers.test.ts` sends fake requests via
  supertest (a testing tool that pretends to be a customer placing
  orders at the counter, without needing a real browser).
- The **AI clients** `ai.test.ts` swaps in a fake `global.fetch`
  (replaces the real "go talk to the outside world" call with a
  pretend one the inspector controls) and verifies the
  provider-switching logic.
- The **background jobs** `jobs.test.ts` runs each one against the
  seeded DB.

The result is **100% line coverage on 1,593 lines of production
code** — every single line is executed by at least one test. Branch
coverage is around 88%; the gap is mostly defensive `else` paths
(safety-net branches the inspector would have to actively break
TypeScript to reach) that TypeScript already proves can never run.
ADR-0007 documents the few `c8 ignore` pragmas (special comments
telling the coverage tool "skip counting this line — it can only
trigger in real-world failure modes we can't easily fake") for the few
lines that genuinely require integration testing.

---

## How the suite is organized

Each test file targets a specific layer. The files were designed so
that opening any one of them gives a coherent slice of the system:

### Layer tests

| File                  | Layer               | What it covers                                                           |
| --------------------- | ------------------- | ------------------------------------------------------------------------ |
| `utils.test.ts`       | `src/utils/*`       | The toolbox — errors, retry, pagination, slugify, dates, hashing, stance |
| `middleware.test.ts`  | `src/middleware/*`  | requestId, errorHandler, idempotency, rateLimiter, timeout               |
| `ai.test.ts`          | `src/ai/*`          | LLM client, embedding client, ML client, mock client, budget, cache      |
| `services.test.ts`    | `src/services/*`    | All 13 services (most heavily tested file)                               |
| `controllers.test.ts` | `src/controllers/*` | Every HTTP endpoint via supertest                                        |
| `jobs.test.ts`        | `src/jobs/*`        | analyzeVideoJob, analyzeCreatorJob, importChannelJob, etc.               |
| `api.test.ts`         | end-to-end          | Full pipeline tests using the seeded DB                                  |

### Specialty tests

| File                             | What it covers                                                      |
| -------------------------------- | ------------------------------------------------------------------- |
| `bulk-import.test.ts`            | Bulk-import job + controller, including inline payload              |
| `chunking-edge-cases.test.ts`    | Edge cases in the chunking service (very long words, unicode, etc.) |
| `demo-and-env.test.ts`           | Demo-mode guardrails + `env.ts` validation shape                    |
| `rate-limiter.test.ts`           | Rate-limit middleware (apiRateLimiter, expensiveRateLimiter)        |
| `llm-providers.test.ts`          | Provider-branch tests (OpenAI, Anthropic, local fallback)           |
| `stance-providers.test.ts`       | STANCE_ANALYSIS_PROVIDER switching (llm / custom_ml / hybrid)       |
| `semantic-json-fallback.test.ts` | The JSON-cosine search path (when pgvector is unavailable)          |
| `shutdown.test.ts`               | Graceful-shutdown logic in `server.ts` (SIGTERM handling)           |

### Coverage-mop files

These four files exist specifically to pin the last few uncovered
branches discovered during the "push to 100%" phase. Each one targets
a narrow set of edge cases that the main test files didn't reach:

| File                              | Targets                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `coverage-service-edges.test.ts`  | Service-layer fallback paths, schema validation failures                               |
| `coverage-provider-edges.test.ts` | Provider-error paths, retry exhaustion                                                 |
| `coverage-misc-edges.test.ts`     | Idempotency eviction, pino-http log levels                                             |
| `coverage-error-handlers.test.ts` | Every controller's `catch (err) { next(err) }` block, via mocked Prisma throws         |
| `coverage-last-mile.test.ts`      | The final-mile branches — predicate tests, success/failure paths the others didn't pin |

These exist because **getting to 100% requires hitting branches that
the natural integration tests don't visit**. Rather than weakening the
coverage gate to 95%, we wrote these focused files.

### Infrastructure files

| File             | What it does                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testHelpers.ts` | Shared utilities — currently `createTimeoutTracker()` for tracking setTimeout handles across test boundaries (so a late-firing timer doesn't pollute the next test) |
| `globalSetup.ts` | Runs once before the whole suite — cleans orphan rows (`Embedding` whose `chunkId` no longer exists) that previous crashed sessions might have left                 |

---

## Why `singleFork: true` in vitest config

Tests in this suite **share a real Postgres connection**. Running them
in parallel would mean multiple tests racing for the same rows (two
inspectors checking the same freezer at the same time, getting in each
other's way). `singleFork: true` forces vitest (the test runner) to
use one worker process — in plain terms, one inspector at a time;
"fork process" is just the OS term for a separate copy of the program
running side-by-side. Tests still overlap within that single inspector
(via promises, which let one inspector start the next check before the
previous one finishes) but the DB is seen by only one test at a time.

The trade-off: the suite takes ~8 seconds instead of ~3 seconds.
Worth it for stability.

---

## Why `retry: 1` in vitest config

Tests that hit a real Postgres + supertest combination occasionally
encounter:

- supertest socket parser errors (`Parse Error: Expected HTTP/...`)
- Postgres connection-pool saturation (`Can't reach database server`)
- Brief 30s timeouts that resolve immediately on retry

These are **environmental**, not test-design issues — they occur ~1
time in 15 runs without any change to the application code. `retry: 1`
absorbs them. Comment in the config explains exactly which classes of
flake it covers and which source-side fixes made the rest go away.

Removing this would require per-test Prisma fixtures (a multi-hour
refactor; investigated and intentionally not done — only addresses 1
of ~5 flake modes for the same effort).

---

## Test isolation strategy

Three layers:

1. **Module-level mocks** — `vi.mock()` at the top of files for
   pure-function mocks (a mock is a stand-in for a real piece of code —
   think of it as a cardboard cutout of a chef that always says
   "supportive" no matter what you ask). Used for the LLM client, ML
   client, the rate-limit cache, etc. These reset between tests
   automatically.

2. **`beforeEach` / `afterEach` cleanup** — special hooks that run
   before and after each test, like the inspector resetting their
   clipboard between rooms. `vi.restoreAllMocks()` puts the cardboard
   cutouts back in storage; env var snapshot/restore preserves settings
   for tests that flip provider switches.

3. **DB state** — tests that **create rows** clean them up in their
   own `finally` block. Tests that read pre-seeded rows assume
   `npm run db:seed` was run before the suite starts. Some flakes
   come from cached `beforeAll` IDs going stale during the run;
   those are handled by re-fetching at test time (api.test.ts,
   controllers.test.ts, services.test.ts).

---

## How `tests/` connects to everything else

```
src/* (production code)
 ▲
 │ imported and exercised by
 │
tests/*.test.ts
 │
 │ rendered into test results by
 │
vitest.config.ts
 │
 │ reads
 │
tests/globalSetup.ts (orphan cleanup)
tests/testHelpers.ts (shared utils)
```

`tests/` is downstream of `src/` — never the other way around. No
production code imports anything from this folder. The only exceptions
are test-only exports in production files (`__resetPgvectorCacheForTests`
in `embedding.service.ts`, `resetIdempotencyStoreForTests` in
`middleware/idempotency.ts`, `drain()` in `jobRunner.ts`) — these are
documented as test-only and never called by real code paths.

---

## "Where do I look when X happens"

| You want to fix...          | Open...                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Specific failing test       | The named file directly (most tests are clearly named)                                                          |
| Coverage dropped below 100% | Find which file has uncovered lines (`vitest --coverage`) — likely one of the `coverage-*` files needs updating |
| Test introduces flakes      | Check `testHelpers.ts` for the timer-cleanup pattern; ensure your `beforeAll` IDs are re-resolved at test time  |
| New service needs tests     | Add to `services.test.ts` (or specialty file if it's substantial)                                               |
| New endpoint needs tests    | Add to `controllers.test.ts`                                                                                    |
| Orphan rows breaking tests  | `globalSetup.ts` cleans them; investigate which test isn't cleaning up its created data                         |
