import { logger } from "../utils/logger";

/**
 * embeddingClient turns text into dense vectors for owner/offline analysis
 * workflows.
 *
 * Production/dev supports two real providers:
 * - `ml`: local ThoughtTracker ML service at `ML_CLASSIFIER_URL/post /embed`.
 * - `openai`: OpenAI embeddings endpoint, using `AI_API_KEY`.
 *
 * Missing services, missing keys, bad responses, and timeouts throw. We do not
 * fabricate vectors in runtime code because those would disconnect the stored
 * artifacts from the gold-standard corpus.
 */

function currentEmbeddingProvider(): "openai" | "ml" {
  const v = (process.env.EMBEDDING_PROVIDER ?? "ml").toLowerCase();
  if (v === "openai" || v === "ml") return v;
  throw new Error(`Unsupported EMBEDDING_PROVIDER="${v}". Use ml or openai.`);
}

function currentEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
}

function currentApiKey(): string {
  return process.env.AI_API_KEY ?? "";
}

function embeddingTimeoutMs(): number {
  const parsed = Number(process.env.EMBEDDING_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

export interface EmbeddingResult {
  /** Dense vector returned by the selected real provider. */
  vector: number[];
  /** Provider/model identifier stored with the vector for provenance. */
  model: string;
}

/** DistilBERT hidden size and the pgvector column width used by the app. */
export const EMBEDDING_DIM = 768;

export async function embedText(text: string): Promise<EmbeddingResult> {
  if (currentEmbeddingProvider() === "ml") {
    return embedViaMl(text);
  }

  const model = currentEmbeddingModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), embeddingTimeoutMs());
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentApiKey()}`,
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openai_embedding_${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = data.data?.[0]?.embedding ?? [];
    if (vector.length === 0) throw new Error("empty_vector");
    return { vector, model };
  } catch (err) {
    logger.warn("Embedding API failed", { error: (err as Error).message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function embedViaMl(text: string): Promise<EmbeddingResult> {
  const base = process.env.ML_CLASSIFIER_URL ?? "http://localhost:8000";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), embeddingTimeoutMs());
  try {
    const res = await fetch(`${base}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text.slice(0, 8000)] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ml_embedding_${res.status}`);
    const data = (await res.json()) as {
      vectors?: number[][];
      modelVersion?: string;
      mockInference?: boolean;
    };
    if (data.mockInference) throw new Error("ml_embedding_mock_inference");
    const vector = data.vectors?.[0] ?? [];
    if (vector.length === 0) throw new Error("empty_vector");
    return { vector, model: data.modelVersion ?? "ml-distilbert" };
  } catch (err) {
    logger.warn("ML embedding failed", { error: (err as Error).message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cosine of the angle between two vectors. Length mismatches are tolerated by
 * truncating to the shorter vector so stored historical vectors can still be
 * compared during provider migrations.
 */
export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  const len = Math.min(vectorA.length, vectorB.length);
  let dot = 0;
  let normSquaredA = 0;
  let normSquaredB = 0;
  for (let i = 0; i < len; i += 1) {
    const aValue = vectorA[i] ?? 0;
    const bValue = vectorB[i] ?? 0;
    dot += aValue * bValue;
    normSquaredA += aValue * aValue;
    normSquaredB += bValue * bValue;
  }
  const denom = Math.sqrt(normSquaredA) * Math.sqrt(normSquaredB);
  return denom === 0 ? 0 : dot / denom;
}
