import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/test-setup.ts",
        "src/i18n/en.ts" /* pure data */,
        "src/lib/types.ts" /* pure types */,
      ],
      thresholds: {
        lines: 100,
        functions: 80,
        statements: 88,
        branches: 80,
      },
    },
  } as Parameters<typeof defineConfig>[0]["test"],
});
