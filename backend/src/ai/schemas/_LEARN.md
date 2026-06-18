# \_LEARN.md - `backend/src/ai/schemas/`

> Zod schemas for every LLM JSON contract. They are the guardrail between
> unpredictable model output and the strongly typed product database.

## Why This Folder Exists

LLMs can return JSON that is almost right but still unsafe:

- missing required fields
- label names that do not match Prisma enums
- numbers returned as strings
- markdown fences around JSON
- extra prose mixed into a response

Every service validates model output before it writes to the database or sends
data to the UI. If validation fails, the caller treats that as a real provider
failure or a conservative "no usable result" condition. Runtime code should not
invent labels or reports to hide a bad provider response.

## Files

- `topicDetection.schema.ts`: validates controlled-taxonomy topic detection.
- `stanceClassification.schema.ts`: validates per-chunk stance output.
- `videoTopicSummary.schema.ts`: validates per-video topic summaries.
- `creatorTimeline.schema.ts`: validates per-creator trend/timeline output.
- `report.schema.ts`: validates creator and topic report pages.

## Standard Pattern

```ts
const raw = await runLlm(...);
const parsed = SomeSchema.safeParse(raw.json);
if (!parsed.success) {
 logger.warn("LLM returned malformed JSON", { issues: parsed.error.issues });
 return conservativeResultOrThrow();
}
const data = parsed.data;
```

The important bit: after `safeParse` succeeds, TypeScript and runtime behavior
agree about the response shape. That keeps downstream services boring,
predictable, and safe.

## Debug Map

| Symptom                  | Start Here                                                           |
| ------------------------ | -------------------------------------------------------------------- |
| Provider output rejected | Matching schema file plus the prompt that generated the response     |
| DB enum write failed     | Check the schema enum and Prisma enum agree                          |
| UI missing report fields | `report.schema.ts`, report prompt, and report rendering code         |
| Need a new LLM field     | Add it to the prompt, schema, service mapper, tests, and UI consumer |
