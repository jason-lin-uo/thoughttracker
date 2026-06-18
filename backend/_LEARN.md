# \_LEARN.md — `backend/`

> The brain of the app. Everything that *thinks* lives here.

---

## The story of this folder

Imagine the whole app as a restaurant. The **frontend** is the dining
room — pretty tables, menus, lighting. The **backend** is the kitchen.
Customers (browsers) walk up to the window (the HTTP API) and shout
orders. The kitchen takes those orders, opens the pantry (Postgres),
sometimes calls the supplier (OpenAI / Anthropic / the ML service), and
plates the food before sending it back through the window.

This folder is the entire kitchen. The `src/` subfolder is where the
cooks actually work; everything outside of `src/` is the kitchen's
infrastructure — the menu the customers see (the database schema), the
deep cleaning equipment (Docker), the policy manuals (TypeScript and
ESLint configs).

---

## File-by-file (top level of `backend/`)

### `package.json`

**What it is:** the manifest for the backend specifically. It declares
what libraries the backend depends on (Express, Prisma, Pino,
TypeScript, Vitest, etc.) and what commands you can run (`npm run dev`,
`npm run build`, `npm run test`, `npm run db:migrate`, etc.).

**Why it exists:** every Node project needs one of these. It's the
shopping list (dependencies) plus the recipe book (scripts).

**Used by:** npm (to install dependencies and run commands), the root
`package.json` (which references this workspace), and basically every
build/test/dev command.

---

### `tsconfig.json` and `tsconfig.eslint.json`

