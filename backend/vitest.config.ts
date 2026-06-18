import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /*
     * One retry absorbs the residual environmental flakiness that
     * can't be fixed from app code. The big source-side fixes are
     * all in place (analyzeVideoJob `upsert`, Prisma retry middleware +
     * connection pool of 20,
     * `jobRunner.drain()` in the jobs test, cached-ID re-resolution
     * in api/controllers/services tests). What's left after all that:
     * - supertest socket churn under load: "Parse Error: Expected
     * HTTP/, RTSP/ or ICE/", ECONNRESET, 30s timeouts.
     * - A rare `analyzeVideoJob` failure in jobs.test.ts that
     * traces to upstream pipeline transients (not a race we
     * can close from the test side).
     * Empirically ~13-14/15 pass without retry; with retry, 15/15.
     * Per-test fixtures + per-test prisma instances would close this
     * fully but require ~hour of test refactor for marginal benefit.
     */
    retry: 1,
    pool: "forks",
    forks: { singleFork: true } /* share one DB connection across tests */,
    globalSetup: "./tests/globalSetup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts" /* boots the http server; covered by shutdown test */,
        "src/**/*.d.ts",
        "src/openapi/spec.ts" /* declarative; not executable */,
      ],
      /*
       * Aspirational target is 100% lines; the floor below catches regressions
       * while leaving room for genuinely hard-to-reach error/fallback paths.
       * The CI workflow runs this on every PR.
       */
      thresholds: {
        lines: 100,
        functions: 90,
        statements: 90,
        branches: 70,
      },
    },
  } as Parameters<typeof defineConfig>[0]["test"],
});
