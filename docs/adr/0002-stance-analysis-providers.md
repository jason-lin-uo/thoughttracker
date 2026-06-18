# ADR-002 - Stance Analysis Providers

- **Status:** Accepted, with current default updated
- **Date:** 2026-05
- **Authors:** Jason Lin

## Current-State Note

This ADR records why stance analysis was built behind a provider abstraction.
The original default during early development was a deterministic test/demo
path. The current portfolio runtime uses:

```env
STANCE_ANALYSIS_PROVIDER=custom_ml
ML_CLASSIFIER_URL=http://localhost:8000
```

Mocks and test doubles remain valid inside tests. They are not the runtime
product data path.

## Context

Stance classification asks: "What stance does this transcript chunk express
toward this topic?"

The product needed more than one implementation strategy:

| Approach          | Strengths                                      | Tradeoffs                                  |
| ----------------- | ---------------------------------------------- | ------------------------------------------ |
| Test double       | Free, deterministic, easy to cover edge cases  | Not a real classifier                      |
| LLM               | Flexible and can produce rationale/evidence    | Cost, latency, drift                       |
| Custom ML         | Fast, reproducible, free after training         | Needs trained artifacts and local service  |
| Hybrid            | ML label plus LLM explanation                   | More moving parts                          |

Hard-coding one option would have made the project brittle. The provider switch
lets the product move from early testability to the current real local ML path
without rewriting the service layer.

## Decision

Expose `STANCE_ANALYSIS_PROVIDER` and route stance work through
`services/stanceAnalysis.service.ts`.

Supported modes:

- `llm`: call the configured LLM provider.
- `custom_ml`: call the companion `thoughttracker-ml` service.
- `hybrid`: use ML for label/confidence, then ask the LLM for rationale/evidence.

Test-only code may still exercise deterministic branches, but public product
configuration should use `custom_ml` unless deliberately testing another mode.

## Consequences

- The backend can run with a local ML service and no paid LLM calls for stance.
- Tests can isolate error branches without loading real model weights.
- The product can explain missing ML service failures clearly instead of hiding
  them as successful real analysis.
- A future production system can choose `hybrid` for richer explanations if cost
  and latency are acceptable.

## Alternatives Considered

- **Single hard-coded provider.** Rejected because it blocks migration from test
  fixtures to trained local ML.
- **Full plugin registry.** Rejected because the fixed provider set is easier to
  understand and test at this project scale.
