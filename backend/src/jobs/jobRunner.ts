import { EventEmitter } from "node:events";
import { logger } from "../utils/logger";

/**
 * Type alias for a background job  -  any async function that completes
 * by returning, or fails by throwing. Jobs receive no arguments because
 * everything they need is closed over by the caller's `enqueue` lambda.
 */
type JobFn = () => Promise<void>;

/**
 * One row in the in-memory queue. Kept tiny  -  just the human-readable
 * name (used in log lines) and the job function itself.
 */
interface Queued {
  name: string;
  fn: JobFn;
}

/**
 * JobRunner  -  a minimal in-process background-job runner.
 *
 * Why we have this (instead of BullMQ / Redis / Sidekiq):
 * - The demo is single-process; we don't need cross-process work
 * distribution.
 * - We do need "kick off long work and return 202 to the client"
 * semantics on import / analysis / report endpoints, and we want
 * those calls to happen serially so we don't OOM the machine by
 * running 50 concurrent analyses.
 * - This 40-line class delivers exactly that, with zero new deps.
 *
 * Behavior:
 * - `enqueue(name, fn)` is fire-and-forget. The function is added to
 * the queue and `process()` is kicked off lazily (no-op if already
 * running) so we don't need an explicit `start()` call.
 * - `process()` is a serial loop. While the queue has work it
 * `shift`s the head, runs it to completion (success or fail), and
 * moves on. Failures are logged but never bubble up  -  we don't want
 * one bad job to kill the runner and silently halt every subsequent
 * enqueue.
 * - Each job is bracketed by start/done log lines with the elapsed ms.
 * Tail `pino-pretty` and you can see job throughput in real time.
 *
 * Trade-offs:
 * - Jobs are lost on process restart. For a portfolio demo this is
 * fine; for production we'd swap the queue for Redis (BullMQ).
 * The exchange point is small: enqueue/process is the entire surface.
 * - Serial execution means a slow job blocks subsequent jobs. We
 * accept this because the alternative (parallel) would require
 * coordination around shared resources (DB connections, LLM rate
 * limits) we don't have time to build.
 */
class JobRunner extends EventEmitter {
  /** FIFO queue of pending jobs. */
  private queue: Queued[] = [];
  /** Re-entrancy guard so process() doesn't start a second loop. */
  private running = false;

  /**
   * Add a job to the queue and ensure the processor is running. Safe to
   * call from anywhere (controllers, other jobs); the void on the
   * `process()` call tells TypeScript we intentionally don't await it.
   *
   * NOTE: deliberately NOT deduplicated by name. Several callers create a
   * row (e.g. an AnalysisRun in `status: "processing"`) and hand its id back
   * for the client to poll BEFORE enqueuing the job that completes it  -  so
   * forever. Jobs run serially and converge; double-submit protection, if
   * needed, belongs at the controller (idempotency middleware), not here.
   * controller (idempotency middleware), not here.
   */
  enqueue(name: string, fn: JobFn): void {
    this.queue.push({ name, fn });
    void this.process();
  }

  /**
   * Drain the queue serially. Idempotent  -  the `running` flag means
   * concurrent `enqueue` calls don't spin up multiple processors.
   * Emits `"empty"` once the queue + in-flight job both clear, so
   * `drain()` can resolve immediately without polling.
   */
  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        /* v8 ignore next -- Array.shift cannot return undefined while length > 0. */
        if (!next) continue;
        logger.info(`[job] start ${next.name}`);
        const startedAt = Date.now();
        try {
          await next.fn();
          logger.info(`[job] done ${next.name}`, {
            ms: Date.now() - startedAt,
          });
        } catch (err) {
          /*
           * Errors are logged + swallowed. We deliberately do NOT
           * re-throw because that would abort the entire processor
           * and silently halt all subsequent enqueues.
           */
          logger.error(`[job] fail ${next.name}`, {
            error: (err as Error).message,
          });
        }
      }
    } finally {
      this.running = false;
      this.emit("empty");
    }
  }

  /**
   * Wait until the queue is empty AND no job is in-flight. Intended
   * for tests that enqueue a job and need to assert on its database
   * effects before the next test runs  -  without this, a queued job
   * from one test can race-update DB state during the next test's
   * read window (e.g. flipping a Video's analysisStatus back to
   * "processing" or "failed" right after the next test asserts on
   * "completed").
   *
   * Resolves immediately if the runner is already idle; otherwise
   * subscribes to the `"empty"` event that `process()` emits in its
   * `finally`. No polling. Has no production callers  -  strictly a
   * test affordance.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.running) return;
    await new Promise<void>((resolve) => {
      this.once("empty", () => resolve());
    });
  }
}

/**
 * The singleton runner for the whole process. Controllers + jobs alike
 * import this and call `.enqueue(name, fn)`. Tests can construct their
 * own `new JobRunner()` to assert behavior in isolation.
 */
export const jobRunner = new JobRunner();
