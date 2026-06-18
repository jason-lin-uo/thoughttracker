import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SNAPSHOT_KEYS = [
  "DEMO_MODE",
  "AI_PROVIDER",
  "EMBEDDING_PROVIDER",
  "YOUTUBE_PROVIDER",
  "STANCE_ANALYSIS_PROVIDER",
] as const;

describe("rateLimiter configureDemoMode", () => {
  let snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    snapshot = {};
    for (const k of SNAPSHOT_KEYS) snapshot[k] = process.env[k];
    for (const k of SNAPSHOT_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      const v = snapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is a no-op when DEMO_MODE is unset", async () => {
    const mod = await import("../src/middleware/rateLimiter");
    expect(mod.DEMO_MODE).toBe(false);
    mod.configureDemoMode();
    expect(process.env.AI_PROVIDER).toBeUndefined();
    expect(process.env.STANCE_ANALYSIS_PROVIDER).toBeUndefined();
  });

  it("is a no-op when DEMO_MODE=false explicitly", async () => {
    process.env.DEMO_MODE = "false";
    const mod = await import("../src/middleware/rateLimiter");
    expect(mod.DEMO_MODE).toBe(false);
    mod.configureDemoMode();
    expect(process.env.AI_PROVIDER).toBeUndefined();
  });

  it("does not rewrite real providers when DEMO_MODE=true", async () => {
    process.env.DEMO_MODE = "true";
    process.env.AI_PROVIDER = "local";
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.YOUTUBE_PROVIDER = "youtube";
    process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";

    const mod = await import("../src/middleware/rateLimiter");
    expect(mod.DEMO_MODE).toBe(true);
    mod.configureDemoMode();

    expect(process.env.AI_PROVIDER).toBe("local");
    expect(process.env.EMBEDDING_PROVIDER).toBe("ml");
    expect(process.env.YOUTUBE_PROVIDER).toBe("youtube");
    expect(process.env.STANCE_ANALYSIS_PROVIDER).toBe("custom_ml");
  });
});

describe("rateLimiter rate-limit middleware exports", () => {
  it("exports apiRateLimiter and expensiveRateLimiter as callable middleware", async () => {
    const mod = await import("../src/middleware/rateLimiter");
    expect(typeof mod.apiRateLimiter).toBe("function");
    expect(typeof mod.expensiveRateLimiter).toBe("function");
  });
});
