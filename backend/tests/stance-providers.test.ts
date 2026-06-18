/**
 * Tests for the stance-provider switch (llm / custom_ml / hybrid).
 * The product no longer has a runtime mock provider; these tests stub the real
 * HTTP boundaries for the local LLM and ML service instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { classifyChunkForTopic } from "../src/services/stanceAnalysis.service";
import { llmCache } from "../src/ai/llmBudget";

const originalFetch = globalThis.fetch;

const mlSuccess = {
  predictedLabel: "supportive",
  confidence: 0.82,
  labelScores: {
    supportive: 0.82,
    opposed: 0.05,
    neutral: 0.05,
    mixed: 0.05,
    unclear: 0.03,
  },
  modelVersion: "v1",
};

const llmSuccess = {
  relevanceScore: 0.88,
  stanceLabel: "opposed",
  confidenceScore: 0.78,
  confidenceLabel: "high",
  claimSummary: "The speaker rejects this approach.",
  rationale: "The local LLM fixture supplies a schema-valid rationale.",
  evidenceQuote: "I disagree with this approach completely.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installProviderFetch(options?: {
  mlStatus?: number;
  mlBody?: unknown;
  mlReject?: Error;
  llmBody?: unknown;
}): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/predict")) {
      if (options?.mlReject) throw options.mlReject;
      return jsonResponse(
        options?.mlBody ?? mlSuccess,
        options?.mlStatus ?? 200,
      );
    }
    if (url.endsWith("/api/chat")) {
      return jsonResponse({
        message: { content: JSON.stringify(options?.llmBody ?? llmSuccess) },
      });
    }
    return jsonResponse({ ok: true });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.ML_CLASSIFIER_URL = "http://test-ml.local";
  process.env.AI_PROVIDER = "local";
  process.env.LOCAL_LLM_BASE_URL = "http://local-llm.test";
  installProviderFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.STANCE_ANALYSIS_PROVIDER;
  delete process.env.ML_CLASSIFIER_URL;
  delete process.env.ML_CLASSIFIER_TIMEOUT_MS;
  delete process.env.AI_PROVIDER;
  delete process.env.LOCAL_LLM_BASE_URL;
  llmCache.reset();
});

describe("stance provider - custom_ml", () => {
  beforeEach(() => {
    process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
  });

  it("uses the ML response with synthesized product rationale on success", async () => {
    const r = await classifyChunkForTopic({
      chunkText: "I support this. " + "lorem ipsum dolor sit amet, ".repeat(5),
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("supportive");
    expect(r.rationale).toMatch(/ThoughtTracker ML model/i);
    expect(r.confidenceLabel).toBe("high");
  });

  it("falls back to the real LLM path when ML returns INVALID_INPUT", async () => {
    installProviderFetch({
      mlStatus: 400,
      mlBody: { error: "INVALID_INPUT", message: "bad" },
    });

    const r = await classifyChunkForTopic({
      chunkText: "I disagree.",
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("opposed");
    expect(r.rationale).toMatch(/schema-valid rationale/i);
  });

  it("maps low-confidence unclear to insufficient_evidence", async () => {
    installProviderFetch({
      mlBody: {
        predictedLabel: "unclear",
        confidence: 0.2,
        labelScores: {
          supportive: 0.15,
          opposed: 0.15,
          neutral: 0.15,
          mixed: 0.15,
          unclear: 0.2,
        },
        modelVersion: "v1",
      },
    });

    const r = await classifyChunkForTopic({
      chunkText: "It's complicated.",
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("insufficient_evidence");
  });

  it("uses medium confidence label for the 0.45-0.7 range", async () => {
    installProviderFetch({
      mlBody: {
        predictedLabel: "neutral",
        confidence: 0.55,
        labelScores: {
          supportive: 0.1,
          opposed: 0.1,
          neutral: 0.55,
          mixed: 0.15,
          unclear: 0.1,
        },
        modelVersion: "v1",
      },
    });

    const r = await classifyChunkForTopic({
      chunkText: "It depends. There are tradeoffs in both directions.",
      topicName: "AI",
    });

    expect(r.confidenceLabel).toBe("medium");
  });
});

describe("stance provider - llm", () => {
  it("uses the local LLM when STANCE_ANALYSIS_PROVIDER=llm", async () => {
    process.env.STANCE_ANALYSIS_PROVIDER = "llm";

    const r = await classifyChunkForTopic({
      chunkText: "I disagree with this approach completely.",
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("opposed");
    expect(r.claimSummary).toMatch(/rejects/i);
  });
});

describe("stance provider - hybrid", () => {
  beforeEach(() => {
    process.env.STANCE_ANALYSIS_PROVIDER = "hybrid";
  });

  it("uses ML for label/confidence and LLM for rationale", async () => {
    installProviderFetch({
      mlBody: {
        ...mlSuccess,
        predictedLabel: "opposed",
        confidence: 0.75,
        labelScores: {
          supportive: 0.05,
          opposed: 0.75,
          neutral: 0.05,
          mixed: 0.1,
          unclear: 0.05,
        },
      },
    });

    const r = await classifyChunkForTopic({
      chunkText: "I disagree with this approach completely.",
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("opposed");
    expect(r.confidenceLabel).toBe("high");
    expect(r.rationale).toMatch(/schema-valid rationale/i);
  });

  it("falls back to the real LLM path when ML is down", async () => {
    installProviderFetch({ mlReject: new Error("ECONNREFUSED") });

    const r = await classifyChunkForTopic({
      chunkText: "I disagree.",
      topicName: "AI",
    });

    expect(r.stanceLabel).toBe("opposed");
  }, 15_000);
});

describe("stance provider - invalid env value", () => {
  it("throws on unknown STANCE_ANALYSIS_PROVIDER", async () => {
    process.env.STANCE_ANALYSIS_PROVIDER = "totally-bogus" as never;
    await expect(
      classifyChunkForTopic({
        chunkText: "I support this.",
        topicName: "AI",
      }),
    ).rejects.toThrow(/Unsupported STANCE_ANALYSIS_PROVIDER/);
  });
});
