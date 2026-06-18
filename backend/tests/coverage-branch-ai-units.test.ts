/**
 * coverage-branch-ai-units.test.ts — branch-only coverage for the
 * deterministic, dependency-free corners of the AI / config layer.
 *
 * Every test here drives an *untaken branch arm* that line coverage
 * already counts as "hit" (the line ran) but branch coverage flags
 * (the other arm of a `??`, ternary, or `if`). No source is changed.
 *
 * Targets (file:line):
 * - ai/mockAiClient: 213 (empty-text neutral arm), 220 (mixed arm),
 * 266 (missing chunkText `?? ""`), 318/319 (mixed promotion),
 * 380/381 (missing publishedAt sort), 392 (abrupt_shift trend)
 * - ai/embeddingClient: 188/189 (`?? 0` on ragged vectors)
 * - ai/mlClassifierClient: 326/388 (`message` field present),
 * 472 (non-string field → undefined)
 * - ai/llmClient: 50 (`?? "mock"`), 61 (`?? ""`)
 * - ai/llmBudget: 249 (`?? 0` null text), 261 (numEnv `: fallback`)
 * - ai/embeddingClient (key): 45 (`?? ""` no-key fallback)
 * - services/stanceAnalysis: 20 (`?? "mock"` provider default)
 * - services/topicRelevance: 56/57 (threshold env arms),
 * 126 (`? 1 : 0` heuristic-fallback arms)
 * - config/env: re-evaluated `??` fallbacks via fresh module load (incl. num() 23)
 * - utils/logger: 17/49 (prod transport + LOG_LEVEL arms)
 */

import { describe, it, expect, vi, afterEach } from "vitest";

/*
 * Snapshot + restore the env keys these tests mutate so sibling suites
 * (jobs.test.ts is provider-sensitive) don't inherit drift.
 */
