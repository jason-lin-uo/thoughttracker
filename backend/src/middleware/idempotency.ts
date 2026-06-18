import type { RequestHandler, Response } from "express";

/**
 * Idempotency-Key middleware.
 *
 * For mutating endpoints, the client can include an `Idempotency-Key`
 * header. Within a fixed window (default 60s), repeated requests with the
 * same key + path + method replay the cached response instead of executing
 * the handler again.
 *
 * Used to prevent accidental double-submits from a flaky network or a
 * double-click on the "Generate report" button creating two AnalysisRun
 * rows.
 *
 * In-process LRU cache; per-pod. For multi-process deploys, swap the
 * internal store for Redis (`SETEX <key> <ttl> <body>`). Documented in
 * ADR-003.
 */

const WINDOW_MS = 60_000;
const MAX_ENTRIES = 500;
/*
 * Cap the accepted Idempotency-Key length. An unbounded header value lets a
 * client bloat the in-memory store with a giant key (and key string) per
 * request; 200 chars comfortably fits a UUID / ULID / hash while bounding
 * memory. Over-length keys are rejected with 400 rather than silently
 * truncated (which could collide distinct keys).
 */
const MAX_KEY_LENGTH = 200;
/*
 * The middleware is mounted at `/api`, so `req.path` is mount-RELATIVE
 * (e.g. `/import-jobs/youtube-channel`, not `/api/import-jobs/...`). These
 * must therefore be the mount-relative paths or the guard never matches and
 * silently caches admin-gated responses in front of the PIN check. We match
 * on the mount-relative path below and, defensively, on the full
 * `req.originalUrl` so the guard holds regardless of how the router is mounted.
 */
const PIN_GATED_MUTATION_PATHS = new Set([
  "/import-jobs/youtube-channel",
  "/import-jobs/bulk-import",
  "/creator-onboarding/run",
  "/topics",
  "/reports/bulk-delete",
]);

/*
 * The DYNAMIC (param-bearing) admin-gated mutation routes. These also run a
 * `requireAdmin` check, so — exactly like the static paths above — a cached
 * idempotent replay must not sit in front of their authorization. Listing them
 * as patterns (rather than relying on someone remembering to add each new
 * `:id` route to the set) is what closes the bypass for analysis-run, manual
 * transcript / re-chunk, embedding-regeneration, and creator/-topic report
 * generation endpoints.
 */
const ADMIN_MUTATION_PATH_PATTERNS: RegExp[] = [
  /^\/analysis\/(videos|creators)\/[^/]+\/run$/,
  /^\/videos\/[^/]+\/transcript\/(manual|rechunk)$/,
  /^\/embeddings\/creator\/[^/]+\/generate$/,
  /^\/reports\/creator\/[^/]+(?:\/topic\/[^/]+)?\/generate$/,
];

/**
 * isAdminGatedMutationPath — true when this request targets ANY admin-gated
 * mutating endpoint (static PIN-gated path OR a dynamic `requireAdmin` route),
 * checking the mount-relative `req.path`, the full `req.originalUrl` (minus
 * query), and the `/api`-stripped form so the guard matches however the
 * middleware is mounted. Such routes must never have a replay cached in front
 * of their authorization check.
 */
function isAdminGatedMutationPath(
  reqPath: string,
  originalUrl: string | undefined,
): boolean {
  const fullPath = originalUrl
    ? (originalUrl.split("?")[0] ?? originalUrl)
    : "";
  const candidates = [reqPath, fullPath, fullPath.replace(/^\/api/, "")].filter(
    Boolean,
  );
  if (candidates.some((c) => PIN_GATED_MUTATION_PATHS.has(c))) return true;
  return candidates.some((c) =>
    ADMIN_MUTATION_PATH_PATTERNS.some((re) => re.test(c)),
  );
}

interface CachedResponse {
  status: number;
  body: unknown;
  storedAt: number;
  /**
   * How the captured body should be replayed. `res.json` responses serialize
   * `body` as JSON; `res.send` responses (strings, Buffers, non-JSON payloads)
   * are replayed verbatim via `res.send` so we don't re-wrap a string in JSON
   * quotes or mangle a Buffer. Absent for the in-flight placeholder.
   */
  kind?: "json" | "send";
  /**
   * True while the first request for this key is still executing (the
   * response hasn't been captured yet). Used to close the TOCTOU window:
   * two concurrent requests with the same key would both miss the
   * completed-entry check and both execute, defeating the dedup guarantee
   * and creating e.g. two AnalysisRun rows. The first request CLAIMS the
   * key with an in-flight placeholder before calling `next()`; a concurrent
   * second request sees the claim and is rejected with 409 instead of
   * executing the handler a second time.
   */
  inFlight?: boolean;
}

const store = new Map<string, CachedResponse>();

/**
 * Build the cache key. Keying on method + path + idempotency key prevents
 * cross-route collisions if two endpoints share a key namespace.
 */
function makeKey(method: string, path: string, idempotencyKey: string): string {
  return `${method.toUpperCase()} ${path} :: ${idempotencyKey}`;
}

