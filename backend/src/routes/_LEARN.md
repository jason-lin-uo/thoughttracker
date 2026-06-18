# \_LEARN.md — `backend/src/routes/`

> Thirteen tiny files. Each one wires URL paths to controller functions.
> If `controllers/` is the kitchen counters, `routes/` is the **maitre
> d'** pointing each customer to the right counter.

---

## The story of this folder

Each file in this folder is an Express **`Router`** — think of it as a
small section of the maitre d's seating chart that owns a group of
related URLs. The file imports the corresponding controller functions
and mounts them at specific paths (mounting = "pinning a URL to a
handler so the right counter gets the order").

The whole point is **separation**:

- The **shape of the URL space** (which URL hits which function) lives
  here.
- The **work** (what each function does) lives in `controllers/`.

This separation is small but high-leverage. When you ask "what
endpoints does this app have" you can answer it by reading the
thirteen route files — they're each 5-20 lines long. You don't need to
open a single controller file.

---

## The shape of every routes file

Every file looks the same:

```ts
import { Router } from "express";
import { listCreators, getCreator, ... } from "../controllers/creators.controller";

export const creatorsRouter = Router();

creatorsRouter.get("/creators", listCreators);
creatorsRouter.get("/creators/compare", compareCreators); // ← MUST be before /:id
creatorsRouter.get("/creators/:creatorId", getCreator);
creatorsRouter.get("/creators/:creatorId/overview", getCreatorOverview);
creatorsRouter.get("/creators/:creatorId/topics", getCreatorTopics);
```

Three things every file does:

1. `import { Router } from "express"` — gets the Router constructor
2. `import { ... } from "../controllers/X.controller"` — pulls in the
   handler functions
3. `router.METHOD(path, handler)` — wires URLs to handlers

`app.ts` then does:

```ts
app.use("/api", creatorsRouter);
```

…which prefixes every URL in the router with `/api`.

---

## The thirteen files

| File                          | URL prefix (after `/api`)           | Controller                        |
| ----------------------------- | ----------------------------------- | --------------------------------- |
| `dashboard.routes.ts`         | `/dashboard`, `/system/status`      | `dashboard.controller.ts`         |
| `creators.routes.ts`          | `/creators*`                        | `creators.controller.ts`          |
| `videos.routes.ts`            | `/videos*`                          | `videos.controller.ts`            |
| `transcripts.routes.ts`       | `/videos/:id/transcript*`           | `transcripts.controller.ts`       |
| `topics.routes.ts`            | `/topics*`                          | `topics.controller.ts`            |
| `evidence.routes.ts`          | `/evidence*`                        | `evidence.controller.ts`          |
| `reports.routes.ts`           | `/reports*`                         | `reports.controller.ts`           |
| `analysis.routes.ts`          | `/analysis*`, `/analysis-runs*`     | `analysis.controller.ts`          |
| `charts.routes.ts`            | `/charts*`                          | `charts.controller.ts`            |
| `search.routes.ts`            | `/search*`                          | `search.controller.ts`            |
| `embeddings.routes.ts`        | `/embeddings*`                      | `embeddings.controller.ts`        |
| `importJobs.routes.ts`        | `/import-jobs*`                     | `importJobs.controller.ts`        |
| `creatorOnboarding.routes.ts` | `/creator-onboarding/run`           | `creatorOnboarding.controller.ts` |

---

## The one ordering rule that bites people

Express matches routes **top-to-bottom**. If you have:

```ts
creatorsRouter.get("/creators/:creatorId", getCreator);
creatorsRouter.get("/creators/compare", compareCreators); // ← never reached
```

…then a `GET /api/creators/compare` request matches the **first** route
because `:creatorId` accepts any string (the colon means "this slot is
a wildcard — anything goes here"). The compare handler is never called;
the system tries to fetch a creator with `id="compare"` and returns 404
with a confusing "Creator not found."

**The fix is order.** Specific routes go *before* parameterized
catch-all routes (parameterized just means "has a wildcard slot," like
`:creatorId`):

```ts
creatorsRouter.get("/creators/compare", compareCreators); // ← specific first
creatorsRouter.get("/creators/:creatorId", getCreator); // ← parameterized after
```

This bit us hard during initial development; ADR-0001 mentions it in
the gotchas list. It's documented in
`REVERSE_ENGINEERED_PROMPT.md` gotcha #18.

Similar pattern applies to `bulk-import` having to land before
`/:jobId` in `importJobs.routes.ts`, and `/reports/bulk-delete` is kept
before `/reports/:reportId` in `reports.routes.ts` (defensively — they're
different methods, so here it's habit rather than strictly required).

A separate concern from ordering: **mutating** routes are admin-gated.
`reports.routes.ts` attaches `requireAdmin` to the report generate
endpoints and to `POST /reports/bulk-delete`; `creatorOnboarding.routes.ts`
attaches `requireCreatorOnboardingPin` to `POST /creator-onboarding/run`.
Route files can wire middleware inline:
`router.post("/url", requireAdmin, handler)`.

---

## How routes/ connects to everything else

```
app.ts
 │
 │ app.use("/api", <each router>)
 │
 ▼
routes/ (12 small files, each owning a URL prefix)
 │
 │ router.get("/url", handlerFunction)
 │
 ▼
controllers/ (one file per resource, one fn per endpoint)
```

That's the whole architecture of this layer. Each `routes/` file
is the binding glue between a URL and a controller function. The
binding is one-directional — routes import controllers but controllers
never import routes.

---

## "Where do I look when X happens"

| You want to fix...                              | Open...                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| New URL needs to exist                          | The matching `routes/*.routes.ts` file, plus add the controller function                   |
| Existing URL returns 404                        | The matching `routes/*.routes.ts` — likely an ordering issue or the route isn't registered |
| URL matched but handler is wrong one            | Same — check the order of `router.get(...)` declarations                                   |
| Need to add middleware to one specific endpoint | Add it inline: `router.get("/url", middleware1, middleware2, handler)`                     |