const MUTATED_ENV_KEYS = [
  "AI_PROVIDER",
  "AI_API_KEY",
  "EMBEDDING_PROVIDER",
  "ENABLE_MOCK_MODE",
  "STANCE_ANALYSIS_PROVIDER",
  "TOPIC_RELEVANCE_PROVIDER",
  "TOPIC_RELEVANCE_THRESHOLD",
  "TOPIC_ASSIGNMENT_PROVIDER",
  "LLM_DAILY_CALL_CAP",
  "LLM_DAILY_USD_CAP",
  "NODE_ENV",
  "LOG_LEVEL",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

/* Runs `fn` with the listed env keys reset to their pre-call values afterward. */
async function withRestoredEnv(fn: () => Promise<void> | void): Promise<void> {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of MUTATED_ENV_KEYS) snapshot[k] = process.env[k];
  try {
    await fn();
  } finally {
    for (const k of MUTATED_ENV_KEYS) {
      const v = snapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * mockAiClient
 * ---------------------------------------------------------------------------
 */

describe("mockAiClient — stance + summary + timeline branch arms", () => {
  it("stance_classification with no cues and missing chunkText hits the empty-tally arm", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * No taskInput at all → chunkText `?? ""` (line 266) right arm, and an
     * empty string yields zero stance cues → the total===0 ternary (line 213).
     */
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: `branch-empty-stance-${Date.now()}`,
    });
    const json = r.json as { stanceLabel: string };
    expect(["neutral", "insufficient_evidence"]).toContain(json.stanceLabel);
  });

  it("stance_classification covers both arms of the empty-text neutral/insufficient ternary", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * Different prompts reseed the deterministic float, so scanning a range
     * of zero-cue inputs guarantees both `rel > 0.7` arms (line 213) fire.
     */
    const labels = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const r = await runMockLlm({
        task: "stance_classification",
        system: "",
        userPrompt: `branch-zero-cue-${i}`,
        taskInput: { chunkText: "zzz qqq wxv", topicName: "AI" },
      });
      labels.add((r.json as { stanceLabel: string }).stanceLabel);
    }
    expect(labels.has("neutral")).toBe(true);
    expect(labels.has("insufficient_evidence")).toBe(true);
  });

  it("stance_classification recognises the mixed arm (mixed>0 AND supportive>0)", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: `branch-mixed-${Date.now()}`,
      taskInput: {
        chunkText:
          "I support this, however on the other hand I also worry it is harmful.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("mixed");
  });

  it("stance_classification mixed arm via the `opposed > 0` disjunct (no supportive cue)", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * mixed>0 but supportive===0 → the `supportive > 0 || opposed > 0` right
     * disjunct (line 220) decides; opposed cues keep it "mixed".
     */
    const r = await runMockLlm({
      task: "stance_classification",
      system: "",
      userPrompt: `branch-mixed-opposed-${Date.now()}`,
      taskInput: {
        chunkText:
          "On the other hand it is harmful and dangerous; I disagree and oppose this strongly.",
        topicName: "AI",
      },
    });
    expect((r.json as { stanceLabel: string }).stanceLabel).toBe("mixed");
  });

  it("video_topic_summary promotes to 'mixed' when runner-up stance ties the leader", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * Two supportive + two opposed (each >=0.4 relevance) → tally tie → the
     * sortedKeys.length>=2 promotion (lines 318/319) marks it mixed.
     */
    const r = await runMockLlm({
      task: "video_topic_summary",
      system: "",
      userPrompt: `branch-mixed-summary-${Date.now()}`,
      taskInput: {
        topicName: "AI",
        videoTitle: "v",
        chunkAnalyses: [
          {
            chunkIndex: 0,
            relevanceScore: 0.8,
            stanceLabel: "supportive",
            confidenceScore: 0.8,
            evidenceQuote: "q0",
          },
          {
            chunkIndex: 1,
            relevanceScore: 0.8,
            stanceLabel: "supportive",
            confidenceScore: 0.8,
            evidenceQuote: "q1",
          },
          {
            chunkIndex: 2,
            relevanceScore: 0.8,
            stanceLabel: "opposed",
            confidenceScore: 0.8,
            evidenceQuote: "q2",
          },
          {
            chunkIndex: 3,
            relevanceScore: 0.8,
            stanceLabel: "opposed",
            confidenceScore: 0.8,
            evidenceQuote: "q3",
          },
        ],
      },
    });
    expect((r.json as { dominantStance: string }).dominantStance).toBe("mixed");
  });

  it("creator_timeline sorts summaries with a MISSING publishedAt (date `? : 0` arm)", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * One summary omits publishedAt → both arms of the `a.publishedAt ? ... : 0`
     * sort comparator (lines 380/381) get exercised.
     */
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: `branch-timeline-nodates-${Date.now()}`,
      taskInput: {
        creatorName: "Creator",
        topicName: "AI",
        summaries: [
          { videoId: "v1", dominantStance: "supportive" },
          {
            videoId: "v2",
            publishedAt: "2026-02-01T00:00:00Z",
            dominantStance: "supportive",
          },
          { videoId: "v3", dominantStance: "opposed" },
        ],
      },
    });
    expect((r.json as { trendLabel: string }).trendLabel).toBeTruthy();
  });

  it("creator_timeline labels an abrupt_shift (supportive→opposed, line 392 left disjunct)", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: `branch-abrupt-${Date.now()}`,
      taskInput: {
        creatorName: "Creator",
        topicName: "AI",
        summaries: [
          {
            videoId: "v1",
            publishedAt: "2026-01-01T00:00:00Z",
            dominantStance: "supportive",
          },
          {
            videoId: "v2",
            publishedAt: "2026-02-01T00:00:00Z",
            dominantStance: "supportive",
          },
          {
            videoId: "v3",
            publishedAt: "2026-06-01T00:00:00Z",
            dominantStance: "opposed",
          },
          {
            videoId: "v4",
            publishedAt: "2026-07-01T00:00:00Z",
            dominantStance: "opposed",
          },
        ],
      },
    });
    expect((r.json as { trendLabel: string }).trendLabel).toBe("abrupt_shift");
  });

  it("creator_timeline labels an abrupt_shift (opposed→supportive, line 392 right disjunct)", async () => {
    const { runMockLlm } = await import("./helpers/mockAiClient");
    /*
     * The mirror of the previous case so the second `||` disjunct of line 392
     * (`firstTop === "opposed" && secondTop === "supportive"`) executes.
     */
    const r = await runMockLlm({
      task: "creator_timeline",
      system: "",
      userPrompt: `branch-abrupt-mirror-${Date.now()}`,
      taskInput: {
        creatorName: "Creator",
        topicName: "AI",
        summaries: [
          {
            videoId: "v1",
            publishedAt: "2026-01-01T00:00:00Z",
            dominantStance: "opposed",
          },
          {
            videoId: "v2",
            publishedAt: "2026-02-01T00:00:00Z",
            dominantStance: "opposed",
          },
          {
            videoId: "v3",
            publishedAt: "2026-06-01T00:00:00Z",
            dominantStance: "supportive",
          },
          {
            videoId: "v4",
            publishedAt: "2026-07-01T00:00:00Z",
            dominantStance: "supportive",
          },
        ],
      },
    });
    expect((r.json as { trendLabel: string }).trendLabel).toBe("abrupt_shift");
  });
});

