import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  clearPublicReadCache,
  getPublicReadCacheStats,
  isPublicReadCacheablePath,
  publicReadCache,
} from "../src/middleware/publicReadCache";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("publicReadCache", () => {
  beforeEach(() => {
    clearPublicReadCache();
  });

  afterEach(() => {
    clearPublicReadCache();
  });

  it("recognizes the public read paths the UI repeatedly loads", () => {
    expect(isPublicReadCacheablePath("/dashboard")).toBe(true);
    expect(isPublicReadCacheablePath("/api/reports/report-1")).toBe(true);
    expect(isPublicReadCacheablePath("/api/creators/creator-1/overview")).toBe(
      true,
    );
    expect(isPublicReadCacheablePath("/api/import-jobs/job-1")).toBe(false);
  });

  it("serves repeated mounted GETs from memory", async () => {
    const app = express();
    const router = express.Router();
    let calls = 0;

    router.use(publicReadCache(1_000));
    router.get("/dashboard", (_req, res) => {
      calls += 1;
      res.json({ calls });
    });
    app.use("/api", router);

    const first = await request(app).get("/api/dashboard");
    const second = await request(app).get("/api/dashboard");

    expect(first.headers["x-read-cache"]).toBe("MISS");
    expect(second.headers["x-read-cache"]).toBe("HIT");
    expect(second.body.calls).toBe(1);
    expect(calls).toBe(1);
    expect(getPublicReadCacheStats()).toEqual({ size: 1 });
  });

  it("expires stale entries and recomputes them", async () => {
    const app = express();
    let calls = 0;

    app.use(publicReadCache(1));
    app.get("/api/topics", (_req, res) => {
      calls += 1;
      res.json({ calls });
    });

    await request(app).get("/api/topics");
    await delay(5);
    const second = await request(app).get("/api/topics");

    expect(second.headers["x-read-cache"]).toBe("MISS");
    expect(second.body.calls).toBe(2);
    expect(getPublicReadCacheStats()).toEqual({ size: 1 });
  });

  it("can be disabled explicitly or by the test-env default", async () => {
    const defaultDisabled = express();
    let defaultCalls = 0;
    defaultDisabled.use(publicReadCache());
    defaultDisabled.get("/api/dashboard", (_req, res) => {
      defaultCalls += 1;
      res.json({ defaultCalls });
    });

    await request(defaultDisabled).get("/api/dashboard");
    const defaultSecond = await request(defaultDisabled).get("/api/dashboard");

    const disabled = express();
    let disabledCalls = 0;
    disabled.use(publicReadCache(0));
    disabled.get("/api/dashboard", (_req, res) => {
      disabledCalls += 1;
      res.json({ disabledCalls });
    });

    await request(disabled).get("/api/dashboard");
    const disabledSecond = await request(disabled).get("/api/dashboard");

    expect(defaultSecond.headers["x-read-cache"]).toBeUndefined();
    expect(defaultSecond.body.defaultCalls).toBe(2);
    expect(disabledSecond.headers["x-read-cache"]).toBeUndefined();
    expect(disabledSecond.body.disabledCalls).toBe(2);
  });

  it("uses the PUBLIC_READ_CACHE_TTL_MS env var when no override is passed", async () => {
    const originalTtl = process.env.PUBLIC_READ_CACHE_TTL_MS;
    process.env.PUBLIC_READ_CACHE_TTL_MS = "1000";

    try {
      const app = express();
      let calls = 0;
      app.use(publicReadCache());
      app.get("/api/dashboard", (_req, res) => {
        calls += 1;
        res.json({ calls });
      });

      const first = await request(app).get("/api/dashboard");
      const second = await request(app).get("/api/dashboard");

      expect(first.headers["x-read-cache"]).toBe("MISS");
      expect(second.headers["x-read-cache"]).toBe("HIT");
      expect(second.body.calls).toBe(1);
    } finally {
      if (originalTtl === undefined) {
        delete process.env.PUBLIC_READ_CACHE_TTL_MS;
      } else {
        process.env.PUBLIC_READ_CACHE_TTL_MS = originalTtl;
      }
    }
  });

  it("bypasses non-cacheable reads", async () => {
    const nonCacheable = express();
    let liveCalls = 0;
    nonCacheable.use(publicReadCache(1_000));
    nonCacheable.get("/api/import-jobs/job-1", (_req, res) => {
      liveCalls += 1;
      res.json({ liveCalls });
    });
    await request(nonCacheable).get("/api/import-jobs/job-1");
    const liveSecond = await request(nonCacheable).get("/api/import-jobs/job-1");

    expect(liveSecond.headers["x-read-cache"]).toBeUndefined();
    expect(liveSecond.body.liveCalls).toBe(2);
  });

  it("does not store failed reads", async () => {
    const app = express();
    let calls = 0;

    app.use(publicReadCache(1_000));
    app.get("/api/reports/missing", (_req, res) => {
      calls += 1;
      res.status(404).json({ calls });
    });

    await request(app).get("/api/reports/missing");
    const second = await request(app).get("/api/reports/missing");

    expect(second.headers["x-read-cache"]).toBe("MISS");
    expect(second.body.calls).toBe(2);
    expect(getPublicReadCacheStats()).toEqual({ size: 0 });
  });

  it("clears cached reads after successful mutations only", async () => {
    const app = express();
    app.use(express.json());
    app.use(publicReadCache(1_000));
    let dashboardCalls = 0;

    app.get("/api/dashboard", (_req, res) => {
      dashboardCalls += 1;
      res.json({ dashboardCalls });
    });
    app.post("/api/reports/fail", (_req, res) => {
      res.status(500).json({ ok: false });
    });
    app.post("/api/reports/reset-starter", (_req, res) => {
      res.status(201).json({ ok: true });
    });

    await request(app).get("/api/dashboard");
    await request(app).post("/api/reports/fail").send({});
    const stillCached = await request(app).get("/api/dashboard");

    await request(app).post("/api/reports/reset-starter").send({});
    const refreshed = await request(app).get("/api/dashboard");

    expect(stillCached.headers["x-read-cache"]).toBe("HIT");
    expect(stillCached.body.dashboardCalls).toBe(1);
    expect(refreshed.headers["x-read-cache"]).toBe("MISS");
    expect(refreshed.body.dashboardCalls).toBe(2);
  });
});
