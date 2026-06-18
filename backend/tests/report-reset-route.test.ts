import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/starterReport.service", () => ({
  resetReportsToStarter: vi.fn(),
}));

import { buildApp } from "../src/app";
import { resetReportsToStarter } from "../src/services/starterReport.service";

const app = buildApp();

beforeEach(() => {
  vi.mocked(resetReportsToStarter).mockReset();
});

describe("POST /api/reports/reset-starter", () => {
  it("resets reports to the clean one-report state", async () => {
    vi.mocked(resetReportsToStarter).mockResolvedValue({
      deleted: 3,
      report: {
        id: "starter-report",
        title:
          "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
        summary: "Starter summary",
        creatorId: "mkbhd-id",
        topicId: "foldable-id",
        reportType: "topic_summary",
      },
    });

    const res = await request(app).post("/api/reports/reset-starter").send();

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(res.body.report.title).toBe(
      "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
    );
    expect(resetReportsToStarter).toHaveBeenCalledTimes(1);
  });

  it("passes reset failures to the error handler", async () => {
    vi.mocked(resetReportsToStarter).mockRejectedValueOnce(
      new Error("starter reset failed"),
    );

    const res = await request(app).post("/api/reports/reset-starter").send();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
    expect(res.body.message).toBe("Internal server error");
    expect(resetReportsToStarter).toHaveBeenCalledTimes(1);
  });
});
