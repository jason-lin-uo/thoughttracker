import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "AI_API_KEY",
  "AI_PROVIDER",
  "ENABLE_MOCK_MODE",
  "TOPIC_ASSIGNMENT_PROVIDER",
  "TOPIC_RELEVANCE_PROVIDER",
  "TOPIC_RELEVANCE_THRESHOLD",
  "TOPIC_SELECTION_POLICY_PATH",
  "TOPIC_RERANKER_LABELS_PATH",
  "TOPIC_RERANKER_DISPLAY_TIERS",
  "TOPIC_RERANKER_LIMIT",
  "TOPIC_RERANKER_MIN_SCORE",
] as const;

let envSnapshot: Partial<
  Record<(typeof ENV_KEYS)[number], string | undefined>
> = {};
const originalCwd = process.cwd();

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("topicDetection.service provider switches", () => {
  it("uses the LLM topic detector path when no controlled taxonomy hit exists", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "test-key";
    process.env.ENABLE_MOCK_MODE = "false";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topics: [
                  {
                    name: "Quantum Computing",
                    slug: "quantum computing",
                    description: "A non-controlled test topic",
                    mentionCount: 2,
                    relevanceScore: 0.67,
                  },
                ],
              }),
            },
          },
        ],
      }),
    } as unknown as Response) as typeof fetch;

    const { detectTopicsForTranscript } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForTranscript(
      `This unusual ${Date.now()} passage is about qubits and error correction.`,
    );
    expect(topics).toEqual([
      expect.objectContaining({
        name: "Quantum Computing",
        slug: "quantum-computing",
        description: "A non-controlled test topic",
        mentionCount: 2,
        relevanceScore: 0.67,
      }),
    ]);
  });

  it("loads curated reranker labels and maps them back to the controlled taxonomy", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-curated-reranker-"));
    const labelsPath = path.join(dir, "labels.jsonl");
    fs.writeFileSync(
      labelsPath,
      [
        JSON.stringify({
          chunkId: "chunk-curated",
          decision: "keep_current",
          displayTier: "usable",
          selectedTopics: [
            {
              topicSlug: "ai_societal_impact",
              confidence: 0.88,
              evidenceQuote: "Artificial intelligence is the central subject.",
            },
          ],
        }),
        JSON.stringify({
          chunkId: "chunk-hidden",
          decision: "keep_current",
          displayTier: "hide",
          selectedTopics: [
            { topicSlug: "ai_model_competition", confidence: 0.8 },
          ],
        }),
      ].join("\n"),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RERANKER_LABELS_PATH = labelsPath;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const selected = await detectTopicsForChunk({
      chunkId: "chunk-curated",
      transcriptText: "This text is ignored because labels are curated.",
    });
    expect(selected).toEqual([
      expect.objectContaining({
        slug: "ai_societal_impact",
        name: "Artificial Intelligence",
        relevanceScore: 0.88,
        evidenceQuote: "Artificial intelligence is the central subject.",
      }),
    ]);

    const hidden = await detectTopicsForChunk({
      chunkId: "chunk-hidden",
      transcriptText: "This hidden row should not pass the display tier gate.",
    });
    expect(hidden).toEqual([]);
  });

  it("handles curated reranker missing/default files and noisy label rows", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RERANKER_LABELS_PATH = path.join(
      os.tmpdir(),
      `definitely-missing-${Date.now()}.jsonl`,
    );

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const defaultMissing = await detectTopicsForChunk({
      chunkId: "chunk-default-missing",
      transcriptText: "No controlled topic language appears here.",
    });
    expect(defaultMissing[0]).toEqual(
      expect.objectContaining({
        slug: "bitcoin-crypto-and-digital-assets",
        relevanceScore: 0.9,
      }),
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-curated-noisy-"));
    const labelsPath = path.join(dir, "labels.jsonl");
    fs.writeFileSync(
      labelsPath,
      [
        "",
        "{not valid json",
        JSON.stringify({ chunkId: " ", decision: "keep_current" }),
        JSON.stringify({
          chunkId: "chunk-empty-allowed",
          decision: "keep_current",
          displayTier: "private",
          selectedTopics: [
            {
              topicSlug: "ai_societal_impact",
              confidence: "not-a-number",
              evidenceQuote: " ",
            },
          ],
        }),
        JSON.stringify({
          chunkId: "chunk-no-topic",
          decision: "no_topic",
          displayTier: "showcase",
          selectedTopics: [
            { topicSlug: "ai_societal_impact", confidence: 0.9 },
          ],
        }),
        JSON.stringify({
          chunkId: "chunk-unknown-topic",
          decision: "keep_current",
          displayTier: "showcase",
          selectedTopics: [{ topicSlug: "not_in_taxonomy", confidence: 0.9 }],
        }),
        JSON.stringify({
          chunkId: "chunk-no-display-tier",
          decision: "keep_current",
          selectedTopics: [
            { topicSlug: "ai_societal_impact", confidence: 0.8 },
          ],
        }),
      ].join("\n"),
    );

    process.env.TOPIC_RERANKER_LABELS_PATH = labelsPath;
    process.env.TOPIC_RERANKER_DISPLAY_TIERS = ",,,";

    const selected = await detectTopicsForChunk({
      chunkId: "chunk-empty-allowed",
      transcriptText: "Ignored by curated labels.",
    });
    /*
     * The curated label's confidence is the non-numeric string "not-a-number".
     * `?? 0.95` does NOT apply (it isn't null/undefined), so Number(...) → NaN;
     * clamp01 now floors non-finite input to 0 (not 0.95), since a non-finite
     * value means "no usable signal" rather than "confident default".
     */
    expect(selected).toEqual([
      expect.objectContaining({
        slug: "ai_societal_impact",
        relevanceScore: 0,
      }),
    ]);

    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-no-topic",
        transcriptText: "ignored",
      }),
    ).resolves.toEqual([]);
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-unknown-topic",
        transcriptText: "ignored",
      }),
    ).resolves.toEqual([]);
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-no-display-tier",
        transcriptText: "ignored",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ slug: "ai_societal_impact" }),
    ]);
  });

  it("filters curated reranker rows by configured display tiers", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-curated-tier-filter-"),
    );
    const labelsPath = path.join(dir, "labels.jsonl");
    fs.writeFileSync(
      labelsPath,
      JSON.stringify({
        chunkId: "chunk-filtered",
        decision: "keep_current",
        displayTier: "hide",
        selectedTopics: [{ topicSlug: "ai_societal_impact", confidence: 0.9 }],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    process.env.TOPIC_RERANKER_LABELS_PATH = labelsPath;
    process.env.TOPIC_RERANKER_DISPLAY_TIERS = "showcase";

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const hidden = await detectTopicsForChunk({
      chunkId: "chunk-filtered",
      transcriptText: "Ignored by curated labels.",
    });
    expect(hidden).toEqual([]);
  });

  it("uses the custom ML reranker endpoint when requested", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          topics: [{ topicSlug: "ai_societal_impact", confidence: 0.91 }],
          modelVersion: "topic-reranker-test",
        }),
    } as unknown as Response) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-ml",
      transcriptText: "Artificial intelligence changes how work gets done.",
    });
    expect(topics[0]).toEqual(
      expect.objectContaining({
        slug: "ai_societal_impact",
        relevanceScore: 0.91,
      }),
    );
  });

  it("applies the final topic-selection policy over ML candidates and relevance scores", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.4,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0.15,
          minRelevanceMargin: 0,
        },
        topicThresholds: {
          ai_data_center_infrastructure: 0.9,
        },
        acceptedSuppressionRules: [
          {
            removeTopicSlug: "ai_model_competition",
            whenCoPredictedWith: "ai_societal_impact",
          },
        ],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [
              { topicSlug: "not_in_taxonomy", confidence: 0.99 },
              { topicSlug: "ai_societal_impact", confidence: 0.9 },
              { topicSlug: "ai_model_competition", confidence: 0.8 },
              { topicSlug: "ai_data_center_infrastructure", confidence: 0.7 },
              { topicSlug: "openai_company", confidence: 0.4 },
            ],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.7,
            labelScores: { relevant: 0.7, irrelevant: 0.3 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.75,
            labelScores: { relevant: 0.75, irrelevant: 0.25 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.85,
            labelScores: { relevant: 0.85, irrelevant: 0.15 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.6,
            labelScores: { relevant: 0.6, irrelevant: 0.4 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-final-policy",
      transcriptText:
        "Artificial intelligence, OpenAI, and model competition are all discussed.",
    });

    expect(topics.map((topic) => [topic.slug, topic.relevanceScore])).toEqual([
      ["ai_societal_impact", 0.7],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(
      expect.objectContaining({
        limit: 12,
        minScore: 0,
      }),
    );
  });

  it("uses relevance-only final-policy ranking when configured", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-relevance-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "relevance",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [
              { topicSlug: "ai_societal_impact", confidence: 0.5 },
              { topicSlug: "ai_model_competition", confidence: 0.5 },
            ],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.5,
            labelScores: { relevant: 0.5, irrelevant: 0.5 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-final-policy-relevance-rank",
      transcriptText:
        "Two equally scored AI topics should sort by slug after relevance ranking.",
    });

    expect(topics.map((topic) => topic.slug)).toEqual([
      "ai_model_competition",
      "ai_societal_impact",
    ]);
  });

  it("keeps a suppression target when it outranks the trigger topic", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-suppression-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [
          {
            removeTopicSlug: "ai_societal_impact",
            whenCoPredictedWith: "openai_company",
          },
        ],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [
              { topicSlug: "ai_societal_impact", confidence: 0.9 },
              { topicSlug: "openai_company", confidence: 0.4 },
            ],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.9,
            labelScores: { relevant: 0.9, irrelevant: 0.1 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.4,
            labelScores: { relevant: 0.4, irrelevant: 0.6 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-final-policy-stronger-suppression-target",
      transcriptText:
        "Artificial intelligence and OpenAI are both relevant here.",
    });

    expect(topics.map((topic) => topic.slug)).toEqual([
      "ai_societal_impact",
      "openai_company",
    ]);
  });

  it("suppresses an equal-scored final-policy topic when the rule matches", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-equal-suppress-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [
          {
            removeTopicSlug: "ai_model_competition",
            whenCoPredictedWith: "ai_societal_impact",
          },
        ],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [
              { topicSlug: "ai_model_competition", confidence: 0.8 },
              { topicSlug: "ai_societal_impact", confidence: 0.8 },
            ],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.75,
            labelScores: { relevant: 0.75, irrelevant: 0.25 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-final-policy-equal-suppression",
      transcriptText:
        "Artificial intelligence and model competition are equally scored here.",
    });

    expect(topics.map((topic) => topic.slug)).toEqual(["ai_societal_impact"]);
  });

  it("discovers the default final-policy artifact when no policy path override is set", async () => {
    /*
     * The default resolver looks for <repo-parent>/thoughttracker-ml/models/
     * topic-selection-policy-gold-standard/policy.json — an artifact that lives
     * in the sibling ML repo's gitignored models/ dir, absent in CI. Build a
     * temp sibling layout and chdir in so the default discovery finds a file.
     */
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-policy-default-"),
    );
    const backendDir = path.join(root, "thoughttracker", "backend");
    const policyPath = path.join(
      root,
      "thoughttracker-ml",
      "models",
      "topic-selection-policy-gold-standard",
      "policy.json",
    );
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [],
      }),
    );
    process.chdir(backendDir);

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    delete process.env.TOPIC_SELECTION_POLICY_PATH;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ topics: [], modelVersion: "topic-reranker-test" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-final-policy-default-path",
      transcriptText:
        "No selected topics are returned, but the default policy path is exercised.",
    });

    expect(topics).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails when no path is set and no final-policy artifact exists", async () => {
    /*
     * Fresh-clone case: no TOPIC_SELECTION_POLICY_PATH override AND no sibling
     * ML artifact on disk. chdir into an isolated temp dir whose parents have
     * no thoughttracker-ml/models/... policy so default discovery returns null
     * and the service must fall back to DEFAULT_TOPIC_SELECTION_POLICY (rather
     * than throwing). The candidate fetch is mocked to return one in-taxonomy
     * topic, scored above the default 0.5 threshold, so we can assert a result.
     */
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-policy-builtin-default-"),
    );
    const backendDir = path.join(root, "thoughttracker", "backend");
    fs.mkdirSync(backendDir, { recursive: true });
    process.chdir(backendDir);

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    delete process.env.TOPIC_SELECTION_POLICY_PATH;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [{ topicSlug: "ai_societal_impact", confidence: 0.9 }],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.8,
            labelScores: { relevant: 0.8, irrelevant: 0.2 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const promise = detectTopicsForChunk({
      chunkId: "chunk-final-policy-builtin-default",
      transcriptText:
        "Artificial intelligence is discussed without any policy artifact present.",
    });

    await expect(promise).rejects.toThrow(
      "Final topic-selection policy artifact is not available",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails explicitly when a configured final-policy artifact is malformed", async () => {
    /*
     * An explicitly-configured path that exists but contains invalid JSON is a
     * misconfiguration — the service must throw a clear "malformed" error rather
     * than leak a raw SyntaxError or silently swap in the default.
     */
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-policy-malformed-explicit-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(policyPath, "{ broken json :: ]");

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-final-policy-malformed-explicit",
        transcriptText: "Artificial intelligence appears in this passage.",
      }),
    ).rejects.toThrow("malformed");
  });

  it("fails when an auto-discovered final-policy artifact is malformed", async () => {
    /*
     * Fresh-clone variant: no explicit override, but the auto-discovered sibling
     * artifact is corrupt. The service must NOT crash — it logs and degrades to
     * DEFAULT_TOPIC_SELECTION_POLICY, same as when the artifact is absent.
     */
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-policy-malformed-default-"),
    );
    const backendDir = path.join(root, "thoughttracker", "backend");
    const policyPath = path.join(
      root,
      "thoughttracker-ml",
      "models",
      "topic-selection-policy-gold-standard",
      "policy.json",
    );
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, "{ not : valid json ]");
    process.chdir(backendDir);

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    delete process.env.TOPIC_SELECTION_POLICY_PATH;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [{ topicSlug: "ai_societal_impact", confidence: 0.9 }],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predictedLabel: "relevant",
            confidence: 0.8,
            labelScores: { relevant: 0.8, irrelevant: 0.2 },
            modelVersion: "topic-relevance-test",
          }),
      } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const promise = detectTopicsForChunk({
      chunkId: "chunk-final-policy-malformed-default",
      transcriptText:
        "Artificial intelligence is discussed with a corrupt policy artifact present.",
    });

    await expect(promise).rejects.toThrow("malformed");
  });

  it("reuses the cached final-policy file on repeated calls", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-cache-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ topics: [], modelVersion: "topic-reranker-test" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-final-policy-cache-a",
        transcriptText: "First call loads the policy.",
      }),
    ).resolves.toEqual([]);
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-final-policy-cache-b",
        transcriptText: "Second call should use the cached policy.",
      }),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails explicitly when the configured final-policy artifact is missing", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = path.join(
      os.tmpdir(),
      `missing-final-topic-policy-${Date.now()}.json`,
    );

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    await expect(
      detectTopicsForChunk({
        chunkId: "chunk-final-policy-missing-file",
        transcriptText:
          "Artificial intelligence and OpenAI are central here, but final policy is unavailable.",
      }),
    ).rejects.toThrow("Final topic-selection policy artifact is not available");
  });

  it("fails explicitly when the final-policy candidate endpoint is unavailable", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-candidate-fail-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    /*
     * The candidate endpoint (predictTopicCandidates) returns 5xx on every
     * retry, so the ML client yields { ok: false }. Per H11 the final-policy
     * tier now DEGRADES GRACEFULLY (returns null → dispatcher falls through to
     * the mock detector) instead of throwing and failing the whole video.
     */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({ error: "UNAVAILABLE", message: "candidate offline" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const promise = detectTopicsForChunk({
      chunkId: "chunk-final-policy-candidate-fails",
      transcriptText: "A generic passage with no local taxonomy anchor.",
    });
    /*
     * Falls through to the mock detector, which finds no controlled topics in
     * this generic text → empty result rather than a thrown error.
     */
    await expect(promise).rejects.toThrow(
      "final_policy_candidate_endpoint_unavailable",
    );
  });

  it("fails explicitly when final-policy relevance scoring fails", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tt-final-topic-policy-relevance-fail-"),
    );
    const policyPath = path.join(dir, "policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        candidateTopK: 12,
        baselinePolicy: {
          threshold: 0.1,
          maxSelected: 5,
          rankMode: "combined",
          minRerankerMargin: 0,
          minRelevanceMargin: 0,
        },
        topicThresholds: {},
        acceptedSuppressionRules: [],
      }),
    );

    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    process.env.TOPIC_SELECTION_POLICY_PATH = policyPath;
    process.env.TOPIC_RERANKER_MIN_SCORE = "0";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            topics: [{ topicSlug: "ai_societal_impact", confidence: 0.95 }],
            modelVersion: "topic-reranker-test",
          }),
      } as unknown as Response)
      .mockResolvedValue({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({
            error: "UNAVAILABLE",
            message: "relevance offline",
          }),
      } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    /*
     * H11: a relevance-endpoint outage mid-scoring now degrades gracefully
     * (null → fall through to the mock detector) instead of throwing.
     */
    const promise = detectTopicsForChunk({
      chunkId: "chunk-final-policy-relevance-fails",
      transcriptText: "A generic passage with no local taxonomy anchor.",
    });
    await expect(promise).rejects.toThrow(
      "final_policy_relevance_endpoint_unavailable",
    );
    /*
     * 1 candidate call (success) + the relevance call(s); the relevance failure
     * short-circuits, so the candidate endpoint is hit exactly once.
     */
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back when custom ML reranker fails", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/predict-topics")) {
        return new Response(
          JSON.stringify({
            error: "INVALID_INPUT",
            message: "bad candidate request",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              topics: [],
              relevanceScore: 0,
              stanceLabel: "neutral",
              confidenceScore: 0.8,
              confidenceLabel: "high",
              claimSummary: "No controlled topic matched.",
              rationale: "The local fixture intentionally returns no topics.",
              evidenceQuote: "",
              dominantStance: "neutral",
              mentionCount: 0,
              summary: "No topic summary.",
            }),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-ml-fallback",
      transcriptText:
        "A deliberately unrelated fragment with no taxonomy anchors.",
    });
    expect(topics).toEqual([]);
  });

  it("custom ML reranker ignores unknown slugs, clamps scores, and sorts", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    process.env.TOPIC_RERANKER_LIMIT = "not-a-number";
    process.env.TOPIC_RERANKER_MIN_SCORE = "not-a-number";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          topics: [
            { topicSlug: "not_in_taxonomy", confidence: 0.99 },
            { topicSlug: "ai_societal_impact", confidence: -0.2 },
            { topicSlug: "ai_model_competition", confidence: 1.7 },
          ],
          modelVersion: "topic-reranker-test",
        }),
    } as unknown as Response) as typeof fetch;

    const { detectTopicsForChunk } = await import(
      "../src/services/topicDetection.service"
    );
    const topics = await detectTopicsForChunk({
      chunkId: "chunk-ml-clamp",
      transcriptText: "Candidate response supplies all topic choices.",
    });
    expect(topics.map((topic) => [topic.slug, topic.relevanceScore])).toEqual([
      ["ai_model_competition", 1],
      ["ai_societal_impact", 0],
    ]);
  });

  it("covers topic relevance and evidence quote edge cases", async () => {
    const {
      detectTopicsForTranscript,
      extractTopicEvidenceQuote,
      isChunkRelevantToTopic,
    } = await import("../src/services/topicDetection.service");

    expect(
      isChunkRelevantToTopic(
        { slug: "not_in_taxonomy", name: "Not In Taxonomy" },
        "Any text is relevant for ad hoc topics.",
      ),
    ).toBe(true);

    expect(
      extractTopicEvidenceQuote(
        { slug: "ai_societal_impact", name: "Artificial Intelligence" },
        "This passage never names the topic.",
      ),
    ).toBeUndefined();

    const quote = extractTopicEvidenceQuote(
      { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      "Intro sentence. Artificial intelligence is named here. Another sentence follows? Final sentence!",
      120,
    );
    expect(quote).toContain("Artificial intelligence");

    const blockedAliasOnly = await detectTopicsForTranscript(
      "The blood brain phrase is present, but the blocked alias should not count as a useful cognitive health topic.",
    );
    expect(
      blockedAliasOnly.some(
        (topic) => topic.slug === "blood_brain_barrier_and_cognitive_health",
      ),
    ).toBe(false);
  });
});

