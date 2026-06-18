import { beforeEach, vi } from "vitest";

/*
 * Test isolation: runtime .env may point at hosted providers for the actual
 * app, but the backend unit suite should remain credential-free and
 * deterministic unless an individual test explicitly opts into a provider.
 */
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "local";
process.env.AI_API_KEY = process.env.AI_API_KEY ?? "";
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "ml";
process.env.YOUTUBE_PROVIDER = process.env.YOUTUBE_PROVIDER ?? "youtube";
process.env.STANCE_ANALYSIS_PROVIDER =
  process.env.STANCE_ANALYSIS_PROVIDER ?? "custom_ml";
process.env.TOPIC_ASSIGNMENT_PROVIDER =
  process.env.TOPIC_ASSIGNMENT_PROVIDER ?? "default";
process.env.TOPIC_RELEVANCE_PROVIDER =
  process.env.TOPIC_RELEVANCE_PROVIDER ?? "heuristic";
delete process.env.ADMIN_ONBOARDING_PIN;
process.env.DEMO_MODE = "false";

const vector768 = Array.from({ length: 768 }, (_, index) => (index % 11) / 10);

const universalLlmJson = {
  topics: [
    {
      name: "Bitcoin Crypto and Digital Assets",
      slug: "bitcoin_crypto_and_digital_assets",
      description: "Test topic from the controlled taxonomy.",
      mentionCount: 1,
      relevanceScore: 0.9,
    },
  ],
  relevanceScore: 0.9,
  stanceLabel: "neutral",
  confidenceScore: 0.85,
  confidenceLabel: "high",
  claimSummary:
    "The transcript chunk contains enough context for a neutral test stance.",
  rationale: "The unit-test local LLM fixture returns a schema-valid response.",
  evidenceQuote: "test evidence",
  dominantStance: "neutral",
  mentionCount: 1,
  summary: "Schema-valid test summary.",
  notableEvidence: [{ chunkIndex: 0, quote: "test evidence" }],
  title: "AI Schema-Valid Test Report",
  caveats: "Generated from transcript data by the backend test HTTP fixture.",
  sections: [
    {
      heading: "Test Section",
      bullets: ["Schema-valid point one.", "Schema-valid point two."],
    },
  ],
  evidence: [
    {
      note: "A representative verbatim quote from this creator about the topic.",
      videoTitle: "Test Video",
    },
  ],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/*
 * Runtime code only supports real providers (`local`, `ml`, hosted APIs). Unit
 * tests stub those real HTTP boundaries so CI does not need Ollama/FastAPI
 * running, without reintroducing product-level mock provider modes.
 */
beforeEach(() => {
  process.env.AI_PROVIDER = "local";
  process.env.AI_API_KEY = process.env.AI_API_KEY ?? "";
  process.env.EMBEDDING_PROVIDER = "ml";
  process.env.YOUTUBE_PROVIDER = "youtube";
  process.env.STANCE_ANALYSIS_PROVIDER = "custom_ml";
  process.env.TOPIC_ASSIGNMENT_PROVIDER = "default";
  process.env.TOPIC_RELEVANCE_PROVIDER = "heuristic";
  delete process.env.ADMIN_ONBOARDING_PIN;
  process.env.DEMO_MODE = "false";

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("127.0.0.1:1")) {
      throw new Error("ECONNREFUSED");
    }

    if (url.endsWith("/api/chat")) {
      return jsonResponse({
        message: { content: JSON.stringify(universalLlmJson) },
      });
    }

    if (url.endsWith("/embed")) {
      return jsonResponse({
        vectors: [vector768],
        dim: 768,
        modelVersion: "test-ml-embed",
      });
    }

    if (url.endsWith("/predict")) {
      return jsonResponse({
        predictedLabel: "neutral",
        confidence: 0.85,
        labelScores: {
          supportive: 0.05,
          opposed: 0.05,
          neutral: 0.85,
          mixed: 0.03,
          unclear: 0.02,
        },
        modelVersion: "test-ml-stance",
      });
    }

    if (url.endsWith("/predict-topic-relevance")) {
      return jsonResponse({
        predictedLabel: "relevant",
        confidence: 0.9,
        labelScores: { relevant: 0.9, irrelevant: 0.1 },
        modelVersion: "test-ml-relevance",
      });
    }

    if (url.endsWith("/predict-topics")) {
      return jsonResponse({
        topics: [
          { topicSlug: "bitcoin_crypto_and_digital_assets", confidence: 0.9 },
        ],
        modelVersion: "test-ml-topic-reranker",
      });
    }

    if (url.endsWith("/health")) {
      return jsonResponse({
        status: "ok",
        modelLoaded: true,
        modelVersion: "test-ml",
      });
    }

    return jsonResponse({ ok: true });
  }) as typeof fetch;
});
