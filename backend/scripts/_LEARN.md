# \_LEARN.md - backend/scripts

Backend scripts are diagnostic and maintenance tools. They are not the product
data path.

## Current Scripts

| Script                                   | Purpose                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `build-creator-onboarding-packet.ts`     | Builds the backend-side packet for owner-gated Add Creators onboarding.       |
| `test-ml-roundtrip.ts`                   | Verifies the backend can call the ML service and parse its response.          |
| `../../scripts/setup-local-ai.mjs`       | Root-level Ollama preflight used by `npm run setup:local-ai` and local `dev`. |

The normal portfolio setup uses the real database dump, local Ollama, and the ML
service. These scripts are for inspection or controlled owner maintenance only.

## When To Use

- Run `build-creator-onboarding-packet.ts` only as part of the owner-controlled
  creator onboarding workflow.
- Run `test-ml-roundtrip.ts` if the backend cannot reach `ML_CLASSIFIER_URL`.
- Run `setup-local-ai.mjs` through the root npm scripts before local app startup.
