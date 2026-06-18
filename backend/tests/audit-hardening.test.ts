/**
 * Behavioral tests for the audit-hardening pass (THOUGHTTRACKER_AUDIT.md §9).
 *
 * These assert the FIXED behavior of the high-signal findings rather than just
 * touching lines:
 * - §9: GET /api/creators/:slug/topics works for a slug (was id-only).
 * - §9: invalid enum query params return 400, not 500.
 * - §9 / H3: mutating routes are admin-gated (auth-negative when a PIN is set).
 * - D1 / S0-1: the HNSW index on Embedding.vector actually exists.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import {
  createCreatorTopicSummaryFixture,
  deleteCreatorTopicSummaryFixture,
} from "./testHelpers";
import { hnswIndexExists } from "../prisma/setup-db";
import { slugify } from "../src/utils/slugify";

const app = buildApp();

describe("audit §9 — getCreatorTopics resolves a slug", () => {
  let fixture: Awaited<ReturnType<typeof createCreatorTopicSummaryFixture>>;
  let slug = "";

  beforeAll(async () => {
    fixture = await createCreatorTopicSummaryFixture("slug-topics");
    const creator = await prisma.creator.findUniqueOrThrow({
      where: { id: fixture.creatorId },
      select: { slug: true },
    });
    slug = creator.slug;
  });

  afterAll(async () => {
    if (fixture) await deleteCreatorTopicSummaryFixture(fixture);
  });

  it("returns the same topics whether addressed by id or slug", async () => {
    const byId = await request(app).get(
      `/api/creators/${fixture.creatorId}/topics`,
    );
    const bySlug = await request(app).get(`/api/creators/${slug}/topics`);
    expect(byId.status).toBe(200);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.items.length).toBeGreaterThan(0);
    expect(bySlug.body.items.length).toBe(byId.body.items.length);
  });

  it("404s for a creator slug/id that doesn't resolve", async () => {
    const res = await request(app).get(`/api/creators/no-such-creator/topics`);
    expect(res.status).toBe(404);
  });
});

describe("audit §9 — invalid enum query params return 400, not 500", () => {
  it("GET /api/videos?transcriptStatus=bogus → 400", async () => {
    const res = await request(app)
      .get("/api/videos")
      .query({ transcriptStatus: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
  });

  it("GET /api/videos?stanceLabel=bogus → 400", async () => {
    const res = await request(app)
      .get("/api/videos")
      .query({ stanceLabel: "bogus" });
    expect(res.status).toBe(400);
  });

  it("GET /api/evidence?confidenceLabel=bogus → 400", async () => {
    const res = await request(app)
      .get("/api/evidence")
      .query({ confidenceLabel: "bogus" });
    expect(res.status).toBe(400);
  });

  it("GET /api/reports?reportType=bogus → 400", async () => {
    const res = await request(app)
      .get("/api/reports")
      .query({ reportType: "bogus" });
    expect(res.status).toBe(400);
  });

  it("a VALID enum value is still accepted (200)", async () => {
    const res = await request(app)
      .get("/api/videos")
      .query({ transcriptStatus: "available" });
    expect(res.status).toBe(200);
  });
});

describe("audit H3 — mutating routes are admin-gated when a PIN is configured", () => {
  let previousPin: string | undefined;

  beforeAll(() => {
    previousPin = process.env.ADMIN_ONBOARDING_PIN;
    process.env.ADMIN_ONBOARDING_PIN = "9182";
  });

  beforeEach(() => {
    process.env.ADMIN_ONBOARDING_PIN = "9182";
  });

  afterAll(() => {
    if (previousPin === undefined) delete process.env.ADMIN_ONBOARDING_PIN;
    else process.env.ADMIN_ONBOARDING_PIN = previousPin;
  });

  const mutatingRoutes: Array<{ name: string; method: "post"; path: string }> =
    [
      {
        name: "analysis video run",
        method: "post",
        path: "/api/analysis/videos/v1/run",
      },
      {
        name: "analysis creator run",
        method: "post",
        path: "/api/analysis/creators/c1/run",
      },
      {
        name: "manual transcript",
        method: "post",
        path: "/api/videos/v1/transcript/manual",
      },
      {
        name: "rechunk transcript",
        method: "post",
        path: "/api/videos/v1/transcript/rechunk",
      },
      { name: "create topic", method: "post", path: "/api/topics" },
      {
        name: "generate creator report",
        method: "post",
        path: "/api/reports/creator/c1/generate",
      },
      {
        name: "regenerate embeddings",
        method: "post",
        path: "/api/embeddings/creator/c1/generate",
      },
    ];

  for (const route of mutatingRoutes) {
    it(`rejects ${route.name} without the admin PIN (403)`, async () => {
      const res = await request(app)[route.method](route.path).send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it(`rejects ${route.name} with a WRONG admin PIN (403)`, async () => {
      const res = await request(app)
        [route.method](route.path)
        .set("x-admin-pin", "0000")
        .send({});
      expect(res.status).toBe(403);
    });
  }

  it("passes the PIN gate with the correct PIN (no longer 403)", async () => {
    /*
     * Correct PIN → the gate calls next(); the handler then runs and 404s on
     * the unknown creator. The point is it's NOT a 403 from the gate.
     */
    const res = await request(app)
      .post("/api/reports/creator/no-such-creator/generate")
      .set("x-admin-pin", "9182")
      .send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
});

describe("audit D1 / S0-1 — the HNSW vector index exists", () => {
  it("Embedding.vector has the HNSW cosine ANN index", async () => {
    expect(await hnswIndexExists(prisma)).toBe(true);
  });
});

describe("audit §7 — slugify never returns an empty string", () => {
  it("emoji/punctuation-only input yields a stable non-empty fallback slug", () => {
    const a = slugify("🎉🎉🎉");
    const b = slugify("!!!");
    expect(a).not.toBe("");
    expect(b).not.toBe("");
    /* Distinct inputs → distinct slugs (no empty-slug collision). */
    expect(a).not.toBe(b);
    /* Deterministic. */
    expect(slugify("🎉🎉🎉")).toBe(a);
  });
});
