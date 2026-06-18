# Glossary

Author: Jason Lin

Plain-language definitions for the terms a reviewer will see in the code,
documentation, UI, API responses, and ML metrics. This file is intentionally
reader-friendly: it explains the technology without asking the reader to already
know machine learning, database internals, or full-stack architecture.

The current product baseline uses real five-creator transcript data, a restored
PostgreSQL snapshot and local Ollama report generation. The companion
`thoughttracker-ml` repo remains the owner pipeline for transcript refresh,
stance, embeddings, topic relevance, topic reranking, and final topic
selection. Test doubles still exist inside tests, but they are not the product
data path.

---

## AI And Machine Learning

**Argmax** - "Pick the largest." If a classifier returns scores for several
labels, argmax picks the label with the highest score.

**BERT / DistilBERT / Transformer** - Transformer language models are neural
networks trained to represent language. DistilBERT is a smaller, faster BERT
variant. ThoughtTracker uses local transformer-based artifacts in the companion
ML repo when the owner refreshes or reanalyzes the corpus.

**Candidate topic** - A possible controlled-taxonomy topic proposed for a
transcript chunk before relevance filtering and final policy selection.

**Checkpoint** - A saved model artifact. In this project, committed runtime
artifacts live in `thoughttracker-ml/models/` and are loaded by the FastAPI
service.

**Confidence** - A score or label describing how strongly the system believes a
topic or stance assignment is supported. Confidence is useful for sorting and
display gating, but it never replaces the evidence quote.

**Confusion matrix** - A grid showing which labels a classifier predicts for
each true label. The diagonal is correct predictions; off-diagonal cells show
which labels are being confused.

**Controlled taxonomy** - The fixed list of allowed topic names/slugs. It keeps
the UI coherent by preventing every model run from inventing new topic wording.

**Cosine similarity** - A measurement of how similar two vectors are in meaning.
The stored embedding rows use this style of vector math when owner workflows
recompute or inspect similarity.

**Embedding** - A list of numbers representing the meaning of text. Similar
chunks produce similar vectors. The restored product snapshot already contains
the embedding rows needed by the current UI; owner refresh workflows can
regenerate them through the ML repo.

**Exact match** - A strict topic-selection metric. The predicted topic set must
exactly match the validated topic set for that row. It is stricter than getting
some of the topics right.

**F1 score** - A metric combining precision and recall. It is useful when both
false positives and false negatives matter.

**Final topic-selection policy** - The calibrated policy frozen under
`thoughttracker-ml/models/topic-selection-policy-gold-standard`. It combines
topic candidates, relevance checks, reranker scores, thresholds, and conservative
display rules.

**Fine-tuning** - Continuing to train a pre-trained model on task-specific data.
In this project, the expensive calibration work happened in the ML repo and is
committed as runtime artifacts rather than repeated during reviewer setup.

**Gold standard** - The validated final baseline used by the product. Here it
means the accepted topic-selection policy, metrics, model artifacts, and
database snapshot that power the portfolio demo.

**LLM** - Large Language Model. ThoughtTracker uses a local Ollama model by
default for report writing, with optional hosted OpenAI/Anthropic providers for
private owner runs.

**Macro F1** - F1 averaged equally across topics or labels. It exposes rare-topic
weaknesses because uncommon labels count as much as common labels. The current
topic policy has strong exact match, precision, recall, and micro F1, while
macro F1 remains the honest rare-topic enrichment target.

**Micro F1** - F1 computed across all decisions at once. It reflects overall
volume-weighted correctness and is less sensitive to rare-label gaps.

**Model artifact** - A saved file or folder needed for inference, such as a
classifier, tokenizer, reranker, relevance model, or policy JSON.

**Ollama** - A local model runner. ThoughtTracker uses Ollama so report
generation can work on a reviewer's machine without an OpenAI API key.

**Precision** - Of the topics the system selected, the fraction that were
correct. High precision means few false positives.

**Recall** - Of the topics the system should have selected, the fraction it
found. High recall means few false negatives.

**Reranker** - A model that takes possible topics and reorders or scores them so
the best candidates appear near the top.

**Stance** - The position expressed by transcript text toward a topic:
supportive, opposed, neutral, mixed, unclear, or insufficient evidence.

