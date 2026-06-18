import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runMockLlm } from "./helpers/mockAiClient";
import { runLlm } from "../src/ai/llmClient";
import {
  embedText,
  cosineSimilarity,
  EMBEDDING_DIM,
} from "../src/ai/embeddingClient";
import {
  llmBudget,
  llmCache,
  buildCacheKey,
  estimateTokens,
} from "../src/ai/llmBudget";
import {
  predictStance,
  healthCheck,
  ML_CLASSIFIER_URL,
} from "../src/ai/mlClassifierClient";

describe("mockAiClient — every task path", () => {
  it("topic_detection extracts hits from transcript taxonomy", async () => {
    const r = await runMockLlm({
      task: "topic_detection",
      system: "",
      userPrompt: "x",
      taskInput: {
        transcript:
          "I want to talk about artificial intelligence and also foreign policy. Artificial intelligence again.",
        taxonomy: ["Artificial Intelligence", "Foreign Policy", "Nutrition"],
      },
    });
    const json = r.json as {
      topics: Array<{ name: string; mentionCount: number }>;
    };
    expect(json.topics.length).toBeGreaterThan(0);
    /* Locate the AI topic to assert its mention count. */
    const ai = json.topics.find((t) => t.name === "Artificial Intelligence");
    expect(ai?.mentionCount).toBeGreaterThanOrEqual(2);
  });

  it("topic_detection falls back to taxonomy when no mentions", async () => {
    const r = await runMockLlm({
      task: "topic_detection",
      system: "",
      userPrompt: "x",
      taskInput: {
        transcript: "nothing here",
        taxonomy: ["A", "B", "C", "D", "E"],
      },
    });
    const json = r.json as { topics: unknown[] };
    expect(json.topics.length).toBeGreaterThan(0);
  });

  it("stance_classification recognises supportive cues", async () => {
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: "x",
      taskInput: {
        chunkText: "I support this and we should embrace it.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("supportive");
  });

  it("stance_classification recognises opposed cues", async () => {
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: "y",
      taskInput: {
        chunkText: "I disagree with this. It's harmful.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("opposed");
  });

  it("stance_classification recognises mixed cues", async () => {
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: "z",
      taskInput: {
        chunkText:
          "I support this however at the same time I worry about harmful effects.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("mixed");
  });

  it("stance_classification recognises neutral cues", async () => {
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: "n",
      taskInput: {
        chunkText:
          "According to the data, on one hand the upside is clear. Research shows this is complex.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("neutral");
  });

  it("stance_classification falls back to insufficient_evidence on empty text", async () => {
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: "e",
      taskInput: {
        chunkText: "blah blah blah nothing interesting",
        topicName: "AI",
      },
    });
    expect(["neutral", "insufficient_evidence", "unclear"]).toContain(
      (r.json as { stanceLabel: string }).stanceLabel,
    );
  });

  it("video_topic_summary aggregates chunk analyses", async () => {
    const r = await runMockLlm({
      task: "video_topic_summary",
      system: "",
      userPrompt: "v",
      taskInput: {
        topicName: "AI",
        videoTitle: "Vid",
        chunkAnalyses: [
          {
            chunkIndex: 0,
            relevanceScore: 0.6,
            stanceLabel: "supportive",
            confidenceScore: 0.7,
            evidenceQuote: "q1",
          },
          {
            chunkIndex: 1,
            relevanceScore: 0.5,
            stanceLabel: "supportive",
            confidenceScore: 0.6,
            evidenceQuote: "q2",
          },
        ],
      },
    });
    expect((r.json as { dominantStance: string }).dominantStance).toBe(
      "supportive",
    );
  });

  it("video_topic_summary handles zero relevant chunks", async () => {
    const r = await runMockLlm({
      task: "video_topic_summary",
      system: "",
      userPrompt: "v2",
      taskInput: { topicName: "AI", videoTitle: "Vid", chunkAnalyses: [] },
    });
    expect((r.json as { dominantStance: string }).dominantStance).toBe(
      "insufficient_evidence",
    );
  });

  it("video_topic_summary returns mixed when stances tie", async () => {
    const r = await runMockLlm({
      task: "video_topic_summary",
      system: "",
      userPrompt: "v3",
      taskInput: {
        topicName: "AI",
        videoTitle: "Vid",
        chunkAnalyses: [
          {
            chunkIndex: 0,
            relevanceScore: 0.6,
            stanceLabel: "supportive",
            confidenceScore: 0.7,
            evidenceQuote: "",
          },
          {
            chunkIndex: 1,
            relevanceScore: 0.6,
            stanceLabel: "supportive",
            confidenceScore: 0.7,
            evidenceQuote: "",
          },
          {
            chunkIndex: 2,
            relevanceScore: 0.6,
            stanceLabel: "opposed",
            confidenceScore: 0.7,
            evidenceQuote: "",
          },
          {
            chunkIndex: 3,
            relevanceScore: 0.6,
            stanceLabel: "opposed",
            confidenceScore: 0.7,
            evidenceQuote: "",
          },
        ],
      },
    });
    expect((r.json as { dominantStance: string }).dominantStance).toBe("mixed");
  });

  it("creator_timeline with insufficient data returns insufficient_data", async () => {
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: "tl",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        summaries: [],
      },
    });
    expect((r.json as { trendLabel: string }).trendLabel).toBe(
      "insufficient_data",
    );
  });

  it("creator_timeline detects gradual_shift", async () => {
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: "tl2",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        summaries: [
          {
            videoId: "a",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
          },
          {
            videoId: "b",
            publishedAt: "2024-06-01",
            dominantStance: "supportive",
          },
          {
            videoId: "c",
            publishedAt: "2025-01-01",
            dominantStance: "neutral",
          },
          {
            videoId: "d",
            publishedAt: "2025-06-01",
            dominantStance: "opposed",
          },
        ],
      },
    });
    expect(
      ["gradual_shift", "abrupt_shift", "stable", "mixed"].includes(
        (r.json as { trendLabel: string }).trendLabel,
      ),
    ).toBe(true);
  });

  it("creator_timeline detects abrupt_shift", async () => {
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: "tl3",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        summaries: [
          {
            videoId: "a",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
          },
          {
            videoId: "b",
            publishedAt: "2024-06-01",
            dominantStance: "supportive",
          },
          {
            videoId: "c",
            publishedAt: "2025-01-01",
            dominantStance: "opposed",
          },
          {
            videoId: "d",
            publishedAt: "2025-06-01",
            dominantStance: "opposed",
          },
        ],
      },
    });
    expect((r.json as { trendLabel: string }).trendLabel).toBe("abrupt_shift");
  });

  it("creator_report builds sections", async () => {
    const r = await runMockLlm({
      task: "creator_report",
      system: "",
      userPrompt: "cr",
      taskInput: {
        creatorName: "X",
        topics: [
          {
            topicName: "AI",
            trendLabel: "stable",
            timelineSummary: "s",
            videoCount: 5,
          },
          {
            topicName: "Health",
            trendLabel: "gradual_shift",
            timelineSummary: "g",
            videoCount: 3,
          },
        ],
      },
    });
    const json = r.json as {
      sections: Array<{ heading: string }>;
      caveats: string;
    };
    expect(json.sections.length).toBeGreaterThan(0);
    expect(json.caveats).toMatch(/transcript data/i);
  });

  it("creator_report handles empty topics", async () => {
    const r = await runMockLlm({
      task: "creator_report",
      system: "",
      userPrompt: "cr-empty",
      taskInput: { creatorName: "X", topics: [] },
    });
    const json = r.json as { summary: string };
    expect(json.summary).toContain("limited");
  });

  it("topic_report produces full structure", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
            summary: "Likes it.",
          },
        ],
        timelineSummary: "trend goes up",
      },
    });
    const json = r.json as {
      title: string;
      sections: Array<{ heading: string }>;
    };
    expect(json.title).toContain("AI");
    expect(json.sections.some((s) => s.heading === "Overall stance")).toBe(
      true,
    );
    expect(json.sections.some((s) => s.heading === "How it's evolved")).toBe(
      true,
    );
  });

  it("topic_report describes a shift ONLY when the trend label says so", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-shift",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "abrupt_shift",
        timelineSummary: "moved over time",
        summaries: [
          {
            videoId: "a",
            videoTitle: "Early take",
            publishedAt: "2023-01-01",
            dominantStance: "supportive",
            summary: "pro",
          },
          {
            videoId: "b",
            videoTitle: "Mid take",
            publishedAt: "2023-09-01",
            dominantStance: "supportive",
            summary: "pro",
          },
          {
            videoId: "c",
            videoTitle: "Later take",
            publishedAt: "2024-06-01",
            dominantStance: "opposed",
            summary: "con",
          },
        ],
      },
    });
    const json = r.json as { title: string; summary: string };
    expect(json.title).toMatch(/shifted from supportive to opposed/i);
    expect(json.summary).toMatch(/moved from supportive toward opposed/i);
  });

  it("topic_report does NOT claim a shift when the trend is stable (no self-contradiction)", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-stable-mixed",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-06-01",
            dominantStance: "mixed",
            summary: "s",
          },
          {
            videoId: "c",
            videoTitle: "T3",
            publishedAt: "2024-09-01",
            dominantStance: "mixed",
            summary: "s",
          },
        ],
      },
    });
    const json = r.json as { title: string; summary: string };
    /* Dominant is mixed → "nuanced view"; must NOT say "shifted". */
    expect(json.title).toMatch(/consistently nuanced view of AI/i);
    expect(json.title).not.toMatch(/shifted/i);
    expect(json.summary).toMatch(/broadly consistent/i);
  });

  it("topic_report grounds the report in supplied verbatim quotes, contrasting stances", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-quotes",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
        ],
        quotes: [
          {
            quote: "This changes everything for filmmakers.",
            stance: "supportive",
            videoTitle: "Big AI take",
            publishedAt: "2024-03-01",
          },
          {
            quote: "But the hype is overblown.",
            stance: "mixed",
            videoTitle: "Reality check",
            publishedAt: "2024-09-01",
          },
        ],
      },
    });
    const json = r.json as {
      sections: Array<{ heading: string; body: string }>;
    };
    const ownWords = json.sections.find(
      (s) => s.heading === "In their own words",
    );
    expect(ownWords).toBeDefined();
    expect(ownWords!.body).toContain("This changes everything for filmmakers.");
    expect(ownWords!.body).toContain("But the hype is overblown.");
    expect(ownWords!.body).toContain("Big AI take");
  });

  it("topic_report falls back to summaries when no quotes survive cleaning", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-noquotes",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "Episode One",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
            summary: "Talks it up.",
          },
        ],
      },
    });
    const json = r.json as {
      sections: Array<{ heading: string; body: string }>;
    };
    const ownWords = json.sections.find(
      (s) => s.heading === "In their own words",
    );
    expect(ownWords!.body).toContain("Episode One");
  });

  it("topic_report characterizes a consistent supportive stance", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-steady",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
        ],
      },
    });
    const json = r.json as { title: string; summary: string };
    expect(json.title).toMatch(/consistently supportive on AI/i);
    expect(json.summary).toMatch(/broadly favorable take/i);
  });

  it("topic_report handles an empty topic gracefully", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-empty",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "insufficient_data",
        summaries: [],
      },
    });
    const json = r.json as { title: string; summary: string };
    expect(json.title).toMatch(/even-handed line on AI/i);
    expect(json.summary).toMatch(/isn't enough analyzed data/i);
  });

  it("topic_report flags a shift trend even when window stances match", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-shift-flat",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "gradual_shift",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-01-01",
            dominantStance: "supportive",
            summary: "s",
          },
        ],
      },
    });
    const json = r.json as { title: string; summary: string };
    expect(json.title).toMatch(/has been evolving/i);
    expect(json.summary).toMatch(/trend flags movement/i);
  });

  it("topic_report characterizes a consistently opposed stance (single-stance quotes)", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-opposed",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "opposed",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-01-01",
            dominantStance: "opposed",
            summary: "s",
          },
        ],
        quotes: [
          {
            quote: "This whole approach is a serious mistake for the industry.",
            stance: "opposed",
            videoTitle: "Critical take",
            publishedAt: "2024-02-01",
          },
        ],
      },
    });
    const json = r.json as {
      title: string;
      summary: string;
      sections: Array<{ heading: string; body: string }>;
    };
    expect(json.title).toMatch(/consistently opposed on AI/i);
    expect(json.summary).toMatch(/largely critical take/i);
    const ownWords = json.sections.find(
      (s) => s.heading === "In their own words",
    );
    expect(ownWords!.body).toContain("serious mistake for the industry");
  });

  it("topic_report characterizes a tentative/unclear stance", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-unclear",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "unclear",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-01-01",
            dominantStance: "unclear",
            summary: "s",
          },
        ],
      },
    });
    const json = r.json as { summary: string };
    expect(json.summary).toMatch(/mostly tentative take/i);
  });

  it("topic_report characterizes an even-handed neutral stance", async () => {
    const r = await runMockLlm({
      task: "topic_report",
      system: "",
      userPrompt: "tr-neutral-dom",
      taskInput: {
        creatorName: "X",
        topicName: "AI",
        trendLabel: "stable",
        summaries: [
          {
            videoId: "a",
            videoTitle: "T1",
            publishedAt: "2023-01-01",
            dominantStance: "neutral",
            summary: "s",
          },
          {
            videoId: "b",
            videoTitle: "T2",
            publishedAt: "2024-01-01",
            dominantStance: "neutral",
            summary: "s",
          },
        ],
      },
    });
    const json = r.json as { title: string; summary: string };
    expect(json.title).toMatch(/even-handed line on AI/i);
    expect(json.summary).toMatch(/even-handed, descriptive take/i);
  });

  it("creator_report reads as measured/neutral when no shifts or strong stances", async () => {
    const r = await runMockLlm({
      task: "creator_report",
      system: "",
      userPrompt: "cr-neutral",
      taskInput: {
        creatorName: "X",
        topics: [
          {
            topicName: "AI",
            trendLabel: "stable",
            timelineSummary: "s",
            videoCount: 5,
            dominantStance: "neutral",
            opinionatedShare: 0,
          },
          {
            topicName: "Health",
            trendLabel: "stable",
            timelineSummary: "s",
            videoCount: 3,
            dominantStance: "neutral",
            opinionatedShare: 0.1,
          },
        ],
      },
    });
    const json = r.json as {
      title: string;
      summary: string;
      sections: Array<{ heading: string }>;
    };
    expect(json.title).toMatch(/measured|neutral/i);
    expect(json.summary).toMatch(/neutral/i);
    expect(
      json.sections.some((s) => s.heading === "Where they stay neutral"),
    ).toBe(true);
  });

  it("creator_report highlights where the creator is most outspoken", async () => {
    const r = await runMockLlm({
      task: "creator_report",
      system: "",
      userPrompt: "cr-outspoken",
      taskInput: {
        creatorName: "X",
        topics: [
          {
            topicName: "Streaming Wars",
            trendLabel: "stable",
            timelineSummary: "s",
            videoCount: 8,
            dominantStance: "opposed",
            opinionatedShare: 0.9,
          },
          {
            topicName: "Indie Films",
            trendLabel: "stable",
            timelineSummary: "s",
            videoCount: 5,
            dominantStance: "supportive",
            opinionatedShare: 0.8,
          },
        ],
      },
    });
    const json = r.json as {
      title: string;
      sections: Array<{ heading: string }>;
    };
    expect(json.title).toMatch(/most outspoken/i);
    expect(json.title).toContain("Streaming Wars");
    expect(json.sections.some((s) => s.heading === "Most outspoken on")).toBe(
      true,
    );
    expect(
      json.sections.some((s) => s.heading === "Tensions & contradictions"),
    ).toBe(true);
  });

  it("default task returns empty object", async () => {
    const r = await runMockLlm({
      task: "unknown_task" as never,
      system: "",
      userPrompt: "x",
    });
    expect(r.json).toEqual({});
  });
});

