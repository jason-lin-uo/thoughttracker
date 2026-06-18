import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for ThoughtTracker.
 *
 * Run:
 * npx playwright install --with-deps chromium # one-time on a fresh machine
 * npm run setup:local # first time only; restores the real data snapshot
 * npm run test:e2e
 *
 * The webServer block boots backend + frontend for browser tests. Local runs
 * use `npm run dev` so Postgres is started automatically. CI already provides
 * Postgres as a service container, so it uses `npm run dev:app` instead.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? "npm run dev:app" : "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AI_PROVIDER: "openai",
      EMBEDDING_PROVIDER: "ml",
      YOUTUBE_PROVIDER: "youtube",
      STANCE_ANALYSIS_PROVIDER: "custom_ml",
    },
  },
});