**Topic relevance** - A model check that asks whether a transcript chunk is
actually about a candidate topic, instead of merely mentioning a related word.

**Vector** - Another word for embedding: a list of numbers representing text.

---

## Backend And Database

**Admin PIN** - `ADMIN_ONBOARDING_PIN`, sent as `X-Admin-Pin`. It gates
owner-only mutations such as Add Creators.

**AnalysisRun** - A provenance row recording what kind of analysis ran, when it
ran, and which provider/model/prompt was involved.

**API** - The HTTP interface under `/api`. The frontend uses it to fetch
creators, videos, topics, evidence, reports, and job status.

**Controller** - A backend module that handles HTTP-specific concerns: request
validation, calling services, response shape, and status codes.

**Database dump** - `thoughttracker_full.dump`, the Git-LFS-tracked PostgreSQL
snapshot containing the real product corpus, analysis rows, reports, and vector
data.

**Git LFS** - Git Large File Storage. It stores large files such as database
dumps and model artifacts without bloating normal Git history.

**HNSW** - Hierarchical Navigable Small World. The pgvector index type used for
fast approximate nearest-neighbor vector search.

**Idempotency** - A safety pattern where repeating the same request with the
same key does not duplicate work. It matters for retries and long-running jobs.

**In-process job runner** - The backend's simple async queue for long work such
as report generation, analysis, and owner-triggered onboarding. It is enough for
portfolio scale; a larger production system could move to Redis/BullMQ.

**Middleware** - Express functions that run before route handlers. They handle
request IDs, timeouts, error shaping, admin PIN checks, rate limits, and
idempotency.

**ORM** - Object-Relational Mapper. Prisma lets the backend query the database
with typed TypeScript objects instead of raw SQL everywhere.

**pgvector** - A PostgreSQL extension that stores vector columns and performs
fast vector similarity search.

**Prisma** - The TypeScript ORM used to define the database schema and generate
the typed database client.

**Rate limiting** - Request caps that protect expensive endpoints and public
demo deployments from accidental abuse.

**Route** - The URL mapping layer. Routes connect paths like `/api/reports` to
controller functions.

**Service** - A backend module containing domain logic. Services should know
about the database and business rules, but not browser details.

**Transcript chunk** - A section of transcript text small enough to analyze and
cite precisely. Chunks let the product attach claims to exact evidence.

**VTT** - YouTube caption format. Raw VTT files are useful during collection but
are not needed in the clean public product once final text transcripts and the
database snapshot are committed.

---

## Frontend And Product UI

**Accessibility / a11y** - Making the UI usable with keyboard navigation,
screen readers, readable contrast, and semantic markup. Playwright includes
accessibility checks.

**Add Creators** - The visible owner-only onboarding page. Recruiters can see
that the product has a scale-up path, but only the owner can operate it with the
PIN.

**Compare page** - A page that shows shared and differing topics across
creators. Shared topics can link into deeper topic/creator views.

**Evidence quote** - A short exact quote from a transcript chunk that supports a
topic or stance claim.

**React Query / TanStack Query** - The frontend data-fetching library. It caches
API responses, tracks loading/error states, and refreshes after mutations.

**Recharts** - The charting library used for stance, topic, and trend
visualizations.

**Report** - A human-readable narrative generated from database aggregates and
evidence quotes. Reports should link their sources back to video/transcript
pages.

**Source link** - A UI link from a report or evidence item back to the video or
transcript page that supports the claim.

**Stance graph** - A visual summary of stance over time or by topic. It gives
reviewers a quick way to see the pattern before reading the full report.

**Virtualization** - Rendering only visible list rows so large evidence/video
lists stay fast.

---

## Testing And Review

**End-to-end test** - A Playwright browser test that drives the app like a user.

**Integration test** - A test crossing module boundaries, often involving API
routes, services, and database behavior.

**Mock / test double** - A fake dependency used inside tests to isolate behavior
or force an error branch. Test doubles are acceptable in tests; they should not
be the runtime product data path.

**Regression suite** - The combined typecheck, backend tests, frontend tests, ML
tests, build, and Playwright checks run before handoff.

**Unit test** - A focused test for one module or behavior.

**Coverage** - The percentage of source lines exercised by tests. This project
targets 100% line coverage for backend, frontend, and ML unit suites.
