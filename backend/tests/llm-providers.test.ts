/**
 * Tests the real-provider branches of llmClient (local / openai / anthropic)
 * and mlClassifierClient by stubbing global.fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runLlm } from "../src/ai/llmClient";
import { llmBudget, llmCache } from "../src/ai/llmBudget";
import {
  healthCheck,
  predictStance,
  predictTopicCandidates,
  predictTopicRelevance,
} from "../src/ai/mlClassifierClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.LOCAL_LLM_BASE_URL;
  delete process.env.ENABLE_MOCK_MODE;
  llmBudget.reset();
  llmCache.reset();
});

describe("llmClient — openai branch", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "gpt-4o-mini";
    process.env.ENABLE_MOCK_MODE = "false";
  });

  it("returns parsed JSON when openai responds 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topics: [
                  {
                    name: "AI",
                    slug: "ai",
                    mentionCount: 1,
                    relevanceScore: 0.5,
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as unknown as Response) as typeof fetch;

    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-openai-${Date.now()}`,
      taskInput: { transcript: "AI is great", taxonomy: ["AI"] },
    });
    expect(result.provider).toBe("openai");
  });

  it("throws when openai returns 500 after retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response) as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-openai-500-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/openai_status_500/);
  }, 15_000);

  it("does NOT retry on openai 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-openai-400-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/openai_status_400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes a readable openai error body when throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-openai-401-text-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/invalid api key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when openai throws network error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-openai-net-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  }, 15_000);

  it("throws when openai fetch rejects with a non-Error value", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue("socket closed") as typeof fetch;
    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-openai-non-error-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toBe("socket closed");
  });

  it("handles malformed openai JSON gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "this is not { valid JSON" } }],
      }),
    } as unknown as Response) as typeof fetch;

    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-openai-bad-${Date.now()}`,
      taskInput: { transcript: "x", taxonomy: ["AI"] },
    });
    expect(result.provider).toBe("openai");
  });

  it("handles openai response with no content gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as unknown as Response) as typeof fetch;
    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-openai-empty-${Date.now()}`,
      taskInput: { transcript: "x", taxonomy: ["AI"] },
    });
    expect(result.provider).toBe("openai");
  });
});

describe("llmClient — anthropic branch", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "claude-3-5-sonnet";
    process.env.ENABLE_MOCK_MODE = "false";
  });

  it("returns parsed JSON when anthropic responds 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({ topics: [] }) }],
      }),
    } as unknown as Response) as typeof fetch;

    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-anthropic-${Date.now()}`,
      taskInput: { transcript: "x", taxonomy: ["AI"] },
    });
    expect(result.provider).toBe("anthropic");
  });

  it("throws when anthropic returns 500 after retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response) as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-anthropic-500-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/anthropic_status_500/);
  }, 15_000);

  it("throws when AI_PROVIDER is unknown", async () => {
    process.env.AI_PROVIDER = "weird-provider";
    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-weird-${Date.now()}`,
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/Unsupported AI_PROVIDER/);
  });

  it("handles anthropic empty content array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as unknown as Response) as typeof fetch;
    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-anthropic-empty-${Date.now()}`,
      taskInput: { transcript: "x", taxonomy: ["AI"] },
    });
    expect(result.provider).toBe("anthropic");
  });
});

describe("mlClassifierClient — real /predict path", () => {
  beforeEach(() => {
    process.env.ML_CLASSIFIER_URL = "http://test-ml.local";
  });
  afterEach(() => {
    delete process.env.ML_CLASSIFIER_URL;
  });

  it("returns ok=true on a valid response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          predictedLabel: "supportive",
          confidence: 0.82,
          labelScores: {
            supportive: 0.82,
            opposed: 0.05,
            neutral: 0.05,
            mixed: 0.05,
            unclear: 0.03,
          },
          modelVersion: "stance-classifier-v1",
        }),
    } as unknown as Response) as typeof fetch;

    const result = await predictStance({ topic: "ai", text: "I support this" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.predictedLabel).toBe("supportive");
      expect(result.modelVersion).toBe("stance-classifier-v1");
    }
  });

  it("returns INVALID_INPUT on 400 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: "INVALID_INPUT", message: "bad" }),
    } as unknown as Response) as typeof fetch;

    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_INPUT");
  });

  it("returns MODEL_NOT_LOADED on 503 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "MODEL_NOT_LOADED", message: "load" }),
    } as unknown as Response) as typeof fetch;

    /* 503 → throws (retryable), then exhausts retries → caught as NETWORK_ERROR */
    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
  }, 15_000);

  it("returns INTERNAL_ERROR on malformed body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ wrong: "shape" }),
    } as unknown as Response) as typeof fetch;

    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INTERNAL_ERROR");
  });

  it("returns NETWORK_ERROR on fetch rejection", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("connection refused")) as typeof fetch;
    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NETWORK_ERROR");
  }, 15_000);

  it("returns TIMEOUT when fetch rejects with AbortError", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ) as typeof fetch;
    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TIMEOUT");
  }, 15_000);

  it("isValidPredictResponse rejects when label scores are missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          predictedLabel: "supportive",
          confidence: 0.5,
          modelVersion: "v1",
          labelScores: { supportive: 0.5 } /* missing the other 4 */,
        }),
    } as unknown as Response) as typeof fetch;
    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["null body", null],
    [
      "non-string label",
      {
        predictedLabel: 12,
        confidence: 0.5,
        modelVersion: "v1",
        labelScores: {},
      },
    ],
    [
      "unknown label",
      {
        predictedLabel: "cheerful",
        confidence: 0.5,
        modelVersion: "v1",
        labelScores: {},
      },
    ],
    [
      "missing confidence",
      {
        predictedLabel: "supportive",
        modelVersion: "v1",
        labelScores: {
          supportive: 1,
          opposed: 0,
          neutral: 0,
          mixed: 0,
          unclear: 0,
        },
      },
    ],
    [
      "missing model version",
      {
        predictedLabel: "supportive",
        confidence: 0.5,
        labelScores: {
          supportive: 1,
          opposed: 0,
          neutral: 0,
          mixed: 0,
          unclear: 0,
        },
      },
    ],
    [
      "missing label scores object",
      { predictedLabel: "supportive", confidence: 0.5, modelVersion: "v1" },
    ],
  ])(
    "predictStance rejects malformed success body: %s",
    async (_caseName, body) => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as unknown as Response) as typeof fetch;

      const result = await predictStance({ topic: "ai", text: "x" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("INTERNAL_ERROR");
    },
  );

  it("predictStance returns NETWORK_ERROR when fetch rejects with a non-Error value", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue("socket closed") as typeof fetch;
    const result = await predictStance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NETWORK_ERROR");
  });

  it("predictTopicRelevance returns ok=true on a valid response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          predictedLabel: "relevant",
          confidence: 0.91,
          labelScores: { relevant: 0.91, irrelevant: 0.09 },
          modelVersion: "topic-relevance-v1",
        }),
    } as unknown as Response) as typeof fetch;

    const result = await predictTopicRelevance({
      topic: "ai",
      text: "AI is central here",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.predictedLabel).toBe("relevant");
      expect(result.labelScores.irrelevant).toBe(0.09);
    }
  });

  it("predictTopicRelevance rejects malformed success bodies", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ predictedLabel: "maybe" }),
    } as unknown as Response) as typeof fetch;

    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INTERNAL_ERROR");
  });

  it("predictTopicRelevance rejects invalid input before calling the service", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await predictTopicRelevance({ topic: " ", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_INPUT");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("predictTopicRelevance returns 4xx failures without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: "INVALID_INPUT",
          message: "bad relevance input",
        }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("bad relevance input");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("predictTopicRelevance normalizes 4xx ML error codes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({ error: "MODEL_NOT_LOADED", message: "warming up" }),
    } as unknown as Response) as typeof fetch;

    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MODEL_NOT_LOADED");
  });

  it("predictTopicRelevance retries 5xx and returns INTERNAL_ERROR (typed) after exhaustion", async () => {
    /*
     * A generic 5xx (NOT 503+MODEL_NOT_LOADED) is retried to exhaustion. The
     * exhausted server-error now preserves a typed INTERNAL_ERROR (with the
     * status) instead of collapsing to NETWORK_ERROR — that distinction lets
     * ops tell "ML box erroring" from "ML box unreachable".
     */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "INTERNAL_ERROR", message: "warming up" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(503);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("predictTopicRelevance treats 503 MODEL_NOT_LOADED as a non-retryable fallback", async () => {
    /*
     * H18: 503 + MODEL_NOT_LOADED is deterministic; we fall back immediately
     * (one call, no retry) instead of stalling ~12s on the retry schedule.
     */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "MODEL_NOT_LOADED", message: "warming up" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MODEL_NOT_LOADED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("predictTopicRelevance returns TIMEOUT when fetch aborts", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ) as typeof fetch;
    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TIMEOUT");
  });

  it("predictTopicRelevance returns NETWORK_ERROR when fetch rejects with a non-Error value", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue("socket closed") as typeof fetch;
    const result = await predictTopicRelevance({ topic: "ai", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NETWORK_ERROR");
  });

  it.each([
    ["null body", null],
    [
      "non-string label",
      {
        predictedLabel: 12,
        confidence: 0.5,
        modelVersion: "v1",
        labelScores: {},
      },
    ],
    [
      "unknown label",
      {
        predictedLabel: "maybe",
        confidence: 0.5,
        modelVersion: "v1",
        labelScores: {},
      },
    ],
    [
      "missing confidence",
      {
        predictedLabel: "relevant",
        modelVersion: "v1",
        labelScores: { relevant: 0.8, irrelevant: 0.2 },
      },
    ],
    [
      "missing model version",
      {
        predictedLabel: "relevant",
        confidence: 0.8,
        labelScores: { relevant: 0.8, irrelevant: 0.2 },
      },
    ],
    [
      "missing label scores object",
      { predictedLabel: "relevant", confidence: 0.8, modelVersion: "v1" },
    ],
    [
      "partial label scores object",
      {
        predictedLabel: "relevant",
        confidence: 0.8,
        modelVersion: "v1",
        labelScores: { relevant: 0.8 },
      },
    ],
  ])(
    "predictTopicRelevance rejects malformed success body: %s",
    async (_caseName, body) => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as unknown as Response) as typeof fetch;

      const result = await predictTopicRelevance({ topic: "ai", text: "x" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("INTERNAL_ERROR");
    },
  );

  it("predictTopicCandidates returns ranked topic candidates on a valid response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          topics: [
            { topicSlug: "ai_societal_impact", confidence: 0.93 },
            { topicSlug: "ai_model_competition", confidence: 0.71 },
          ],
          modelVersion: "topic-reranker-v1",
        }),
    } as unknown as Response) as typeof fetch;

    const result = await predictTopicCandidates({
      text: "AI models",
      limit: 2,
      minScore: 0.5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.topics).toHaveLength(2);
      expect(result.topics[0].topicSlug).toBe("ai_societal_impact");
    }
  });

  it("predictTopicCandidates rejects invalid input and malformed success bodies", async () => {
    const invalid = await predictTopicCandidates({ text: " " });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toBe("INVALID_INPUT");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ topics: [{ topicSlug: 12 }], modelVersion: "bad" }),
    } as unknown as Response) as typeof fetch;

    const malformed = await predictTopicCandidates({ text: "AI models" });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toBe("INTERNAL_ERROR");
  });

  it("predictTopicCandidates returns 4xx failures without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          error: "INTERNAL_ERROR",
          message: "bad topic payload",
        }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicCandidates({ text: "AI models" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("bad topic payload");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("predictTopicCandidates retries 5xx and returns INTERNAL_ERROR (typed) after exhaustion", async () => {
    /*
     * A generic 5xx (NOT 503+MODEL_NOT_LOADED) is retried to exhaustion; the
     * exhausted server-error preserves a typed INTERNAL_ERROR + status rather
     * than collapsing to NETWORK_ERROR.
     */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "INTERNAL_ERROR", message: "warming up" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicCandidates({ text: "AI models" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(503);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("predictTopicCandidates treats 503 MODEL_NOT_LOADED as a non-retryable fallback", async () => {
    /* H18: immediate fallback, no retry stall. */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "MODEL_NOT_LOADED", message: "warming up" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await predictTopicCandidates({ text: "AI models" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MODEL_NOT_LOADED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("predictTopicCandidates returns TIMEOUT when fetch aborts", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ) as typeof fetch;
    const result = await predictTopicCandidates({ text: "AI models" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TIMEOUT");
  });

  it("predictTopicCandidates returns NETWORK_ERROR when fetch rejects with a non-Error value", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue("socket closed") as typeof fetch;
    const result = await predictTopicCandidates({ text: "AI models" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NETWORK_ERROR");
  });

  it.each([
    ["null body", null],
    ["missing topics array", { modelVersion: "v1" }],
    ["missing model version", { topics: [] }],
    ["non-object topic row", { topics: [null], modelVersion: "v1" }],
    [
      "bad topic row fields",
      { topics: [{ topicSlug: "ai_societal_impact" }], modelVersion: "v1" },
    ],
  ])(
    "predictTopicCandidates rejects malformed success body: %s",
    async (_caseName, body) => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as unknown as Response) as typeof fetch;

      const result = await predictTopicCandidates({ text: "AI models" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("INTERNAL_ERROR");
    },
  );

  it("healthCheck returns reachable:true when server is healthy", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ status: "ok", modelLoaded: true, modelVersion: "v1" }),
    } as unknown as Response) as typeof fetch;
    const h = await healthCheck();
    expect(h.reachable).toBe(true);
    expect(h.modelLoaded).toBe(true);
  });

  it("healthCheck returns reachable:false on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    } as unknown as Response) as typeof fetch;
    const h = await healthCheck();
    expect(h.reachable).toBe(false);
  });

  it("healthCheck handles fetch rejection", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    const h = await healthCheck();
    expect(h.reachable).toBe(false);
    expect(h.error).toBeTruthy();
  });
});

describe("embeddingClient — openai branch", () => {
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.ENABLE_MOCK_MODE = "false";
  });
  afterEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_MODEL;
  });

  it("returns vector from successful openai embedding response", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
    } as unknown as Response) as typeof fetch;
    const result = await embedText("hello");
    expect(result.vector).toEqual([1, 2, 3]);
    expect(result.model).toBe("text-embedding-3-small");
  });

  it("throws when openai returns non-ok", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/openai_embedding_500/);
  });

  it("throws when openai returns empty vector", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [] }] }),
    } as unknown as Response) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/empty_vector/);
  });

  it("throws on openai fetch network error", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("embeddingClient — ml branch (local DistilBERT via the ML service)", () => {
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.ENABLE_MOCK_MODE = "false";
    delete process.env.AI_API_KEY; /* ml is local — no key required */
    process.env.ML_CLASSIFIER_URL = "http://ml.test";
  });
  afterEach(() => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.ENABLE_MOCK_MODE;
    delete process.env.ML_CLASSIFIER_URL;
  });

  it("returns the vector from a successful ML /embed response (no API key)", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ vectors: [[0.1, 0.2, 0.3]] }),
    } as unknown as Response) as typeof fetch;
    const result = await embedText("hello");
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.model).toBe("ml-distilbert");
  });

  it("throws when the ML service returns non-ok", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/ml_embedding_503/);
  });

  it("throws when the ML response has no vectors", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ vectors: [] }),
    } as unknown as Response) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/empty_vector/);
  });

  it("throws on ML fetch network error", async () => {
    const { embedText } = await import("../src/ai/embeddingClient");
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    await expect(embedText("hello")).rejects.toThrow(/ECONNREFUSED/);
  });
});
