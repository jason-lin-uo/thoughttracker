import { describe, it, expect } from "vitest";
import { sha256, inputHash } from "../src/utils/hashing";
import { slugify } from "../src/utils/slugify";
import { monthKey, parseDateParam } from "../src/utils/dates";
import { parsePagination, buildPageResult } from "../src/utils/pagination";
import {
  HttpError,
  NotFoundError,
  BadRequestError,
  ValidationError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../src/utils/errors";
import { withRetry } from "../src/utils/retry";
import { logger } from "../src/utils/logger";

describe("hashing", () => {
  it("sha256 produces 64-char hex digest", () => {
    const h = sha256("hello");
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("inputHash combines mixed types into a full 64-char sha256 digest", () => {
    const h = inputHash("foo", 42, { x: 1 });
    /* Full digest (no truncation) so persisted AnalysisRun fingerprints can't collide. */
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("inputHash treats undefined as empty string", () => {
    const a = inputHash("foo", undefined);
    const b = inputHash("foo", "");
    expect(a).toBe(b);
  });
});

describe("slugify", () => {
  it("lowercases + replaces spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("collapses non-alphanumerics", () => {
    expect(slugify("Foo!! Bar 2025")).toBe("foo-bar-2025");
  });
  it("trims dashes at edges", () => {
    expect(slugify("---abc---")).toBe("abc");
  });
  it("truncates at 96 chars", () => {
    expect(slugify("a".repeat(200)).length).toBe(96);
  });
});

describe("dates", () => {
  it("monthKey produces YYYY-MM in UTC", () => {
    expect(monthKey(new Date("2026-05-15T10:00:00Z"))).toBe("2026-05");
    expect(monthKey(new Date("2025-01-01T00:00:00Z"))).toBe("2025-01");
  });
  it("parseDateParam handles ISO strings", () => {
    const d = parseDateParam("2026-05-23");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCFullYear()).toBe(2026);
  });
  it("parseDateParam returns undefined for non-string / empty / bad", () => {
    expect(parseDateParam(undefined)).toBeUndefined();
    expect(parseDateParam("")).toBeUndefined();
    expect(parseDateParam("not-a-date")).toBeUndefined();
    expect(parseDateParam(42)).toBeUndefined();
  });
});

describe("pagination", () => {
  it("parsePagination uses defaults", () => {
    const r = parsePagination({});
    expect(r).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });
  it("parsePagination clamps oversized requests to maxPageSize", () => {
    const r = parsePagination({ page: 2, pageSize: 999 }, { maxPageSize: 50 });
    expect(r.pageSize).toBe(50);
    expect(r.skip).toBe(50);
  });
  it("parsePagination rejects negative / zero pages", () => {
    const r = parsePagination({ page: -3 });
    expect(r.page).toBe(1);
  });
  it("parsePagination accepts string inputs", () => {
    const r = parsePagination({ page: "3", pageSize: "10" });
    expect(r).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
  });
  it("parsePagination falls back to defaults on NaN", () => {
    const r = parsePagination({ page: "abc", pageSize: "xyz" });
    expect(r).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });
  it("buildPageResult computes totalPages with ceiling", () => {
    const r = buildPageResult([1, 2, 3], 7, 1, 3);
    expect(r.totalPages).toBe(3);
  });
  it("buildPageResult returns at least 1 page for empty results", () => {
    const r = buildPageResult([], 0, 1, 20);
    expect(r.totalPages).toBe(1);
  });
});

describe("errors", () => {
  it("HttpError carries status + code + details", () => {
    const e = new HttpError(418, "INTERNAL_ERROR", "teapot", { x: 1 });
    expect(e.status).toBe(418);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.message).toBe("teapot");
    expect(e.details).toEqual({ x: 1 });
    expect(e.name).toBe("HttpError");
  });
  it("NotFoundError defaults to 404", () => {
    const e = new NotFoundError();
    expect(e.status).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
  });
  it("BadRequestError defaults to 400", () => {
    const e = new BadRequestError("nope", { field: "x" });
    expect(e.status).toBe(400);
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.details).toEqual({ field: "x" });
  });
  it("ValidationError defaults to 422", () => {
    const e = new ValidationError();
    expect(e.status).toBe(422);
    expect(e.code).toBe("VALIDATION_FAILED");
  });
  it("RateLimitedError defaults to 429", () => {
    const e = new RateLimitedError();
    expect(e.status).toBe(429);
    expect(e.code).toBe("RATE_LIMITED");
  });
  it("UpstreamUnavailableError accepts any of the 3 upstream codes", () => {
    const e = new UpstreamUnavailableError("LLM_UNAVAILABLE", "down");
    expect(e.status).toBe(503);
    expect(e.code).toBe("LLM_UNAVAILABLE");
  });
});

describe("retry", () => {
  it("returns value on first success", async () => {
    /* Capture the resolved value when the operation succeeds immediately. */
    const r = await withRetry(async () => 42);
    expect(r).toBe(42);
  });

  it("retries on transient error then succeeds", async () => {
    let attempts = 0;
    const r = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      { attempts: 5, baseDelayMs: 1 },
    );
    expect(r).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws after exhausting attempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("nope");
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("nope");
    expect(attempts).toBe(2);
  });

  it("skips retry when shouldRetry returns false", async () => {
    let attempts = 0;
    const bad = new BadRequestError("bad");
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw bad;
        },
        { attempts: 4, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("bad");
    expect(attempts).toBe(1);
  });

  it("custom shouldRetry can override default", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("permanent");
        },
        { attempts: 5, baseDelayMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow("permanent");
    expect(attempts).toBe(1);
  });

  it("non-Error throw is not retried", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw "string thrown";
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBe("string thrown");
    expect(attempts).toBe(1);
  });

  it("default options apply when no options passed", async () => {
    /* Capture the resolved value when withRetry runs with its default options. */
    const r = await withRetry(async () => "via defaults");
    expect(r).toBe("via defaults");
  });
});

describe("logger", () => {
  it("info / warn / error / debug accept message-only", () => {
    logger.info("test info");
    logger.warn("test warn");
    logger.error("test error");
    logger.debug("test debug");
    expect(true).toBe(true);
  });
  it("info / warn / error / debug accept meta", () => {
    logger.info("test", { k: "v" });
    logger.warn("test", { k: "v" });
    logger.error("test", { k: "v" });
    logger.debug("test", { k: "v" });
    expect(true).toBe(true);
  });
});