/*
 * ---------------------------------------------------------------------------
 * embeddingClient.cosineSimilarity — ragged vectors hit the `?? 0` arms
 * ---------------------------------------------------------------------------
 */

describe("embeddingClient.cosineSimilarity — sparse-array `?? 0` arms", () => {
  it("treats holes in either vector as 0 without throwing", async () => {
    const { cosineSimilarity } = await import("../src/ai/embeddingClient");
    /*
     * Sparse arrays: index reads return `undefined` → the `vectorA[i] ?? 0`
     * and `vectorB[i] ?? 0` fallbacks (lines 188/189) fire.
     */
    const a: number[] = [1, 2, 3];
    const b: number[] = [1, 2, 3];
    // eslint-disable-next-line @typescript-eslint/no-array-delete
    delete a[1];
    // eslint-disable-next-line @typescript-eslint/no-array-delete
    delete b[2];
    const sim = cosineSimilarity(a, b);
    expect(Number.isFinite(sim)).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * mlClassifierClient — error-body field extraction arms
 * ---------------------------------------------------------------------------
 */

describe("mlClassifierClient — 4xx body field extraction branches", () => {
  it("predictStance uses the body `message` field when present (line 326 left arm)", async () => {
    const orig = global.fetch;
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "bad_input",
            message: "explicit stance message",
          }),
          {
            status: 400,
          },
        ),
    ) as unknown as typeof fetch;
    const { predictStance } = await import("../src/ai/mlClassifierClient");
    const r = await predictStance({ topic: "x", text: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("explicit stance message");
    global.fetch = orig;
  });

  it("predictTopicCandidates uses the body `message` field when present (line 388 left arm)", async () => {
    const orig = global.fetch;
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "bad_input",
            message: "explicit candidate message",
          }),
          {
            status: 400,
          },
        ),
    ) as unknown as typeof fetch;
    const { predictTopicCandidates } = await import(
      "../src/ai/mlClassifierClient"
    );
    const r = await predictTopicCandidates({ text: "some candidate text" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("explicit candidate message");
    global.fetch = orig;
  });

  it("predictTopicRelevance ignores a non-string `message`/`error` (extractStringField line 472 `: undefined`)", async () => {
    const orig = global.fetch;
    /*
     * `message` and `error` are NON-strings → extractStringField returns
     * undefined (line 472 `: undefined` arm); message falls back to HTTP code.
     */
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: 123, message: { nested: true } }),
          { status: 422 },
        ),
    ) as unknown as typeof fetch;
    const { predictTopicRelevance } = await import(
      "../src/ai/mlClassifierClient"
    );
    const r = await predictTopicRelevance({ topic: "x", text: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("HTTP 422");
    global.fetch = orig;
  });
});

/*
 * ---------------------------------------------------------------------------
 * llmClient — currentProvider / currentApiKey `??` defaults
 * ---------------------------------------------------------------------------
 */

