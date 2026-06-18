import { api } from "./api";

export interface QueuedReportResponse {
  status: "queued";
  analysisRunId: string;
}

export interface AnalysisRunStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
}

export async function waitForAnalysisRun(
  analysisRunId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<AnalysisRunStatus> {
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);

  for (;;) {
    const run = await api.get<AnalysisRunStatus>(
      `/analysis-runs/${analysisRunId}`,
    );
    if (run.status === "completed") return run;
    if (run.status === "failed") {
      throw new Error(run.errorMessage || "Report generation failed.");
    }
    if (Date.now() > deadline) {
      throw new Error("Report generation timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