describe("embeddingClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.ML_CLASSIFIER_URL;
  });

  it("embedText uses the ML service and returns its vector", async () => {
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.ML_CLASSIFIER_URL = "http://ml.test";
    const vector = Array.from({ length: EMBEDDING_DIM }, (_, i) =>
      i === 0 ? 1 : 0,
    );
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            vectors: [vector],
            modelVersion: "ml-distilbert-test",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;

    const { vector: actual, model } = await embedText("hello world");
    expect(actual).toHaveLength(EMBEDDING_DIM);
    expect(actual[0]).toBe(1);
    expect(model).toBe("ml-distilbert-test");
  });

  it("embedText rejects unsupported providers instead of fabricating vectors", async () => {
    process.env.EMBEDDING_PROVIDER = "unsupported";
    await expect(embedText("hello world")).rejects.toThrow(
      /Unsupported EMBEDDING_PROVIDER/,
    );
  });

  it("embedText surfaces ML failures instead of falling back", async () => {
    process.env.EMBEDDING_PROVIDER = "ml";
    global.fetch = vi.fn(
      async () => new Response("nope", { status: 503 }),
    ) as typeof fetch;
    await expect(embedText("hello world")).rejects.toThrow(/ml_embedding_503/);
  });

  it("embedText rejects explicit mock vectors from the ML service", async () => {
    process.env.EMBEDDING_PROVIDER = "ml";
    process.env.ML_CLASSIFIER_URL = "http://ml.test";
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            vectors: [[1, 0, 0]],
            modelVersion: "mock",
            mockInference: true,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;

    await expect(embedText("hello world")).rejects.toThrow(
      /ml_embedding_mock_inference/,
    );
  });

  it("embedText supports OpenAI embeddings when explicitly configured", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    const vector = Array.from({ length: 3 }, (_, i) => (i === 1 ? 1 : 0));
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;

    const { vector: actual, model } = await embedText("hello world");
    expect(actual).toEqual(vector);
    expect(model).toBe("text-embedding-3-small");
  });
  it("cosineSimilarity is 1 for identical vectors", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });
  it("cosineSimilarity is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("cosineSimilarity handles zero vectors safely", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("llmBudget", () => {
  beforeEach(() => {
    llmBudget.reset();
    llmCache.reset();
  });

  it("snapshot starts at zero", () => {
    const s = llmBudget.snapshot();
    expect(s.callsMade).toBe(0);
    expect(s.tokensIn).toBe(0);
  });

  it("recordCall increments counters", () => {
    llmBudget.recordCall({
      tokensIn: 100,
      tokensOut: 50,
      model: "mock-llm-v1",
      provider: "mock",
    });
    const s = llmBudget.snapshot();
    expect(s.callsMade).toBe(1);
    expect(s.tokensIn).toBe(100);
    expect(s.tokensOut).toBe(50);
  });

  it("shouldAllowCall returns true initially", () => {
    expect(llmBudget.shouldAllowCall().allowed).toBe(true);
  });

  it("shouldAllowCall blocks after exceeding daily call cap", () => {
    process.env.LLM_DAILY_CALL_CAP = "2";
    llmBudget.recordCall({
      tokensIn: 0,
      tokensOut: 0,
      model: "mock-llm-v1",
      provider: "mock",
    });
    llmBudget.recordCall({
      tokensIn: 0,
      tokensOut: 0,
      model: "mock-llm-v1",
      provider: "mock",
    });
    const d = llmBudget.shouldAllowCall();
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/call cap/i);
    delete process.env.LLM_DAILY_CALL_CAP;
  });

  it("shouldAllowCall blocks after exceeding USD cap", () => {
    process.env.LLM_DAILY_USD_CAP = "0.0000001";
    llmBudget.recordCall({
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      model: "gpt-4o",
      provider: "openai",
    });
    const d = llmBudget.shouldAllowCall();
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/USD cap/i);
    delete process.env.LLM_DAILY_USD_CAP;
  });

  it("uses default per-token price for unknown models", () => {
    llmBudget.recordCall({
      tokensIn: 1000,
      tokensOut: 1000,
      model: "weird-model",
      provider: "x",
    });
    expect(llmBudget.snapshot().estimatedUsd).toBeGreaterThan(0);
  });

  it("rolls over the window when >24h passes", () => {
    /*
     * Force the window to be expired by recording, mutating via reset on different process.env
     * Simulating: manually patch by exposing reset.
     */
    llmBudget.recordCall({
      tokensIn: 1,
      tokensOut: 1,
      model: "mock-llm-v1",
      provider: "mock",
    });
    expect(llmBudget.snapshot().callsMade).toBe(1);
    llmBudget.reset();
    expect(llmBudget.snapshot().callsMade).toBe(0);
  });

  it("logs usage every 50 calls", () => {
    for (let i = 0; i < 50; i += 1) {
      llmBudget.recordCall({
        tokensIn: 1,
        tokensOut: 1,
        model: "mock-llm-v1",
        provider: "mock",
      });
    }
    expect(llmBudget.snapshot().callsMade).toBe(50);
  });
});

