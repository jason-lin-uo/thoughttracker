# ADR-003 — In-process async job queue for V1

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

ThoughtTracker triggers several long-running tasks: bulk YouTube imports,
per-video analysis (embeddings + topic detection + stance classification),
creator-level timeline generation, and report generation. These can't run
synchronously in the HTTP request path; they take seconds to minutes.

The textbook production answer is **Redis + BullMQ** (or Sidekiq /
Celery / SQS). That gives durable queues, retries, dead-letter queues,
visibility across multiple worker processes, and survival across deploys.

For V1, none of those properties are needed yet.

## Decision

Use a **single in-process async queue** (`jobs/jobRunner.ts`) with these
characteristics:

- A `Queued[]` array + a `running` boolean.
- `enqueue(name, fn)` pushes a job and starts the drain loop if it's not
  already running.
- Each job runs sequentially; one job at a time per process.
- Logs each job's start, completion, and failure with timings.

Jobs themselves (`importChannel.job.ts`, `analyzeVideo.job.ts`, …) live in
`jobs/`. They are plain async functions that mutate the database. They
**queue further jobs** to chain work — e.g., `importChannel` queues
`analyzeVideo` per video, then queues `analyzeCreator` at the end.

## Why this is fine for V1

- One process. One queue. No coordination problem.
- Jobs are idempotent enough that a process crash mid-job means the user
  re-runs the import — no half-states that can't be recovered by another
  import. (Re-runs of identical (topic, chunk) hit the LLM response cache.)
- The mock providers make jobs run in milliseconds, so even a "100 videos
  × 5 topics × 5 chunks" import completes in under a minute on a laptop.

## When this must change

The hard tripwires are:

1. **More than one backend process.** The in-process queue would split
   work across processes inconsistently.
2. **Production deploy must not lose queued work.** Today, `docker stop`
   mid-import loses queued jobs.
3. **Per-user fairness.** Today, one long import blocks all other users.

Any one of these triggers the V2 swap.

## Planned V2 swap

```
jobRunner.enqueue(name, fn) → bullmqQueue.add(name, payloadOrFnRef, opts)
 │
 ▼
 Redis (durable)
 │
 ┌───────────────┴───────────────┐
 ▼ ▼ ▼
 worker 1 worker 2 worker N
```

Job functions don't need to change; they need to accept a serializable
payload instead of closing over local variables. A small refactor — but
not one to make before users exist.

## Consequences

- One file (`jobRunner.ts`) is the entire queue implementation.
- No queue dashboard / metrics for V1. We get visibility from the
  per-`AnalysisRun` records in the DB.
- An "is this job still running" UI signal is implemented by polling the
  DB row's status (`pending` / `processing` / `completed` / `failed`).

## Alternatives considered

- **Redis + BullMQ today.** Rejected: adds an infra dependency for zero
  V1 benefit. The cost of swapping later is small because the job
  contract is already a plain `(name, fn)` shape.
- **Worker threads.** Rejected: same coordination problem as multi-process,
  without the durability win.
