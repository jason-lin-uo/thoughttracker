# \_LEARN.md - `backend/src/ai/`

> The boundary between ThoughtTracker and external intelligence providers.
> Runtime code uses real/local providers only; tests may stub HTTP boundaries,
> but the product does not fabricate AI answers or embeddings.

## What Lives Here

`backend/src/ai` owns four concerns:

- **LLM dispatch** through `llmClient.ts`, using `AI_PROVIDER=local|openai|anthropic`.
- **Embeddings** through `embeddingClient.ts`, using `EMBEDDING_PROVIDER=ml|openai`.
- **ThoughtTracker ML service calls** through `mlClassifierClient.ts`, which talks to the sibling `thoughttracker-ml` FastAPI service.
- **Prompt and schema contracts** through `prompts/` and `schemas/`.

The rest of the backend should not know the provider-specific HTTP request
shape. Services send a typed task request and receive typed provider metadata
plus validated JSON.

## `llmClient.ts`

`runLlm(req)` is the single LLM entry point for topic detection, stance
rationales, summaries, timelines, and reports.

Supported providers:

- `local`: Ollama-compatible local model, defaulting to `llama3.1:8b`.
- `openai`: OpenAI chat/completions endpoint, using `AI_API_KEY`.
- `anthropic`: Anthropic messages endpoint, using `AI_API_KEY`.

Important behavior:

- Provider is resolved at call time, so tests and local runs can change env
  without reloading the module.
- Repeated prompts are served from `llmCache` when possible.
- Hosted providers pass through `llmBudget` before spending tokens.
- Provider failures remain visible. If the selected provider, model, key, or
  quota is unavailable, the call throws instead of returning invented content.

## `embeddingClient.ts`

`embedText(text)` converts transcript chunks into dense vectors for
owner/offline analysis workflows.

Supported providers:

- `ml`: the local ThoughtTracker ML service `/embed` endpoint, matching the
  app's 768-dimensional pgvector column.
- `openai`: OpenAI embeddings, using `AI_API_KEY`.

Runtime embedding failures throw. This is deliberate: fake vectors would
disconnect stored artifacts from the analyzed corpus.

## `mlClassifierClient.ts`

This client talks to the sibling `thoughttracker-ml` FastAPI service.

It is used for:

- stance prediction via `/predict`
- topic candidate ranking via `/predict-topics`
- topic relevance scoring via `/predict-topic-relevance`
- embedding generation via `/embed` through `embeddingClient.ts`

The client normalizes success and failure responses into discriminated unions
so services can make explicit choices: use the result, fall back to another
real provider when configured, or fail loudly for gold-standard policy paths.

## `llmBudget.ts`

`llmBudget` tracks hosted-provider spend across a rolling 24-hour window.
`llmCache` stores prompt results in memory for a short period so repeated
requests do not re-spend tokens.

When the budget gate blocks a hosted call, `runLlm()` throws. The caller can
surface that to the UI or ask the owner to switch to local AI.

## `prompts/`

Each prompt file contains one task-specific prompt builder and a version string:

- `topicDetection.prompt.ts`
- `stanceClassification.prompt.ts`
- `videoTopicSummary.prompt.ts`
- `creatorTimeline.prompt.ts`
- `creatorReport.prompt.ts`
- `topicReport.prompt.ts`

Prompt builders take typed inputs. This keeps long natural-language
instructions out of service code while still catching missing fields at compile
time.

## `schemas/`

Each LLM task has a Zod schema that validates the model's JSON before data
crosses into business logic. Services should treat schema failures as real
provider failures or conservative "no usable result" cases, never as a reason
to create fake labels.

## Debug Map

| Symptom                              | Start Here                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Report generation failed             | `llmClient.ts`, then `prompts/creatorReport.prompt.ts` or `prompts/topicReport.prompt.ts` |
| Local AI is not responding           | `LOCAL_LLM_BASE_URL`, Ollama status, and `llmClient.ts`                                   |
| OpenAI/Anthropic quota or auth issue | `AI_API_KEY`, `AI_PROVIDER`, `llmBudget.ts`                                               |
| Embedding regeneration failed        | `embeddingClient.ts`, `services/embedding.service.ts`, pgvector availability              |
| ML stance/topic endpoint failed      | `mlClassifierClient.ts` and `thoughttracker-ml/src/api/main.py`                           |
| LLM JSON shape changed               | Matching file in `schemas/` plus the prompt that produced it                              |
