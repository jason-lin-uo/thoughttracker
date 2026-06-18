/**
 * Tests for POST /api/reports/bulk-delete — single, multi, and delete-all
 * paths plus the invalid-body 400.
 *
 * `prisma.report.deleteMany` is mocked so these stay DB-free: the suite runs
 * test files as parallel forks against ONE shared database, and a real
 * `{ all: true }` would delete reports other files created and assert on. The
 * mock lets us verify the controller's where-clause + response without touching
 * shared data. The admin gate is open in mock/dev (no PIN set).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";

const app = buildApp();

afterEach(() => vi.restoreAllMocks());

describe("POST /api/reports/bulk-delete", () => {
  it("400s on an empty/invalid body", async () => {
    const res = await request(app).post("/api/reports/bulk-delete").send({});
    expect(res.status).toBe(400);
  });

  it("400s on an empty ids array", async () => {
    const res = await request(app)
      .post("/api/reports/bulk-delete")
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("deletes a specific set of report ids", async () => {
    const spy = vi
      .spyOn(prisma.report, "deleteMany")
      .mockResolvedValue({ count: 2 });
    const res = await request(app)
      .post("/api/reports/bulk-delete")
      .send({ ids: ["r1", "r2"] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(spy).toHaveBeenCalledWith({ where: { id: { in: ["r1", "r2"] } } });
  });

  it("deletes every report with { all: true }", async () => {
    const spy = vi
      .spyOn(prisma.report, "deleteMany")
      .mockResolvedValue({ count: 7 });
    const res = await request(app)
      .post("/api/reports/bulk-delete")
      .send({ all: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(7);
    expect(spy).toHaveBeenCalledWith({ where: {} });
  });
});
