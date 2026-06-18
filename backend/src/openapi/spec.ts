/**
 * OpenAPI 3.0 spec for the main ThoughtTracker backend.
 * Served at /api/openapi.json; rendered by Swagger UI at /api/docs.
 *
 * Hand-maintained rather than generated to keep the surface intentional.
 * When you change an endpoint, update the corresponding section here.
 */

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ThoughtTracker API",
    version: "1.0.0",
    description:
      "Evidence-backed transcript analysis for YouTube creators. " +
      "All AI conclusions trace back to a transcript chunk and an evidence quote. " +
      "Default providers use local/real services and fail clearly when required dependencies are missing.",
    contact: { name: "Jason Lin", url: "https://github.com/jason-lin-uo" },
    license: { name: "MIT", url: "/LICENSE" },
  },
  servers: [{ url: "http://localhost:4000", description: "Local dev" }],
  tags: [
    { name: "Health" },
    { name: "Dashboard" },
    { name: "Import Jobs" },
    { name: "Creator Onboarding" },
    { name: "Creators" },
    { name: "Videos" },
    { name: "Transcripts" },
    { name: "Topics" },
    { name: "Analysis" },
    { name: "Evidence" },
    { name: "Charts" },
    { name: "Reports" },
    { name: "Search" },
    { name: "Embeddings" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe",
        responses: {
          "200": {
            description: "?",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/system/status": {
      get: {
        tags: ["Health"],
        summary: "Service status + LLM budget/cache snapshot",
        responses: {
          "200": {
            description: "?",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SystemStatus" },
              },
            },
          },
        },
      },
    },
    "/api/dashboard": {
      get: {
        tags: ["Dashboard"],
        summary: "Dashboard counters + recent activity",
        responses: {
          "200": {
            description: "?",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Dashboard" },
              },
            },
          },
        },
      },
    },
    "/api/import-jobs": {
      get: {
        tags: ["Import Jobs"],
        summary: "List recent import jobs",
        responses: { "200": { description: "?" } },
      },
    },
    "/api/import-jobs/youtube-channel": {
      post: {
        tags: ["Import Jobs"],
        summary: "Start an async YouTube channel import",
        parameters: [
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateImportJobRequest" },
            },
          },
        },
        responses: {
          "202": { description: "Job queued" },
          "400": { description: "Invalid request" },
          "403": { description: "Admin PIN required" },
          "409": { $ref: "#/components/responses/IdempotencyInProgress" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/import-jobs/bulk-import": {
      post: {
        tags: ["Import Jobs"],
        summary:
          "Start an async bulk import from a pre-fetched transcript folder or inline payload",
        parameters: [
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BulkImportRequest" },
            },
          },
        },
        responses: {
          "202": { description: "Job queued" },
          "400": {
            description:
              "Invalid request (bad path, missing manifest, traversal attempt)",
          },
          "403": { description: "Admin PIN required" },
          "409": { $ref: "#/components/responses/IdempotencyInProgress" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/creator-onboarding/run": {
      post: {
        tags: ["Creator Onboarding"],
        summary: "Start the owner-only local creator onboarding pipeline",
        parameters: [
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreatorOnboardingRunRequest",
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Pipeline started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreatorOnboardingRun" },
              },
            },
          },
          "400": { description: "Invalid request" },
          "403": { description: "Admin PIN required" },
          "503": { description: "Pipeline unavailable on this machine" },
        },
      },
    },
    "/api/import-jobs/{jobId}": {
      get: {
        tags: ["Import Jobs"],
        summary: "Get an import job",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/import-jobs/{jobId}/items": {
      get: {
        tags: ["Import Jobs"],
        summary: "List per-video items inside an import",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/creators": {
      get: {
        tags: ["Creators"],
        summary: "List creators",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/creators/compare": {
      get: {
        tags: ["Creators"],
        summary: "Side-by-side comparison for 2-5 creators",
        parameters: [
          {
            name: "creatorIds",
            in: "query",
            required: true,
            schema: { type: "string" },
            description:
              "Comma-separated list of 2-5 creator ids or slugs. Order is preserved in the response.",
          },
        ],
        responses: {
          "200": {
            description: "?",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    creators: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          creatorId: { type: "string" },
                          name: { type: "string" },
                          slug: { type: "string" },
                          thumbnailUrl: { type: "string", nullable: true },
                          videoCount: { type: "integer" },
                          transcriptCount: { type: "integer" },
                          topicCount: { type: "integer" },
                          evidenceCount: { type: "integer" },
                        },
                      },
                    },
                    sharedTopics: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          topicId: { type: "string" },
                          name: { type: "string" },
                          slug: { type: "string" },
                          perCreator: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                creatorId: { type: "string" },
                                dominantStance: { type: "string" },
                                mentionCount: { type: "integer" },
                                videoCount: { type: "integer" },
                              },
                            },
                          },
                        },
                      },
                    },
                    timeline: {
                      type: "object",
                      properties: {
                        points: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              date: { type: "string" },
                              values: {
                                type: "object",
                                additionalProperties: {
                                  type: "number",
                                  nullable: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request — fewer than 2 or more than 5 ids",
          },
        },
      },
    },
    "/api/creators/{creatorId}": {
      get: {
        tags: ["Creators"],
        summary: "Get a creator",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/creators/{creatorId}/overview": {
      get: {
        tags: ["Creators"],
        summary:
          "Creator overview (stats, top topics, recent videos, latest report)",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/creators/{creatorId}/topics": {
      get: {
        tags: ["Creators"],
        summary: "Aggregated topic stats for a creator",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/videos": {
      get: {
        tags: ["Videos"],
        summary: "List & filter videos",
        parameters: [
          { name: "creatorId", in: "query", schema: { type: "string" } },
          { name: "topicId", in: "query", schema: { type: "string" } },
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "transcriptStatus",
            in: "query",
            schema: { $ref: "#/components/schemas/TranscriptStatus" },
          },
          {
            name: "analysisStatus",
            in: "query",
            schema: { $ref: "#/components/schemas/AnalysisStatus" },
          },
          {
            name: "stanceLabel",
            in: "query",
            schema: { $ref: "#/components/schemas/StanceLabel" },
          },
          {
            name: "confidenceLabel",
            in: "query",
            schema: { $ref: "#/components/schemas/ConfidenceLabel" },
          },
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "?",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PageOfVideos" },
              },
            },
          },
        },
      },
    },
    "/api/videos/{videoId}": {
      get: {
        tags: ["Videos"],
        summary: "Get a video",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/videos/{videoId}/transcript": {
      get: {
        tags: ["Transcripts"],
        summary: "Get a video's transcript",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { name: "includeChunks", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/videos/{videoId}/transcript/manual": {
      post: {
        tags: ["Transcripts"],
        summary: "Paste a manual transcript when auto isn't available",
        description:
          "Persists the transcript synchronously, then queues chunking + analysis off the request path. Returns 202 + { transcriptId, status }; poll the video's analysisStatus.",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ManualTranscript" },
            },
          },
        },
        responses: {
          "202": { description: "Accepted; chunking + analysis queued" },
          "400": { description: "Invalid" },
          "404": { description: "Video not found" },
        },
      },
    },
    "/api/videos/{videoId}/transcript/rechunk": {
      post: {
        tags: ["Transcripts"],
        summary: "Re-chunk an existing transcript (async)",
        description:
          "Queues re-chunking + analysis off the request path. Returns 202 + { status }.",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "202": { description: "Accepted; re-chunk + analysis queued" },
          "400": { description: "Video has no transcript yet" },
          "404": { description: "Video not found" },
        },
      },
    },
    "/api/topics": {
      get: {
        tags: ["Topics"],
        summary: "List topics",
        responses: { "200": { description: "?" } },
      },
      post: {
        tags: ["Topics"],
        summary: "Create a user topic",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { description: "Invalid" },
        },
      },
    },
    "/api/analysis/creators/{creatorId}/run": {
      post: {
        tags: ["Analysis"],
        summary: "Queue creator-level analysis (timelines)",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "202": { description: "Queued" } },
      },
    },
    "/api/analysis/videos/{videoId}/run": {
      post: {
        tags: ["Analysis"],
        summary: "Queue video-level analysis",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "202": { description: "Queued" } },
      },
    },
    "/api/analysis-runs/{analysisRunId}": {
      get: {
        tags: ["Analysis"],
        summary: "Get an analysis run record",
        parameters: [
          {
            name: "analysisRunId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/creators/{creatorId}/topics/{topicId}/timeline": {
      get: {
        tags: ["Analysis"],
        summary: "Creator/topic timeline",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "topicId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/creators/{creatorId}/topics/{topicId}/analysis": {
      get: {
        tags: ["Analysis"],
        summary: "Full topic-analysis page payload",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "topicId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/evidence": {
      get: {
        tags: ["Evidence"],
        summary: "List analyzed transcript chunks (evidence)",
        parameters: [
          { name: "creatorId", in: "query", schema: { type: "string" } },
          { name: "topicId", in: "query", schema: { type: "string" } },
          { name: "videoId", in: "query", schema: { type: "string" } },
          {
            name: "stanceLabel",
            in: "query",
            schema: { $ref: "#/components/schemas/StanceLabel" },
          },
          {
            name: "confidenceLabel",
            in: "query",
            schema: { $ref: "#/components/schemas/ConfidenceLabel" },
          },
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/evidence/{analysisId}": {
      get: {
        tags: ["Evidence"],
        summary: "Get evidence detail with previous/main/next chunk",
        parameters: [
          {
            name: "analysisId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/charts/stance-over-time": {
      get: {
        tags: ["Charts"],
        summary:
          "Monthly average stance score for one creator (optionally one topic)",
        parameters: [
          {
            name: "creatorId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          { name: "topicId", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "?" },
          "400": { description: "creatorId required" },
        },
      },
    },
    "/api/charts/topic-frequency": {
      get: {
        tags: ["Charts"],
        summary: "Monthly topic-mention frequency for one creator",
        parameters: [
          {
            name: "creatorId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/reports": {
      get: {
        tags: ["Reports"],
        summary: "List generated reports (paginated)",
        parameters: [
          { name: "creatorId", in: "query", schema: { type: "string" } },
          { name: "topicId", in: "query", schema: { type: "string" } },
          {
            name: "reportType",
            in: "query",
            schema: { $ref: "#/components/schemas/ReportType" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: { "200": { description: "?" } },
      },
    },
    "/api/reports/bulk-delete": {
      post: {
        tags: ["Reports"],
        summary: "Delete reports by id-set or all of them (admin)",
        parameters: [
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["ids"],
                    properties: {
                      ids: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 1,
                      },
                    },
                  },
                  {
                    type: "object",
                    required: ["all"],
                    properties: { all: { type: "boolean", enum: [true] } },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": { description: "Deleted; returns { deleted: number }" },
          "400": { description: "Invalid body" },
        },
      },
    },
    "/api/reports/reset-starter": {
      post: {
        tags: ["Reports"],
        summary:
          "Reset all reports to the default Marques Brownlee foldable-phone report (admin)",
        parameters: [
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "Reports reset; returns { deleted, report } for the featured default report",
          },
          "403": { description: "Admin PIN required" },
          "404": { description: "Starter creator/topic missing" },
        },
      },
    },
    "/api/reports/{reportId}": {
      get: {
        tags: ["Reports"],
        summary: "Get a report",
        parameters: [
          {
            name: "reportId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/reports/creator/{creatorId}/generate": {
      post: {
        tags: ["Reports"],
        summary: "Queue async generation of a creator summary report",
        description:
          "Enqueues generation and returns 202 + { analysisRunId }. Poll GET /api/analysis-runs/{analysisRunId} until status is completed/failed, then GET /api/reports?creatorId=… for the report.",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Creator id or slug",
          },
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        responses: {
          "202": {
            description: "Generation queued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QueuedRun" },
              },
            },
          },
          "403": { description: "Admin PIN required" },
          "404": { description: "Creator not found" },
          "409": { $ref: "#/components/responses/IdempotencyInProgress" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/reports/creator/{creatorId}/topic/{topicId}/generate": {
      post: {
        tags: ["Reports"],
        summary: "Queue async generation of a topic summary report",
        description:
          "Enqueues generation and returns 202 + { analysisRunId }. Poll GET /api/analysis-runs/{analysisRunId}.",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Creator id or slug",
          },
          {
            name: "topicId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Topic id or slug",
          },
          {
            name: "X-Admin-Pin",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        responses: {
          "202": {
            description: "Generation queued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QueuedRun" },
              },
            },
          },
          "403": { description: "Admin PIN required" },
          "404": { description: "Creator or topic not found" },
          "409": { $ref: "#/components/responses/IdempotencyInProgress" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/search": {
      get: {
        tags: ["Search"],
        summary: "Multi-entity search",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "?" },
          "400": { description: "q required" },
        },
      },
    },
    "/api/embeddings/creator/{creatorId}/generate": {
      post: {
        tags: ["Embeddings"],
        summary: "Re-embed all chunks for a creator",
        parameters: [
          {
            name: "creatorId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "202": { description: "Queued" } },
      },
    },
  },
  components: {
    /*
     * Reusable header parameters. `Idempotency-Key` is honored on the mutating
     * endpoints (see middleware/idempotency.ts): within a 60s window a repeated
     * key replays the cached response; a concurrent in-flight duplicate gets 409.
     */
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string", maxLength: 200 },
        description:
          "Opt-in dedup key. A repeat within the 60s window replays the first response; a concurrent duplicate returns 409. Max 200 chars.",
      },
    },
    /* Reusable responses for cross-cutting middleware (rate limiting + idempotency). */
    responses: {
      RateLimited: {
        description: "Too many requests — the per-IP rate limit was exceeded.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "RATE_LIMITED" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      IdempotencyInProgress: {
        description:
          "A request with the same Idempotency-Key is already in progress.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "CONFLICT" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
    schemas: {
      QueuedRun: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["queued"] },
          analysisRunId: {
            type: "string",
            description: "Poll GET /api/analysis-runs/{analysisRunId}.",
          },
        },
      },
      BulkImportRequest: {
        oneOf: [
          {
            type: "object",
            required: ["folderPath"],
            properties: {
              folderPath: {
                type: "string",
                description:
                  "Server-side path INSIDE the bulk-import allowlist root (BULK_IMPORT_ROOT).",
              },
            },
          },
          {
            type: "object",
            required: ["inline"],
            properties: {
              inline: {
                type: "object",
                required: ["manifest", "transcripts"],
                properties: {
                  manifest: { type: "object" },
                  transcripts: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
          },
        ],
      },
      StanceLabel: {
        type: "string",
        enum: [
          "supportive",
          "opposed",
          "neutral",
          "mixed",
          "unclear",
          "insufficient_evidence",
        ],
      },
      ConfidenceLabel: { type: "string", enum: ["low", "medium", "high"] },
      TrendLabel: {
        type: "string",
        enum: [
          "stable",
          "gradual_shift",
          "abrupt_shift",
          "mixed",
          "insufficient_data",
        ],
      },
      TranscriptStatus: {
        type: "string",
        enum: ["pending", "available", "unavailable", "failed", "manual"],
      },
      AnalysisStatus: {
        type: "string",
        enum: ["pending", "processing", "completed", "failed"],
      },
      ReportType: {
        type: "string",
        enum: ["creator_summary", "topic_summary"],
      },

      CreateImportJobRequest: {
        type: "object",
        required: ["channelUrl", "requestedLimit"],
        properties: {
          channelUrl: { type: "string" },
          requestedLimit: { type: "integer", enum: [10, 25, 50, 100] },
          creatorNameOverride: { type: "string" },
        },
      },
      CreatorOnboardingRunRequest: {
        type: "object",
        required: ["channelUrls", "requestedLimit"],
        properties: {
          channelUrls: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" },
          },
          requestedLimit: { type: "integer", enum: [10, 25, 50, 100] },
        },
      },
      CreatorOnboardingRun: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["started"] },
          processId: { type: "integer", nullable: true },
          statusPath: { type: "string" },
          logDir: { type: "string" },
        },
      },
      ManualTranscript: {
        type: "object",
        required: ["rawText"],
        properties: {
          rawText: { type: "string", minLength: 20 },
          language: { type: "string", default: "en" },
          sourceType: {
            type: "string",
            enum: ["manual_paste", "manual_upload"],
            default: "manual_paste",
          },
        },
      },
      PageOfVideos: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/Video" },
          },
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      Video: {
        type: "object",
        properties: {
          id: { type: "string" },
          creatorId: { type: "string" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          publishedAt: { type: "string", format: "date-time", nullable: true },
          durationSeconds: { type: "integer", nullable: true },
          thumbnailUrl: { type: "string", nullable: true },
          sourceUrl: { type: "string" },
          sourceVideoId: { type: "string" },
          transcriptStatus: { $ref: "#/components/schemas/TranscriptStatus" },
          analysisStatus: { $ref: "#/components/schemas/AnalysisStatus" },
        },
      },
      Dashboard: {
        type: "object",
        properties: {
          stats: {
            type: "object",
            properties: {
              creators: { type: "integer" },
              videos: { type: "integer" },
              transcripts: { type: "integer" },
              topics: { type: "integer" },
              evidence: { type: "integer" },
            },
          },
          featuredInsight: {
            type: "object",
            nullable: true,
            description:
              "Hero card: the highest-scoring analyzed timeline. Deep-links to the backing topic report when one exists (reportId/reportTitle set), else the topic page. Null when nothing has been analyzed.",
            properties: {
              creatorId: { type: "string" },
              creatorName: { type: "string" },
              topicId: { type: "string" },
              topicName: { type: "string" },
              trendLabel: { $ref: "#/components/schemas/TrendLabel" },
              summary: { type: "string", nullable: true },
              reportId: { type: "string", nullable: true },
              reportTitle: { type: "string", nullable: true },
            },
          },
          recentJobs: { type: "array", items: { type: "object" } },
          recentCreators: { type: "array", items: { type: "object" } },
          recentReports: { type: "array", items: { type: "object" } },
        },
      },
      SystemStatus: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          service: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          env: { type: "object" },
          llm: {
            type: "object",
            properties: {
              budget: { type: "object" },
              cache: { type: "object" },
              limits: { type: "object" },
            },
          },
        },
      },
    },
  },
} as const;
