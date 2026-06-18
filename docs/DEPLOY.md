# Deployment

ThoughtTracker can run locally or on a hosted stack as long as the deployment
has a pgvector-capable PostgreSQL database and the real database snapshot. The
public portfolio path uses pre-generated real reports from the snapshot so the
reviewer can click a live link without requiring paid API keys or a hosted ML
service.

## Local Product Deployment

For local evaluation, install the prerequisites, then run from the main repo:

```bash
cd thoughttracker
npm run setup:local
npm run dev
```

`setup:local` creates/copies env files, pulls Git LFS artifacts, installs
dependencies, starts Postgres, applies schema setup, restores the real database
snapshot, generates the Prisma client, runs pgvector/index setup, and verifies
the local Ollama model. `dev` starts Postgres, backend, and frontend.

Owner-only refresh/reanalysis workflows can keep `thoughttracker` and
`thoughttracker-ml` side by side and use:

```bash
npm run setup:local:full
npm run dev:full
```

The older manual restore path still works for debugging:

```bash
git lfs pull
docker compose up -d
npm run db:push
npm run db:setup --workspace backend
pg_restore --no-owner --clean --if-exists \
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" \
 thoughttracker_full.dump
npm run setup:local-ai
npm run dev
```

Run `thoughttracker-ml` separately on port 8000 only for owner reanalysis.

## Public Full-Product Deployment

The public portfolio version should be the same real product, not a mock demo.
The difference is that the infrastructure runs in hosted services instead of on
the reviewer's laptop:

1. Create a pgvector-capable hosted Postgres database, such as Neon.
2. Restore the appropriate real-data snapshot into the hosted database.
3. Deploy the backend with `DATABASE_URL` pointing at the hosted database.
4. Deploy the Vite frontend and point `VITE_API_BASE_URL` at the hosted API.
5. Use cached/pre-generated reports from the restored snapshot; do not
   expose your OpenAI key or owner PIN to recruiters.
6. Keep `ADMIN_ONBOARDING_PIN` as a private service secret so Add Creators stays
   visible but owner-only.

### Database Snapshot Choice

There are two real-data database snapshots:

- `thoughttracker_full.dump` is the complete local product snapshot. It keeps
  full transcript text in both `Transcript` rows and ordered
  `TranscriptChunk` rows. Use this when the hosted database has enough storage.
- `thoughttracker_hosted_free.dump` is the free-hosting snapshot. It keeps the
  same real creators, videos, topics, transcript chunks, embeddings, evidence,
  reports, and indexes, but replaces redundant `Transcript.rawText` /
  `Transcript.cleanedText` full-text copies with a short marker. The UI renders
  transcripts from ordered chunk rows, so the public read path remains real while
  fitting smaller database plans.

Neon Free is limited to 0.5 GB per project. The full dump can exceed that limit
during restore because PostgreSQL expands table data, extension data, indexes,
constraints, and restore churn. Use `thoughttracker_hosted_free.dump` for a free
Neon public deployment.

## Render Blueprint

`render.yaml` provisions the free public app services:

- Docker-backed Express API
- static Vite frontend that calls the API by absolute URL

It expects an existing Neon Free database restored from
`thoughttracker_hosted_free.dump`. Set `DATABASE_URL` as a Render secret; do not
create a separate Render managed database for the free path.

The hosted dump already contains the Prisma schema. The API Docker start command
only verifies pgvector/index setup before starting Express. Render Free does not
support pre-deploy commands, and running `prisma db push` on every boot is too
aggressive for a restored public snapshot:

```bash
node dist/prisma/setup-db.js
```

Restore `thoughttracker_hosted_free.dump` into Neon before presenting the
product. The dump contains the real corpus and analysis rows in a storage shape
that fits the Neon Free limit.

The hosted snapshot intentionally starts with one featured report:
**MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs**. After a
recruiter session, unlock the Add Creators page with the admin PIN and use
**Reset all reports** to clear newly generated reports and restore that same
clean featured-report state for the next viewer.

## Fly.io

