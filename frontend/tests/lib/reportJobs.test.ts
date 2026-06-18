import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAnalysisRun } from "../../src/lib/reportJobs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function response(body: unknown): Response {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("report job polling", () => {
  it("returns once the analysis run completes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ id: "run-1", status: "processing", errorMessage: null }),
      )
      .mockResolvedValueOnce(
        response({ id: "run-1", status: "completed", errorMessage: null }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const promise = waitForAnalysisRun("run-1", { intervalMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(promise).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the analysis error when the run fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        id: "run-1",
        status: "failed",
        errorMessage: "topic_report_invalid_llm_schema",
      }),
    ) as typeof fetch;

    await expect(
      waitForAnalysisRun("run-1", { intervalMs: 1 }),
    ).rejects.toThrow("topic_report_invalid_llm_schema");
  });

  it("throws a default report error when a failed run has no message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        id: "run-1",
        status: "failed",
        errorMessage: null,
      }),
    ) as typeof fetch;

    await expect(
      waitForAnalysisRun("run-1", { intervalMs: 1 }),
    ).rejects.toThrow("Report generation failed.");
  });

  it("times out if the run never reaches a terminal state", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        id: "run-1",
        status: "processing",
        errorMessage: null,
      }),
    ) as typeof fetch;

    await expect(
      waitForAnalysisRun("run-1", { intervalMs: 1, timeoutMs: -1 }),
    ).rejects.toThrow("Report generation timed out.");
  });
});