/** Evict expired entries opportunistically. Cheap; no separate timer needed. */
function evictExpired(now: number): void {
  for (const [k, v] of store) {
    /*
     * Never evict an IN-FLIGHT claim: its `storedAt` is the claim time, so a
     * handler still running past the window would otherwise have its claim
     * dropped here, letting a concurrent retry execute the handler a second
     * time. Only completed (cached) entries are eligible for expiry.
     */
    if (!v.inFlight && now - v.storedAt > WINDOW_MS) store.delete(k);
  }
}

/** Cap the cache at MAX_ENTRIES with FIFO eviction. */
function evictIfOversize(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    /* v8 ignore next -- a non-empty Map always yields an oldest key. */
    if (!oldest) break;
    store.delete(oldest);
  }
}

/**
 * Middleware that intercepts mutating requests carrying an
 * `Idempotency-Key` header. Replays a cached response if one is found;
 * otherwise wraps BOTH `res.json` and `res.send` so the first response is
 * captured for later regardless of which primitive the handler used (a body
 * sent via `res.send` is replayed verbatim, not re-wrapped as JSON). Truly
 * streamed responses that never call json/send simply release the claim on
 * `finish` and aren't cached.
 */
export const idempotencyMiddleware: RequestHandler = (req, res, next) => {
  const key = req.header("idempotency-key");
  if (!key) return next();
  /* Only meaningful on state-mutating verbs. */
  if (req.method === "GET" || req.method === "HEAD") return next();
  /*
   * Admin-gated mutating routes must execute their auth check on every
   * request; do not let a cached response sit in front of authorization.
   */
  if (isAdminGatedMutationPath(req.path, req.originalUrl)) return next();
  /*
   * Reject an over-length key up front (DoS / memory-bloat guard) rather than
   * letting it become a giant Map key.
   */
  if (key.length > MAX_KEY_LENGTH) {
    res.status(400).json({
      error: "BAD_REQUEST",
      message: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
    });
    return;
  }

  const now = Date.now();
  evictExpired(now);

  const cacheKey = makeKey(req.method, req.path, key);
  const cached = store.get(cacheKey);
  if (cached) {
    /*
     * A still-in-flight claim means a concurrent request with the same key is
     * already executing. Reject the duplicate with 409 rather than running the
     * handler a second time — this is the atomic key-claim that closes the
     * TOCTOU window (both requests previously missed and both executed).
     */
    if (cached.inFlight) {
      res.status(409).json({
        error: "CONFLICT",
        message: "A request with this Idempotency-Key is already in progress.",
      });
      return;
    }
    res.setHeader("Idempotent-Replay", "true");
    res.status(cached.status);
    /*
     * Replay through the SAME primitive that captured it so a `res.send`
     * (string/Buffer/non-JSON) body isn't re-encoded as JSON, and vice versa.
     */
    if (cached.kind === "send") {
      res.send(cached.body);
    } else {
      res.json(cached.body);
    }
    return;
  }

  /*
   * CLAIM the key atomically (single-threaded JS: this set + the get above run
   * without interleaving) before doing any async work, so a concurrent request
   * sees the in-flight marker and is rejected above.
   */
  store.set(cacheKey, {
    status: 0,
    body: undefined,
    storedAt: now,
    inFlight: true,
  });
  evictIfOversize();

  /*
   * Wrap BOTH json() and send() so we capture the first real response
   * regardless of which primitive the handler used. Express's `res.json`
   * ultimately calls `res.send`, so we must NOT capture inside both for a
   * single response (that would store the JSON twice and the `send` capture
   * would clobber the `json` one with a pre-stringified body). We track which
   * wrapper fired first and let it win; `res.json` sets a guard the inner
   * `res.send` honors.
   */
  let captured = false;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  /*
   * Cache only SUCCESSFUL responses (status < 400). A cached 4xx/5xx would
   * replay a transient failure for the whole window and block the client's
   * legitimate retry; by NOT storing it, the in-flight claim is left in place
   * and released by the `finish` handler below so the retry re-executes.
   * `storedAt` is the COMPLETION time (Date.now()), not request start, so the
   * replay window measures from when the response was ready.
   */
  (res as Response).json = (body: unknown) => {
    if (!captured) {
      captured = true;
      if (res.statusCode < 400) {
        store.set(cacheKey, {
          status: res.statusCode,
          body,
          storedAt: Date.now(),
          kind: "json",
        });
        evictIfOversize();
      }
    }
    return originalJson(body);
  };

  (res as Response).send = (body: unknown) => {
    if (!captured) {
      captured = true;
      if (res.statusCode < 400) {
        /* Cache the raw payload (string/Buffer/object) to replay verbatim. */
        store.set(cacheKey, {
          status: res.statusCode,
          body,
          storedAt: Date.now(),
          kind: "send",
        });
        evictIfOversize();
      }
    }
    return originalSend(body);
  };

  /*
   * If the handler never sends a body (error before a response, a bare
   * `res.end()`, or a streamed/piped response we don't wrap), release the
   * in-flight claim on response finish so the key doesn't stay locked for the
   * full window and wrongly 409 a legitimate retry.
   */
  res.on("finish", () => {
    const current = store.get(cacheKey);
    if (current?.inFlight) store.delete(cacheKey);
  });

  next();
};

/** Test hook: clear the in-memory store. */
export function resetIdempotencyStoreForTests(): void {
  store.clear();
}