**What they are:** two configurations for TypeScript. `tsconfig.json` is
the main one — it tells the TypeScript compiler how strict to be, where
the source files live, where to emit compiled JavaScript, etc.
`tsconfig.eslint.json` is a slightly looser variant used only when
ESLint is checking the code (so ESLint doesn't trip on test files).

**Why they exist:** TypeScript wraps JavaScript with types and rules. The
compiler needs to know which folder is "source," which is "tests," what
language features to support (ES2022, modern Node), and how strict to
be. The two-file setup is a common pattern when ESLint needs a slightly
different view of the project than the build does.

**Used by:** `tsc` (the TypeScript compiler), `tsx` (the dev-mode
TypeScript runner), ESLint, and your editor's TypeScript language
server.

---

### `vitest.config.ts`

**What it is:** the configuration for **Vitest**, the test runner (think of it as the head taste-tester who tries every dish before service). It
tells Vitest: where the tests are (`tests/`), what test timeout to use
(30 seconds, since some tests hit a real Postgres), how to handle
parallelism — in plain terms, how many tests can cook at once (single fork because tests share one DB connection), what
coverage tool to use (`v8`), and what threshold to enforce.

**Why it exists:** running 408 tests without a config would be chaos.
This file is the central nervous system of the test suite. The
`retry: 1` setting is documented inline as the band-aid that absorbs
~1/15 environmental flakes — in plain terms, random hiccups that have nothing to do with the actual code being tested (supertest socket parser errors, Postgres
pool saturation, the kind of thing where the kitchen's plumbing burped) that source-side fixes couldn't fully eliminate.

**Used by:** `npm run test`, the CI pipeline, and Vitest itself.

---

### `Dockerfile`

**What it is:** the recipe for packaging the backend into a portable
container that can run on any cloud (Render, Fly, AWS, etc.). It uses
a **multi-stage build** — first stage installs all deps including
build tools, second stage builds the TypeScript, third stage copies just
the compiled output + production deps into a minimal Alpine Linux image.

**Why it exists:** containers are how modern apps deploy. Multi-stage
builds make the final image much smaller (no build tools, no source
code, just the compiled JS + node_modules + Prisma client).

**Used by:** `docker build`, the deploy pipelines (`render.yaml`,
`fly.toml`), and `docker-compose.full.yml`.

---

## Subfolders (each has its own `_LEARN.md`)

```
backend/
├── prisma/ # database schema + migrations + seed data
├── scripts/ # one-off operational scripts (cleanup, etc.)
├── src/ # the actual TypeScript source code (the cooks)
│ ├── ai/ # talking to LLMs and local/ML-backed providers
│ ├── config/ # env loader + Prisma client setup
│ ├── controllers/ # HTTP handlers — one per resource
│ ├── jobs/ # background async work (analysis, imports)
│ ├── middleware/ # Express middleware (logging, rate limit, etc.)
│ ├── openapi/ # auto-generated /api/openapi.json spec
│ ├── routes/ # URL → controller-function wiring
│ ├── services/ # the actual business logic (pure functions)
│ ├── utils/ # generic helpers (errors, retry, hashing, dates)
│ ├── app.ts # the Express app factory
│ └── server.ts # the entry point that boots the HTTP server
└── tests/ # all the vitest tests
```

Open each subfolder's `_LEARN.md` to read the story of what lives there
and why.

---

## How a request flows through `src/`

This is the **most important diagram in the whole backend**. When a
browser asks "give me the dashboard," here's the journey:

1. Browser hits `GET /api/dashboard`.
2. Express receives the request.
3. **`src/middleware/`** runs first — logging, rate-limit checks, request
   ID assignment, idempotency-key handling (in plain terms: checking whether this exact order was already placed a moment ago, so we don't make two of the same sandwich). This is the security guard at
   the kitchen door.
4. **`src/routes/`** looks up the URL and figures out which controller
   handles it. This is the maitre d' pointing the order to the right
   station.
5. **`src/controllers/`** handles the HTTP layer — parses query
   parameters, validates them, calls the right service. This is the line
   cook who takes the order ticket.
6. **`src/services/`** does the actual work — queries the database,
   maybe calls an LLM, aggregates results. This is the actual chef.
7. **`src/ai/`** is called if AI is needed — service asks it to classify
   a stance, detect a topic, generate a summary. This is the spice
   supplier.
8. **`src/config/prisma`** is called if the database is touched. This is
   the pantry door.
9. Result bubbles back up the chain. **`src/utils/errors`** handles any
   error along the way, shaping it into a clean JSON response.
10. **`src/middleware/`** runs again on the way out (logging the response).
11. Browser gets JSON.

That's the whole story of every backend request, condensed.

---

## How background work happens (no request needed)

Some work doesn't fit into a request/response cycle — like "analyze every
chunk of this 90-minute video," which takes minutes. For that:

1. **`src/jobs/jobRunner.ts`** holds a tiny in-memory queue.
2. When a controller wants to kick off a slow task, it calls
   `jobRunner.enqueue("analyze_video", ...)` and immediately returns a
   `202 Accepted` to the user.
3. The job runner serially processes the queue in the background, calling
   into services and the AI layer as needed.

Think of it as: "the kitchen also runs a prep team in the back room. The
window staff just take orders; the prep team works on the long stuff
independently."

---

## What to read next

If you want to understand the backend bottom-up (foundations first):

1. `src/config/_LEARN.md` — env loader, Prisma client
2. `src/utils/_LEARN.md` — small reusable helpers
3. `src/ai/_LEARN.md` — the LLM client layer
4. `src/services/_LEARN.md` — business logic
5. `src/jobs/_LEARN.md` — background workers
6. `src/controllers/_LEARN.md` and `src/routes/_LEARN.md` — HTTP layer
7. `src/middleware/_LEARN.md` — cross-cutting Express middleware
8. `src/openapi/_LEARN.md` — the auto-generated API spec

Or top-down (request first):

1. `src/app.ts` and `src/server.ts` — read these two files directly,
   they're short
2. `src/middleware/_LEARN.md`
3. `src/routes/_LEARN.md`
4. `src/controllers/_LEARN.md`
5. `src/services/_LEARN.md`
6. (then drill into `ai/`, `jobs/`, `utils/`, `config/` as needed)
