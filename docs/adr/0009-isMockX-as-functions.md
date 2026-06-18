# ADR-009 - Provider-Mode Checks Are Functions

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Current-State Note

This ADR is about testability and runtime configurability. The current product
defaults are real/local providers, but the same lesson still applies: provider
checks should be evaluated at call time, not frozen at module import time.

## Context

The first implementation exported boolean constants such as:

```ts
export const isMockAi =
  env.aiProvider === "mock" || env.enableMockMode || !env.aiApiKey;
```

That captured `process.env` when the module loaded. Tests that changed provider
environment variables in `beforeEach` could still hit the previously cached
branch. Workarounds such as `vi.resetModules()` destabilized Prisma and made the
suite harder to reason about.

## Decision

Use functions that read the current environment at call time:

```ts
export function isMockAi(): boolean {
  const provider = process.env.AI_PROVIDER ?? "local";
  const enableMock = bool(process.env.ENABLE_MOCK_MODE, mockModeDefault());
  const apiKey = process.env.AI_API_KEY ?? "";

  return provider === "mock" || (provider !== "local" && enableMock && !apiKey);
}
```

The exact condition can evolve with provider policy. The important rule is that
callers invoke a function, for example `isMockAi()`, rather than importing a
frozen constant.

## Consequences

- Tests can change env vars without resetting the whole module graph.
- Provider behavior is easier to reason about during local debugging.
- Runtime configuration is not accidentally frozen at first import.
- The cost is tiny: reading `process.env` is not a meaningful hot-path issue.

## Alternatives Considered

- **Keep constants and reset modules in tests.** Rejected because it caused
  brittle cross-test behavior.
- **Cache per request.** Rejected because it adds machinery without solving a
  real performance problem.
