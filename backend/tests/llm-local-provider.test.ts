import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLlm } from "../src/ai/llmClient";
import { llmBudget, llmCache } from "../src/ai/llmBudget";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.AI_PROVIDER = "local";
  process.env.AI_MODEL = "llama3.1:8b";
  process.env.LOCAL_LLM_BASE_URL = "http://local-ollama.test/";
  process.env.ENABLE_MOCK_MODE = "false";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.LOCAL_LLM_BASE_URL;
  delete process.env.ENABLE_MOCK_MODE;
  delete process.env.LLM_TIMEOUT_MS;
  llmBudget.reset();
  llmCache.reset();
});

describe("llmClient local Ollama provider", () => {
  it("returns parsed JSON when local Ollama responds 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            topics: [
              { name: "AI", slug: "ai", mentionCount: 1, relevanceScore: 0.5 },
            ],
          }),
        },
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-local-${Date.now()}`,
      responseFormat: "json",
      taskInput: { transcript: "AI is great", taxonomy: ["AI"] },
    });

    expect(result.provider).toBe("local");
    expect(result.modelName).toBe("llama3.1:8b");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://local-ollama.test/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject(
      {
        model: "llama3.1:8b",
        stream: false,
        format: "json",
      },
    );
  });

  it("throws when local Ollama is unavailable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-local-down-${Date.now()}`,
        responseFormat: "json",
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("throws when local Ollama returns an HTTP error whose body cannot be read", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => {
        throw new Error("body read failed");
      },
    } as unknown as Response) as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-local-http-${Date.now()}`,
        responseFormat: "json",
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/local_llm_status_404/);
  });

  it("aborts a hung local Ollama request after the configured timeout", async () => {
    process.env.LLM_TIMEOUT_MS = "1";
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `u-local-timeout-${Date.now()}`,
        responseFormat: "json",
        taskInput: { transcript: "x", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/aborted/);

    expect(fetchMock).toHaveBeenCalled();
  });

  it("records local provider usage as zero estimated USD", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: JSON.stringify({ topics: [] }) },
      }),
    } as unknown as Response) as typeof fetch;

    await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: `u-local-budget-${Date.now()}`,
      responseFormat: "json",
      taskInput: { transcript: "x", taxonomy: ["AI"] },
    });

    expect(llmBudget.snapshot().estimatedUsd).toBe(0);
  });

  it("sends a strict report schema to local Ollama for report generation tasks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            title: "Report",
            summary: "Summary",
            caveats: "Caveat",
            sections: [],
            evidence: [],
          }),
        },
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await runLlm({
      task: "topic_report",
      system: "s",
      userPrompt: `u-local-report-schema-${Date.now()}`,
      responseFormat: "json",
      taskInput: { creatorName: "Creator", topicName: "AI" },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.format).toMatchObject({
      type: "object",
      required: ["title", "summary", "caveats", "sections", "evidence"],
    });
    expect(body.format.properties.sections.items.required).toEqual([
      "heading",
      "bullets",
    ]);
    expect(
      body.format.properties.sections.items.properties.bullets,
    ).toMatchObject({
      minItems: 2,
      maxItems: 5,
    });
    expect(
      body.format.properties.sections.items.properties.bullets.items,
    ).toEqual({ type: "string" });
  });
});