describe("topicRelevance.service provider switches", () => {
  it("trusts curated reranker assignments as already relevant", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "curated_reranker";
    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText: "Even an unrelated chunk is trusted after curated selection.",
    });
    expect(result).toEqual({
      relevant: true,
      relevanceScore: 0,
      provider: "curated_reranker",
    });
  });

  it("trusts final-policy assignments as already relevant", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "final_policy";
    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText: "The final policy already selected this topic.",
    });
    expect(result).toEqual({
      relevant: true,
      relevanceScore: 0,
      provider: "final_policy",
    });
  });

  it("short-circuits irrelevant heuristic misses before custom ML by default", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "default";
    process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText: "This chunk discusses maple syrup and molasses instead.",
    });
    expect(result).toEqual({
      relevant: false,
      relevanceScore: 0,
      provider: "heuristic",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets custom_ml_reranker candidates be validated by the ML relevance endpoint", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
    process.env.TOPIC_RELEVANCE_THRESHOLD = "0.6";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          predictedLabel: "relevant",
          confidence: 0.82,
          labelScores: { relevant: 0.82, irrelevant: 0.18 },
          modelVersion: "topic-relevance-test",
        }),
    } as unknown as Response) as typeof fetch;

    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText:
        "Sparse text that still came from the reranker candidate list.",
    });
    expect(result).toEqual(
      expect.objectContaining({
        relevant: true,
        relevanceScore: 0.82,
        provider: "custom_ml",
        predictedLabel: "relevant",
      }),
    );
  });

  it("isChunkRelevantForTopic returns the scored decision boolean", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "default";
    const { isChunkRelevantForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    await expect(
      isChunkRelevantForTopic({
        topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
        chunkText:
          "Artificial intelligence and machine learning are central to the whole passage.",
      }),
    ).resolves.toBe(true);
  });

  it("falls back to the heuristic gate when custom ML relevance is unavailable", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "default";
    process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: "INVALID_INPUT",
          message: "bad relevance request",
        }),
    } as unknown as Response) as typeof fetch;

    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText:
        "Artificial intelligence and machine learning are central to the whole passage.",
    });
    expect(result).toEqual(
      expect.objectContaining({
        relevant: true,
        relevanceScore: 1,
        provider: "heuristic",
        fallback: true,
      }),
    );
  });

  it("clamps custom ML relevance scores before thresholding", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
    process.env.TOPIC_RELEVANCE_THRESHOLD = "0.6";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          predictedLabel: "relevant",
          confidence: 0.9,
          labelScores: { relevant: 1.7, irrelevant: -0.7 },
          modelVersion: "topic-relevance-test",
        }),
    } as unknown as Response) as typeof fetch;

    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText: "Sparse candidate text.",
    });
    expect(result.relevanceScore).toBe(1);
  });

  it("clamps custom ML relevance scores below zero", async () => {
    process.env.TOPIC_ASSIGNMENT_PROVIDER = "custom_ml_reranker";
    process.env.TOPIC_RELEVANCE_PROVIDER = "custom_ml";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        /*
         * confidence is a VALID probability (the client now rejects an
         * out-of-[0,1] confidence outright); the per-label SCORES may still be
         * raw/un-normalized (relevant: -0.7) and are clamped to [0,1] here.
         */
        JSON.stringify({
          predictedLabel: "irrelevant",
          confidence: 0.8,
          labelScores: { relevant: -0.7, irrelevant: 1.7 },
          modelVersion: "topic-relevance-test",
        }),
    } as unknown as Response) as typeof fetch;

    const { scoreChunkRelevanceForTopic } = await import(
      "../src/services/topicRelevance.service"
    );
    const result = await scoreChunkRelevanceForTopic({
      topic: { slug: "ai_societal_impact", name: "Artificial Intelligence" },
      chunkText: "Sparse candidate text.",
    });
    expect(result).toEqual(
      expect.objectContaining({
        relevant: false,
        relevanceScore: 0,
        provider: "custom_ml",
        predictedLabel: "irrelevant",
      }),
    );
  });
});
