# \_LEARN.md — `backend/src/`

> Where the actual cooking happens. Each subfolder is a station; `app.ts`
> and `server.ts` are the doors customers walk through.

---

## The story of this folder

If `backend/` is the whole kitchen, `src/` is the working part — the
prep counters, stoves, fryers, the chef. Two files at the top of `src/`
are special: **`app.ts`** is "the design of the kitchen" (which stations
exist, in what order food moves through them) and **`server.ts`** is "the
person who unlocks the kitchen door at 9 AM and locks it again at
midnight" (boots the HTTP server, handles graceful shutdown).

Everything else in `src/` is a subfolder — a station in the kitchen. Each
one has its own `_LEARN.md` explaining what happens there.

---

## The two top-level files

### `app.ts`

**What it is:** the **factory function** (think of it as a recipe that, when followed, produces an assembled kitchen) that builds the Express
application object — the assembled kitchen, ready to take orders. It
doesn't actually open for business; it just wires everything together so
that `server.ts` (or a test) can start it.

**Why it exists as a separate file from `server.ts`:** so tests can build
the app without actually opening a port. Every test in
`tests/controllers.test.ts` calls `const app = buildApp()` and then uses
`supertest(app)` to send fake HTTP requests directly into the Express
machinery — no real network involved. This pattern (factory + entry
point) is what lets the backend have 100% line coverage on its routing
layer.

**Story:** imagine the kitchen on opening day. The owner walks in and
**arranges everything in order**: where the security guard stands
(middleware), where each cook station goes (routes), what to do when
food comes out wrong (error handler). That arrangement is what `app.ts`
returns — a fully arranged kitchen, but nobody's cooking yet.

The order matters:

1. **CORS first** — decide which frontends are allowed in
2. **JSON body parsing** — accept JSON requests
3. **`requestIdAndLogger`** — stamp every request with an ID
4. **`httpLogger`** — log it via Pino
5. **`requestTimeout`** — give every request a deadline
6. **`apiRateLimiter`** + **`expensiveRateLimiter`** — block abuse
7. **`idempotencyMiddleware`** — handle the `Idempotency-Key` header
8. **The routes themselves** — `/api/dashboard`, `/api/creators`, etc.
9. **`errorHandler`** — catches anything that threw
10. **404 fallback** — last resort if no route matched

Middleware order (in plain terms: the order the guards and greeters stand in along the kitchen entrance) is a thing engineers obsess over. Putting the rate
limiter *after* idempotency would mean idempotency-cached responses can
still be rate-limited (in plain terms: even a "we already made this dish, here's the saved plate" reply would still count against the customer's order limit). Putting CORS *after* the body parser would let
requests load 2MB of JSON before being rejected as cross-origin — like letting someone unpack a giant grocery bag onto the counter before telling them they're in the wrong restaurant. Every
position is deliberate; see ADR-0007 if you ever forget why.

**Used by:** `server.ts` (production), every test that needs an Express
app (`tests/*.test.ts`).

---

### `server.ts`

**What it is:** the **entry point** — the file Node.js actually runs when
the backend starts. It calls `buildApp()`, opens the HTTP port, sets up
graceful-shutdown handling for SIGTERM/SIGINT, and never returns until
the process is killed.

**Why it exists separately from `app.ts`:** see above — splitting the
factory from the bootstrap is what makes the app testable. Also:
graceful shutdown logic is operationally tricky (drain connections,
disconnect Prisma cleanly, hard-exit after 20s), and isolating it in one
small file keeps it auditable.

**Story:** if `app.ts` is "arrange the kitchen," `server.ts` is
"unlock the door at 9 AM." It also handles **closing time**: when the
operating system says "shut down" (SIGTERM — in plain terms, the polite "please wrap up" tap on the shoulder, typical when a container
orchestrator wants to redeploy — that's the building manager swapping the kitchen out for a freshly remodeled one), it:

1. Stops accepting new connections.
2. Lets the in-flight requests finish (server.close).
3. Disconnects from Postgres cleanly.
4. If any of the above takes longer than 20 seconds, hard-exits so the
   orchestrator doesn't wait forever.

This 20-second hard-exit safety net exists because if a single hung
request keeps the process alive forever, deploys get stuck and someone
has to manually intervene. Better to drop the hung request than to
block production.

**Used by:** the `Dockerfile` (which runs `node dist/server.js`),
local dev (`tsx watch src/server.ts`), and the `shutdown.test.ts` test
file (which verifies the graceful-shutdown logic).

---

## The subfolders (each has its own `_LEARN.md`)

In the order you'd want to read them to build a mental model bottom-up:

| Folder         | What it is                       | Read in this order              |
| -------------- | -------------------------------- | ------------------------------- |
| `config/`      | env vars + Prisma client         | **1** — foundations             |
| `utils/`       | small reusable helpers           | **2** — toolbox                 |
| `ai/`          | LLM client + budget + cache      | **3** — the brain's brain       |
| `services/`    | business logic                   | **4** — the chef's recipes      |
| `jobs/`        | background async work            | **5** — the prep team           |
| `controllers/` | HTTP handlers per resource       | **6** — order takers            |
| `routes/`      | URL → controller wiring          | **7** — host station            |
| `middleware/`  | cross-cutting Express middleware | **8** — security guard + logger |
| `openapi/`     | auto-generated API spec          | **9** — the public menu         |

---

## How `app.ts` connects to everything else

`app.ts` is the **dependency graph in code form**. Reading its imports
top-down literally tells you the full architecture:

```ts
// 1. The thing it builds is an Express app, served by --
import express from "express";

// 2. -- which uses these cross-cutting middlewares:
import { requestIdAndLogger, httpLogger } from "./middleware/requestId";
import { errorHandler } from "./middleware/errorHandler";
import { apiRateLimiter, expensiveRateLimiter } from "./middleware/rateLimiter";
import { requestTimeout } from "./middleware/timeout";
import { idempotencyMiddleware } from "./middleware/idempotency";

// 3. -- and these routers, each wrapping a controller:
import { dashboardRouter } from "./routes/dashboard.routes";
import { importJobsRouter } from "./routes/importJobs.routes";
// ... and ten more ...

// 4. -- and one OpenAPI spec:
import { openapiSpec } from "./openapi/spec";
```

Every other file in `src/` is reached transitively from one of those.
Controllers call services, services call AI clients, AI clients call
provider APIs. The whole tree branches out from `app.ts`.

---

## "Where do I look when X happens"

| You want to fix...                                     | Open...                                                |
| ------------------------------------------------------ | ------------------------------------------------------ |
| A 404 response that should be a 200                    | `routes/` (URL probably not wired) then `controllers/` |
| Wrong data shape in a JSON response                    | `controllers/` (last touchpoint before the response)   |
| Wrong calculation / wrong stance label                 | `services/` (the actual logic)                         |
| Wrong LLM response                                     | `ai/`                                                  |
| Wrong job status (analysis stuck on "processing")      | `jobs/`                                                |
| Auth / rate-limit / logging issue                      | `middleware/`                                          |
| "I'm getting a Prisma error"                           | `config/prisma.ts` or your query in a service          |
| Anything generic (date math, retries, slug generation) | `utils/`                                               |

That map is the single most useful navigation tool in the backend.
