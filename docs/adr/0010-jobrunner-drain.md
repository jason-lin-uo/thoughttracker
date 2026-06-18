# ADR-010 — `jobRunner.drain()` lives on the JobRunner, not in tests

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

The in-process `JobRunner` (`src/jobs/jobRunner.ts`) is fire-and-forget:
controllers call `enqueue` and respond `202 Accepted` immediately; the
queue runs async. That's correct for production — clients don't want
to block on background work.

For tests, it's a problem. Test files that enqueue a job (via
`POST /api/analysis/videos/:id/run` or similar) move on to the next
test before the queued job finishes. The next test reads DB state that
the still-in-flight queued job is about to mutate. Intermittent
"expected 'completed' but got 'failed'" assertions in
`jobs.test.ts` traced to this race.

## Decision

Add a `drain()` method to `JobRunner`:

```ts
async drain(): Promise<void> {
 if (this.queue.length === 0 && !this.running) return;
 await new Promise<void>((resolve) => {
 this.once("empty", () => resolve());
 });
}
```

`JobRunner` extends `EventEmitter` and emits `"empty"` in the
`process()` loop's `finally`. `drain()` short-circuits when the
runner is already idle; otherwise it subscribes to the next `"empty"`
event. No polling.

Tests call `await jobRunner.drain()` at the top of any test that needs
the queue to be quiescent before its assertions run.

## Why on the JobRunner, not in a test util

The polling/event logic is tightly coupled to the runner's `queue` +
`running` state. Putting it in `tests/_helpers.ts` would either expose
those fields publicly or duplicate the contract. Living on the runner
keeps the API surface coherent: anyone reading `JobRunner` sees what
their tests can do with it.

The method is documented as test-only ("no production callers") so
nobody mistakes it for a public API.

## Consequences

- One class of cross-test race is fully eliminated.
- `JobRunner` is now an `EventEmitter` subclass — minor surface
  growth, but Node's EventEmitter is zero-cost when unused.
- An earlier polling version of `drain()` (10 ms `setTimeout` loop)
  worked but was wasteful and harder to reason about. The event-based
  version is O(1) wake.

## Rejected alternatives

- **`setTimeout` polling.** First implementation; replaced because
  event-based is simpler and faster.
- **Promise-per-job tracking.** Means changing `enqueue` to return a
  Promise. Doable but pollutes the production API for a test-only need.
