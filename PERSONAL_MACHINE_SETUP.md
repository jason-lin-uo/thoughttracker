# Personal Machine Setup

This is the current local runbook for the real-data ThoughtTracker product. A
reviewer can run the main app from the `thoughttracker` repo alone. The sibling
`thoughttracker-ml` repo is only needed for owner reanalysis, transcript refresh,
or Add Creators workflows.

## What The Product Uses Now

- Real transcript corpus for the five current creators.
- `thoughttracker_full.dump`, tracked with Git LFS, as the portable database
  snapshot.
- precomputed stance, topic, evidence, embedding, and report rows in the restored
  database snapshot for normal browsing.
- `thoughttracker-ml` runtime artifacts for owner-only refresh/reanalysis.
- Ollama for local report generation, so reviewers do not need your OpenAI key.
- `ADMIN_ONBOARDING_PIN` for owner-only creator onboarding.

## Current Topic-Selection Metrics

| Metric      | Result |
| ----------- | -----: |
| Exact match | 95.44% |
| Micro F1    | 98.40% |
| Precision   | 97.82% |
| Recall      | 98.98% |
| Macro F1    | 75.35% |

Macro F1 is the remaining rare-topic polish metric. The product baseline is the
exact-match, micro-F1, precision, recall, evidence, and display-quality path.

## Required Tools

- Git and Git LFS
- Node.js 20+
- npm 10+
- Docker-compatible engine
- Ollama

Python 3.11+ is only required for owner ML workflows.

Install Ollama:

```bash
# Windows
winget install Ollama.Ollama

# macOS
brew install --cask ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

After installation, open the Ollama app or run:

```bash
ollama serve
```

## Fast Local Setup

Run this from the main repo:

```bash
cd path/to/thoughttracker
npm run setup:local
```

The script handles the first-time setup steps that used to be manual:

- copies env files only when missing
- pulls Git LFS artifacts for the app snapshot
- installs Node dependencies
- starts Docker Postgres
- restores `thoughttracker_full.dump`
- runs pgvector/index setup
- generates the Prisma client
- verifies Ollama and pulls/checks the local report model

Then start the product:

```bash
npm run dev
```

Open the frontend URL printed by Vite. It is usually:

```text
http://localhost:5173
```

If another process is already using the port, Vite prints a different one.

For owner-only refresh/reanalysis workflows, keep `thoughttracker` and
`thoughttracker-ml` side by side, then run:

```bash
npm run setup:local:full
npm run dev:full
```

## Manual Setup Reference

Use this section only when debugging a specific setup failure.

Verify `backend/.env` contains:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/thoughttracker?schema=public
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

AI_PROVIDER=local
AI_MODEL=llama3.1:8b
LOCAL_LLM_BASE_URL=http://localhost:11434

YOUTUBE_PROVIDER=youtube

TOPIC_ASSIGNMENT_PROVIDER=final_policy

ADMIN_ONBOARDING_PIN=choose-a-private-local-pin
```

## Database Setup

Start local Postgres:

```bash
docker compose up -d
```

Restore the real product snapshot:

```powershell
pg_restore --no-owner --clean --if-exists `
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" `
 thoughttracker_full.dump
```

macOS/Linux:

```bash
pg_restore --no-owner --clean --if-exists \
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" \
 thoughttracker_full.dump
```

Do not use `db:seed` for the portfolio product. That command is guarded because
it deletes and repopulates tables for test/development fixtures.

## ML Service Setup

Use this only when you are intentionally running owner reanalysis.

```bash
cd path/to/thoughttracker-ml
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

macOS/Linux:

```bash
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

## Start The Product Manually

For normal reviewer startup, run this in the main repo:

```bash
npm run setup:local-ai
npm run dev
```

## Owner-Only Add Creators

The Add Creators button stays visible so the product shows a scale-up path. It
is not publicly operable. Mutating onboarding calls require:

```text
X-Admin-Pin: <ADMIN_ONBOARDING_PIN>
```

The backend checks the PIN in constant time. Recruiters should not receive the
PIN, API keys, or permission to mutate the corpus.

## Verification

Main app:

```bash
cd path/to/thoughttracker
npm run typecheck
npm run test --workspace backend -- --run --reporter=dot
npm run test --workspace frontend -- --run --reporter=dot
npm run test:e2e
```

ML repo:

```bash
cd path/to/thoughttracker-ml
.venv/bin/python -m pytest -q
```

On Windows use:

```powershell
.venv\Scripts\python.exe -m pytest -q
```

Current verified status:

- backend typecheck passes
- backend Vitest passes: 721 tests
- frontend typecheck passes
- frontend Vitest passes: 328 tests
- ML pytest passes: 183 tests, 100% coverage

## Troubleshooting

| Symptom                                  | Cause                             | Fix                                                             |
| ---------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `ollama` command not found after install | PATH has not refreshed            | Open a new terminal or reboot, then run `ollama --version`.     |
| Report generation does nothing           | Backend is not reaching Ollama    | Run `npm run setup:local-ai`; confirm `http://localhost:11434`. |
| Backend cannot bind port 4000            | Old backend process still running | Stop the old process or change `PORT`.                          |
| UI fetches fail                          | Backend or DB is not running      | Check `http://localhost:4000/api/health` and Postgres.          |
| ML health says model not loaded          | Missing artifact or wrong path    | Run `git lfs pull` in `thoughttracker-ml`; check model folders. |
| Add Creators returns 401/403             | Missing or wrong owner PIN        | Set `ADMIN_ONBOARDING_PIN` and use the same PIN in the UI.      |

## What Not To Recreate

Do not recreate old ChatGPT packet folders, failed calibration rounds, raw VTT
caches, or temporary labeling logs. The clean state is the real transcript
corpus, the final ML artifacts, the real database dump, and the tested source
code.
