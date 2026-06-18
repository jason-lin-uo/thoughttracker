import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  frontendUrl:
    process.env.FRONTEND_URL ??
    process.env.CORS_ORIGIN ??
    "http://localhost:5173",

  aiProvider: (process.env.AI_PROVIDER ?? "local") as
    | "openai"
    | "anthropic"
    | "local",
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "llama3.1:8b",

  embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "ml") as
    | "openai"
    | "ml",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",

  youtubeProvider: (process.env.YOUTUBE_PROVIDER ?? "youtube") as "youtube",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
};

const ALLOWED_PROVIDER_ENUMS: Record<string, readonly string[]> = {
  AI_PROVIDER: ["openai", "anthropic", "local"],
  EMBEDDING_PROVIDER: ["openai", "ml"],
  YOUTUBE_PROVIDER: ["youtube"],
  STANCE_ANALYSIS_PROVIDER: ["llm", "custom_ml", "hybrid"],
  TOPIC_ASSIGNMENT_PROVIDER: [
    "",
    "default",
    "curated_reranker",
    "final_policy",
    "custom_ml_reranker",
  ],
};

/**
 * Fail-fast boot-time validation for required connection strings and provider
 * enums. Runtime app code must use real/local providers. Test doubles belong
 * in tests rather than product environment variables.
 */
export function validateEnv(): void {
  const errors: string[] = [];
  const isProd = (process.env.NODE_ENV ?? "development") === "production";

  const dbUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!dbUrl) {
    errors.push("DATABASE_URL is required but not set");
  } else if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    errors.push(
      'DATABASE_URL must be a postgres connection string (start with "postgres://" or "postgresql://")',
    );
  }

  const frontendUrl = (
    process.env.FRONTEND_URL ??
    process.env.CORS_ORIGIN ??
    ""
  ).trim();
  if (!frontendUrl) {
    if (isProd)
      errors.push("FRONTEND_URL (or CORS_ORIGIN) is required in production");
  } else {
    try {
      // eslint-disable-next-line no-new -- constructing for validation side effect only
      new URL(frontendUrl);
    } catch {
      errors.push(`FRONTEND_URL is not a valid URL: "${frontendUrl}"`);
    }
  }

  for (const [name, allowed] of Object.entries(ALLOWED_PROVIDER_ENUMS)) {
    const raw = process.env[name];
    if (raw === undefined) continue;
    if (!allowed.includes(raw)) {
      errors.push(
        `${name}="${raw}" is invalid; allowed: ${allowed.map((a) => a || "(empty)").join(", ")}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n - ${errors.join("\n - ")}`,
    );
  }
}