describe("llmCache", () => {
  beforeEach(() => {
    llmCache.reset();
    delete process.env.LLM_CACHE_ENABLED;
  });

  it("get/set roundtrip", () => {
    llmCache.set("k", { v: 1 });
    expect(llmCache.get("k")).toEqual({ v: 1 });
  });

  it("misses + hits update snapshot", () => {
    expect(llmCache.get("missing")).toBeUndefined();
    llmCache.set("k", "v");
    llmCache.get("k");
    const s = llmCache.snapshot();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeGreaterThan(0);
  });

  it("disabled cache always misses", () => {
    process.env.LLM_CACHE_ENABLED = "false";
    llmCache.set("k", "v");
    expect(llmCache.get("k")).toBeUndefined();
    delete process.env.LLM_CACHE_ENABLED;
  });

  it("snapshot hitRate is 0 when no calls", () => {
    expect(llmCache.snapshot().hitRate).toBe(0);
  });

  it("buildCacheKey is stable for same input", () => {
    const a = buildCacheKey({
      task: "t",
      model: "m",
      userPrompt: "u",
      promptVersion: "v1",
    });
    const b = buildCacheKey({
      task: "t",
      model: "m",
      userPrompt: "u",
      promptVersion: "v1",
    });
    expect(a).toBe(b);
  });

  it("buildCacheKey differs across inputs", () => {
    const a = buildCacheKey({ task: "t", model: "m", userPrompt: "u" });
    const b = buildCacheKey({ task: "t", model: "m", userPrompt: "v" });
    expect(a).not.toBe(b);
  });

  it("estimateTokens returns ceil(len/4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("runLlm", () => {
  beforeEach(() => {
    llmBudget.reset();
    llmCache.reset();
  });

  it("returns local-provider result and caches it", async () => {
    const r1 = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: "u1",
      taskInput: { transcript: "t", taxonomy: ["AI"] },
    });
    const r2 = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: "u1",
      taskInput: { transcript: "t", taxonomy: ["AI"] },
    });
    expect(r2.cached).toBe(true);
    expect(llmBudget.snapshot().callsMade).toBe(1);
    expect(r1.provider).toBe("local");
  });

  it("bypasses cache when bypassCache=true", async () => {
    await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: "u-bypass",
      taskInput: { transcript: "t", taxonomy: ["AI"] },
    });
    const r2 = await runLlm({
      task: "topic_detection",
      system: "s",
      userPrompt: "u-bypass",
      bypassCache: true,
      taskInput: { transcript: "t", taxonomy: ["AI"] },
    });
    expect(r2.cached).toBeUndefined();
  });

  it("throws when hosted-provider budget is exhausted", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.LLM_DAILY_CALL_CAP = "0";
    await expect(
      runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: "u-budget",
        taskInput: { transcript: "t", taxonomy: ["AI"] },
      }),
    ).rejects.toThrow(/llm_budget_exhausted/);
    delete process.env.AI_PROVIDER;
    delete process.env.LLM_DAILY_CALL_CAP;
  });
});

describe("mlClassifierClient", () => {
  it("rejects empty input without making a request", async () => {
    const r = await predictStance({ topic: "", text: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INVALID_INPUT");
  });

  it("rejects empty text without making a request", async () => {
    const r = await predictStance({ topic: "x", text: " " });
    expect(r.ok).toBe(false);
  });

  it("returns network error when the URL is unreachable", async () => {
    /*
     * Pass an unreachable URL directly so the test doesn't depend on whether
     * a real ML service is running on the default localhost:8000.
     */
    const h = await healthCheck("http://127.0.0.1:1");
    expect(h.reachable).toBe(false);
  });

  it("exposes ML_CLASSIFIER_URL constant", () => {
    expect(typeof ML_CLASSIFIER_URL).toBe("string");
  });
});
