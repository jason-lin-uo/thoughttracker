# \_LEARN.md - `backend/src/openapi/`

> One file. The public menu of every URL the backend serves.

---

## The story of this folder

Picture the restaurant has just one printed menu. Every dish, every
ingredient, every price, in one document. Customers consult it before
ordering. Health inspectors verify the kitchen against it. New cooks
read it to learn what's served.

That's what `spec.ts` is - a machine-readable menu of every HTTP
endpoint, request shape, response shape, and error code the backend
supports. It's an **OpenAPI 3** document (OpenAPI is the industry's
standard "menu format" - any tool that reads it knows how to draw an
interactive menu, generate client code, or run health checks against
the API).

The doc is served at `/api/openapi.json` so anyone (a frontend dev, an
auto-generated client, a Swagger UI viewer, a recruiter) can fetch it
and immediately know what the API can do.

---

## File-by-file

### `spec.ts`

**What it is:** a TypeScript file that builds an OpenAPI 3.0 document
in memory and exports it. Uses a thin in-house schema helper to
declare paths, schemas, error responses without depending on a heavy
codegen library (codegen = "code-generation," tools that write a
bunch of code for you automatically; we skipped those because they're
overkill for a menu this small).

**Why it exists:** the alternatives were:

1. **No spec at all** - bad; clients have to read source to learn the
   API.
2. **Hand-write a YAML/JSON file** - bad; drifts out of sync with the
   actual code instantly.
3. **Use a heavy library like NestJS Swagger** - overkill for the
   project's size.
4. **Use Zod-to-OpenAPI** - nice, but requires Zod schemas on every
   endpoint, which we don't have.

The chosen path: a small TypeScript file that mirrors the route
structure, written by hand but co-located with the code. It's not
auto-generated, so it can drift - but it's short enough that the
drift is reviewable in any PR that adds/changes an endpoint.

**What's in the document:**

- Every URL the API serves
- The HTTP method, parameters, request body schema
- The response body schema (200 happy path / 202 for async queue
  endpoints) and error response shapes (400, 403, 404, 409, 429, 503)
- Schemas for the major DTO types (DTO = "data transfer object," in
  plain terms: the shape of an object as it travels over the wire,
  like the standard form a recipe card takes when passed between
  counters) - Creator, Video, Topic, Report, ImportJob, etc.
- Recently-added surface worth knowing: `GET /api/reports` is paginated,
  `POST /api/reports/bulk-delete` deletes by id-set or all (admin),
  `POST /api/reports/reset-starter` restores the clean saved-report state
  (admin), report generation is async (202 + `QueuedRun { analysisRunId }`),
  and the `Dashboard` schema includes the nullable `featuredInsight` hero.

**Served at:** `/api/openapi.json` - the `app.ts` mounts this at that
URL. Swagger UI can be pointed at it for interactive exploration.

**Used by:** anyone reading the API spec (humans or tools). The
frontend doesn't read it at runtime; the frontend's type definitions
(`frontend/src/lib/types.ts`) are hand-maintained to match.

---

## How `openapi/` connects to everything else

```
app.ts
 |
 +-- app.use("/api/openapi.json", (req, res) => res.json(openapiSpec))
 |
 v
openapi/spec.ts
 |
 v
A static OpenAPI 3.0 JSON document at request time
```

This folder is **outbound-only**. It documents what other folders do
but doesn't consume from them at runtime. The "drift risk" is: if you
add a new endpoint in `routes/`/`controllers/`, you should also add
it here. The reverse-engineered-prompt section 2.3 lists every
endpoint, which makes this easier to audit.

---

## "Where do I look when X happens"

| You want to fix...                       | Open...                                                  |
| ---------------------------------------- | -------------------------------------------------------- |
| Added a new endpoint, need it documented | `spec.ts` — add a path entry                             |
| OpenAPI spec out of sync with reality    | `spec.ts` (it's hand-maintained)                         |
| Need to expose Swagger UI                | `swagger-ui-express` is in the deps; wire it in `app.ts` |