For the API:

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=postgres://...
fly deploy
```

For the frontend, build `frontend/Dockerfile.production` and set:

```bash
fly secrets set API_PROXY_TARGET=https://thoughttracker-api.fly.dev
```

The nginx template sends `/api/*` to the backend service.

## Environment Variables

| Name                           | Required             | Default                  | Purpose                                                                                  |
| ------------------------------ | -------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | yes                  | -                        | Postgres connection string for the real product snapshot.                                |
| `PORT`                         | no                   | `4000`                   | API bind port.                                                                           |
| `NODE_ENV`                     | no                   | `development`            | Production enables compact logs and stricter admin behavior.                             |
| `FRONTEND_URL` / `CORS_ORIGIN` | no                   | `http://localhost:5173`  | Allowed browser origin.                                                                  |
| `AI_PROVIDER`                  | no                   | `local`                  | `local`, `openai`, or `anthropic`.                                                       |
| `AI_MODEL`                     | no                   | `llama3.1:8b`            | Local Ollama model or hosted model id.                                                   |
| `LOCAL_LLM_BASE_URL`           | no                   | `http://localhost:11434` | Ollama-compatible local LLM endpoint.                                                    |
| `AI_API_KEY`                   | optional             | -                        | Required only if you intentionally enable OpenAI/Anthropic. Never commit it.             |
| `YOUTUBE_PROVIDER`             | no                   | `youtube`                | Runtime provider name; owner refresh scripts handle verified transcript refreshes.       |
| `STANCE_ANALYSIS_PROVIDER`     | no                   | `custom_ml`              | `llm`, `custom_ml`, or `hybrid`.                                                         |
| `ML_CLASSIFIER_URL`            | owner reanalysis only | `http://localhost:8000` | Base URL for local/offline `thoughttracker-ml` workflows.                                |
| `ML_CLASSIFIER_TIMEOUT_MS`     | no                   | `4000`                   | Per-request ML timeout.                                                                  |
| `TOPIC_ASSIGNMENT_PROVIDER`    | no                   | `final_policy`           | Uses the frozen topic-selection policy.                                                  |
| `TOPIC_SELECTION_POLICY_PATH`  | no                   | sibling ML artifact      | Optional explicit path to `policy.json`.                                                 |
| `TOPIC_RERANKER_LIMIT`         | no                   | `12`                     | Candidate limit for topic reranking.                                                     |
| `TOPIC_RERANKER_MIN_SCORE`     | no                   | `0.2`                    | Minimum candidate score.                                                                 |
| `TOPIC_RELEVANCE_THRESHOLD`    | no                   | `0.8`                    | Relevance threshold.                                                                     |
| `PUBLIC_READ_CACHE_TTL_MS`      | no                   | `300000`                 | In-memory TTL for public read endpoints on the hosted API. Set `0` to disable.           |
| `ADMIN_ONBOARDING_PIN`         | owner-only mutations | -                        | Required for Add Creators and other mutations in production/demo mode.                   |
| `DEMO_MODE`                    | no                   | `false`                  | Enables stricter public-demo guardrails/rate limits; does not switch to fake providers.  |

## Frontend Bootstrap Snapshot

The frontend bundles `frontend/src/generated/bootstrapSnapshot.json` for a fast
first paint on free hosting. It includes dashboard, creator list, topic list,
reports list, and the current default report detail. React Query marks the
snapshot stale immediately and refreshes from the live API in the background.

Refresh it whenever the hosted starter state changes:

```powershell
$env:BOOTSTRAP_API_BASE_URL="https://thoughttracker-api.onrender.com/api"
npm run snapshot:bootstrap
```

For local-only refreshes, point `BOOTSTRAP_API_BASE_URL` at
`http://localhost:4000/api` after restoring the database and starting the
backend.

## Hosted Report Options

The free public app should rely on the pre-generated real reports already in the
database snapshot. Local demos can use Ollama for report regeneration. If a
hosted deployment intentionally enables live generation, set `AI_PROVIDER` to
`openai` or `anthropic` and store the API key as a provider secret. Do not expose
API keys to recruiters.

If no report provider is reachable, live report generation should fail clearly.
It should not save fabricated report text.

## ML Service

`thoughttracker-ml` is the offline/local pipeline for owner workflows: ingesting
new creator transcripts, refreshing labels, training/ranking policies, and
building a new product snapshot. It is not required for the public read-only
portfolio app after the dedicated vector-search page was removed.

For local owner workflows, run `thoughttracker-ml` separately and point the
backend at it:

```text
ML_CLASSIFIER_URL=http://localhost:8000
EMBEDDING_PROVIDER=ml
STANCE_ANALYSIS_PROVIDER=custom_ml
TOPIC_ASSIGNMENT_PROVIDER=final_policy
```

The backend calls:

- `GET /health`
- `POST /predict`
- `POST /embed`
- `POST /predict-topic-relevance`
- `POST /predict-topics`

Required runtime artifacts live in the ML repo's `models/` directory and should
be fetched with Git LFS.

## Owner-Only Onboarding

The Add Creators page is visible to show the scale-up architecture, but it is an
owner workflow. Set `ADMIN_ONBOARDING_PIN` and keep it private. Recruiters
should not receive the PIN or provider API keys.

## Pre-Deploy Verification

```bash
npm run typecheck
npm run test --workspace backend -- --run --reporter=dot
npm run test --workspace frontend -- --run --reporter=dot
npm run test:e2e
```

ML repo:

```bash
cd ../thoughttracker-ml
python -m pytest -q
```

Run Playwright after the database, backend, frontend, and Ollama are available.
The ML service is only needed for owner reanalysis specs/workflows.
