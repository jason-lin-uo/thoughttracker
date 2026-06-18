import { describe, it, expect, afterEach } from "vitest";
import { configureDemoMode } from "../src/middleware/rateLimiter";

const original = {
  DEMO_MODE: process.env.DEMO_MODE,
  AI_PROVIDER: process.env.AI_PROVIDER,
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
  YOUTUBE_PROVIDER: process.env.YOUTUBE_PROVIDER,
  STANCE_ANALYSIS_PROVIDER: process.env.STANCE_ANALYSIS_PROVIDER,
};

afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("configureDemoMode", () => {
  it("no-ops when DEMO_MODE is unset", () => {
    delete process.env.DEMO_MODE;
    process.env.AI_PROVIDER = "openai";
    configureDemoMode();
    expect(process.env.AI_PROVIDER).toBe("openai");
  });

  it("does not rewrite providers when DEMO_MODE evaluates falsy", () => {
    process.env.DEMO_MODE = "false";
    process.env.AI_PROVIDER = "anthropic";
    configureDemoMode();
    expect(process.env.AI_PROVIDER).toBe("anthropic");
  });
});

describe("env.ts edge cases", () => {
  it("imports without throwing and exposes real-provider defaults", async () => {
    const env = await import("../src/config/env");
    expect(env.env.aiProvider).toBeDefined();
    expect(env.env.embeddingProvider).toBeDefined();
    expect(env.env.youtubeProvider).toBeDefined();
    expect(typeof env.num).toBe("function");
  });
});