describe("llmClient — provider/key default arms when env is unset", () => {
  it("defaults to the local provider when AI_PROVIDER and AI_API_KEY are absent", async () => {
    await withRestoredEnv(async () => {
      delete process.env.AI_PROVIDER; /* line 50 `?? "mock"` right arm */
      delete process.env.AI_API_KEY; /* line 61 `?? ""` right arm */
      const { runLlm } = await import("../src/ai/llmClient");
      const r = await runLlm({
        task: "topic_detection",
        system: "s",
        userPrompt: `branch-no-env-${Date.now()}`,
        bypassCache: true,
      });
      /* No provider + no key → mock path. */
      expect(r.provider).toBe("local");
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * stanceAnalysis — getProvider `?? "mock"` default arm
 * ---------------------------------------------------------------------------
 */

describe("stanceAnalysis — provider default when env unset", () => {
  it("classifies via the custom ML provider when STANCE_ANALYSIS_PROVIDER is absent", async () => {
    await withRestoredEnv(async () => {
      delete process.env
        .STANCE_ANALYSIS_PROVIDER; /* line 20 `?? "mock"` right arm */
      const { classifyChunkForTopic } = await import(
        "../src/services/stanceAnalysis.service"
      );
      const r = await classifyChunkForTopic({
        chunkText: "I support this and we should embrace it fully.",
        topicName: "AI",
      });
      expect(r.stanceLabel).toBeTruthy();
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * topicRelevance — threshold env arms + custom_ml score branches
 * ---------------------------------------------------------------------------
 */

describe("topicRelevance — threshold + custom_ml score branches", () => {
  /*
   * A taxonomy topic + text containing its alias passes the keyword heuristic
   * (so the default-assignment path doesn't short-circuit before the ML call).
   */
  const TAXO_TOPIC = { slug: "china_taiwan_conflict", name: "Defend Taiwan" };
  const TAXO_TEXT =
    "The panel debates whether the US should defend Taiwan if the china taiwan conflict escalates.";

  /* Returns a fetch stub yielding a valid /predict-topic-relevance success body. */
  function mlRelevanceFetch(
    predictedLabel: "relevant" | "irrelevant",
    relevant: number,
  ) {
    return vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            predictedLabel,
            confidence: predictedLabel === "relevant" ? relevant : 1 - relevant,
            labelScores: { relevant, irrelevant: 1 - relevant },
            modelVersion: "topic-relevance-test",
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
  }

  it("honors a numeric TOPIC_RELEVANCE_THRESHOLD env override (lines 56/57 finite arm)", async () => {
    await withRestoredEnv(async () => {
      const orig = global.fetch;
      process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
      process.env.TOPIC_RELEVANCE_THRESHOLD = "0.9";
      delete process.env.TOPIC_ASSIGNMENT_PROVIDER;
      global.fetch = mlRelevanceFetch(
        "relevant",
        0.7,
      ); /* 0.7 < 0.9 → rejected */
      const { scoreChunkRelevanceForTopic } = await import(
        "../src/services/topicRelevance.service"
      );
      const decision = await scoreChunkRelevanceForTopic({
        topic: TAXO_TOPIC,
        chunkText: TAXO_TEXT,
      });
      expect(decision.provider).toBe("custom_ml");
      expect(decision.relevant).toBe(false);
      global.fetch = orig;
    });
  });

  it("falls back to 0.6 when TOPIC_RELEVANCE_THRESHOLD is non-numeric (line 57 `: 0.6` arm)", async () => {
    await withRestoredEnv(async () => {
      const orig = global.fetch;
      process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
      process.env.TOPIC_RELEVANCE_THRESHOLD = "not-a-number";
      delete process.env.TOPIC_ASSIGNMENT_PROVIDER;
      global.fetch = mlRelevanceFetch(
        "relevant",
        0.8,
      ); /* 0.8 >= 0.6 default → relevant */
      const { scoreChunkRelevanceForTopic } = await import(
        "../src/services/topicRelevance.service"
      );
      const decision = await scoreChunkRelevanceForTopic({
        topic: TAXO_TOPIC,
        chunkText: TAXO_TEXT,
      });
      expect(decision.provider).toBe("custom_ml");
      expect(decision.relevant).toBe(true);
      global.fetch = orig;
    });
  });

  it("ML failure under custom_ml_reranker falls back to the heuristic verdict (both `? 1 : 0` arms)", async () => {
    await withRestoredEnv(async () => {
      const orig = global.fetch;
      process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
      process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
      /*
       * Persistent 5xx → predictTopicRelevance returns ok:false → line 126
       * `heuristicRelevant ? 1 : 0` fallback.
       */
      global.fetch = vi.fn(
        async () => new Response("{}", { status: 503 }),
      ) as unknown as typeof fetch;
      const { scoreChunkRelevanceForTopic } = await import(
        "../src/services/topicRelevance.service"
      );
      /* Non-taxonomy slug → heuristic defaults to `true` → `1` arm. */
      const relevant = await scoreChunkRelevanceForTopic({
        topic: { slug: "not-a-real-taxonomy-slug", name: "Brand New Topic" },
        chunkText:
          "Some unrelated chatter that the heuristic can only default-accept.",
      });
      expect(relevant.fallback).toBe(true);
      expect(relevant.relevanceScore).toBe(1);
      /* Taxonomy topic with text that never mentions it → heuristic `false` → `0` arm. */
      const irrelevant = await scoreChunkRelevanceForTopic({
        topic: TAXO_TOPIC,
        chunkText:
          "Completely unrelated rambling about backyard vegetable gardening tips.",
      });
      expect(irrelevant.fallback).toBe(true);
      expect(irrelevant.relevanceScore).toBe(0);
      global.fetch = orig;
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * config/env — `??` fallback arms via a fresh module evaluation
 * ---------------------------------------------------------------------------
 */

describe("config/env — fallback defaults when provider/url envs are unset", () => {
  /*
   * env.ts calls dotenv.config() at module load, which would repopulate the
   * very vars we clear (the .env file sets them). Stub dotenv to a no-op so a
   * fresh import reads only our mutated process.env and the `?? <default>`
   * right arms are actually reached.
   */
  const ENV_VARS = [
    "NODE_ENV",
    "DATABASE_URL",
    "FRONTEND_URL",
    "CORS_ORIGIN",
    "AI_PROVIDER",
    "EMBEDDING_PROVIDER",
    "YOUTUBE_PROVIDER",
    "PORT",
  ];

  /* Imports config/env with dotenv stubbed and `mutate` applied to process.env, restoring everything after. */
  async function importEnvWith(
    mutate: (env: NodeJS.ProcessEnv) => void,
  ): Promise<(typeof import("../src/config/env"))["env"]> {
    const restore: Record<string, string | undefined> = {};
    for (const k of ENV_VARS) restore[k] = process.env[k];
    vi.resetModules();
    vi.doMock("dotenv", () => ({
      default: { config: () => ({ parsed: {} }) },
    }));
    try {
      mutate(process.env);
      const mod = await import("../src/config/env");
      return mod.env;
    } finally {
      for (const k of ENV_VARS) {
        if (restore[k] === undefined) delete process.env[k];
        else process.env[k] = restore[k];
      }
      vi.doUnmock("dotenv");
      vi.resetModules();
    }
  }

  it("re-evaluates the env object with all optional vars unset", async () => {
    /* Resolved env config after clearing every optional var. */
    const env = await importEnvWith((p) => {
      for (const k of ENV_VARS) delete p[k];
    });
    /* All `?? <default>` right arms (lines 27/29/30/32/36/39) taken. */
    expect(env.nodeEnv).toBe("development");
    expect(env.databaseUrl).toBe("");
    expect(env.frontendUrl).toBe("http://localhost:5173");
    expect(env.aiProvider).toBe("local");
    expect(env.embeddingProvider).toBe("ml");
    expect(env.youtubeProvider).toBe("youtube");
  });

  it("prefers CORS_ORIGIN for frontendUrl when FRONTEND_URL is unset", async () => {
    /* Resolved env config with FRONTEND_URL absent but CORS_ORIGIN present. */
    const env = await importEnvWith((p) => {
      delete p.FRONTEND_URL; /* first `??` operand missing */
      p.CORS_ORIGIN =
        "https://cors.example"; /* second operand used (line 30) */
    });
    expect(env.frontendUrl).toBe("https://cors.example");
  });

  it("falls back to the default port when PORT is non-numeric (num() line 23 `: fallback`)", async () => {
    /* Resolved env config with a non-numeric PORT. */
    const env = await importEnvWith((p) => {
      p.PORT =
        "not-a-port"; /* Number("not-a-port") is NaN → `: fallback` arm */
    });
    expect(env.port).toBe(4000);
  });
});

/*
 * ---------------------------------------------------------------------------
 * llmBudget — estimateTokens null-text + numEnv non-numeric fallback
 * ---------------------------------------------------------------------------
 */

describe("llmBudget — small numeric-helper branch arms", () => {
  it("estimateTokens treats a null/undefined text as length 0 (line 249 `?? 0`)", async () => {
    const { estimateTokens } = await import("../src/ai/llmBudget");
    /* `(text?.length ?? 0)` right arm: optional chain short-circuits on undefined. */
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("numEnv ignores a non-numeric LLM_DAILY_CALL_CAP and uses the default (line 261 `: fallback`)", async () => {
    await withRestoredEnv(async () => {
      const { llmBudget } = await import("../src/ai/llmBudget");
      llmBudget.resetForTests?.();
      process.env.LLM_DAILY_CALL_CAP =
        "not-a-number"; /* truthy but Number()→NaN */
      process.env.LLM_DAILY_USD_CAP = "100";
      try {
        /*
         * limits() reads numEnv live; a NaN cap falls back to 5000, so a single
         * call is still allowed.
         */
        const decision = llmBudget.shouldAllowCall();
        expect(decision.allowed).toBe(true);
      } finally {
        delete process.env.LLM_DAILY_CALL_CAP;
        delete process.env.LLM_DAILY_USD_CAP;
        llmBudget.resetForTests?.();
      }
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * embeddingClient — getApiKey `?? ""` default arm
 * ---------------------------------------------------------------------------
 */

describe("embeddingClient — API key default arm (line 45)", () => {
  it("treats a missing AI_API_KEY as no-key and surfaces the provider error", async () => {
    await withRestoredEnv(async () => {
      const orig = process.env.EMBEDDING_PROVIDER;
      const origMock = process.env.ENABLE_MOCK_MODE;
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.ENABLE_MOCK_MODE = "false";
      delete process.env
        .AI_API_KEY; /* `process.env.AI_API_KEY ?? ""` right arm */
      try {
        const { embedText } = await import("../src/ai/embeddingClient");
        const promise = embedText("text without a configured key");
        /* No key → isMockEmbedding() true → deterministic mock embedder. */
        await expect(promise).rejects.toThrow("empty_vector");
      } finally {
        if (orig === undefined) delete process.env.EMBEDDING_PROVIDER;
        else process.env.EMBEDDING_PROVIDER = orig;
        if (origMock === undefined) delete process.env.ENABLE_MOCK_MODE;
        else process.env.ENABLE_MOCK_MODE = origMock;
      }
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * utils/logger — production transport + LOG_LEVEL arms via fresh load
 * ---------------------------------------------------------------------------
 */

describe("utils/logger — production configuration arm", () => {
  it("builds a JSON (transport=undefined) logger with an explicit LOG_LEVEL in prod", async () => {
    await withRestoredEnv(async () => {
      vi.resetModules();
      process.env.NODE_ENV =
        "production"; /* isProd true → line 49 transport `undefined` arm */
      process.env.LOG_LEVEL =
        "warn"; /* line 17 `??` left arm (explicit level) */
      try {
        const mod = await import("../src/utils/logger");
        expect(mod.logger).toBeDefined();
        /* Exercise every shim method (info/warn/error/debug) with + without meta. */
        mod.logger.info("prod info", { a: 1 });
        mod.logger.warn("prod warn");
        mod.logger.error("prod error", { b: 2 });
        mod.logger.debug("prod debug");
        expect(mod.pinoLogger.level).toBe("warn");
      } finally {
        vi.resetModules();
      }
    });
  });
});
