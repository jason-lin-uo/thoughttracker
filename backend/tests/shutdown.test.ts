import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import path from "path";

/**
 * Spawns the backend in a child process and asserts that it:
 * 1. Reaches the "listening" log line
 * 2. On SIGINT, logs "shutting down" and exits within the 20s force-exit window
 * 3. Returns a clean exit code (0)
 *
 * This is the only test in the suite that needs a real Node process spawn —
 * the graceful-shutdown handler can't be exercised by supertest, which calls
 * the Express app in-process.
 */
describe("graceful shutdown", () => {
  it("exits 0 on SIGINT and logs shutdown", async () => {
    const serverPath = path.resolve(__dirname, "..", "src", "server.ts");
    const child = spawn("node", ["--import", "tsx", serverPath], {
      env: {
        ...process.env,
        PORT: "4099",
        NODE_ENV: "test",
        LOG_LEVEL: "info",
        AI_PROVIDER: "local",
        EMBEDDING_PROVIDER: "ml",
        YOUTUBE_PROVIDER: "youtube",
        STANCE_ANALYSIS_PROVIDER: "custom_ml",
        LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434",
        ML_CLASSIFIER_URL: "http://127.0.0.1:8000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));

    /* Wait until the server logs that it's listening. */
    await new Promise<void>((resolve, reject) => {
      /* Fail the wait if the server never logs "listening" within 15s. */
      const t = setTimeout(
        () => reject(new Error("server did not start in 15s")),
        15_000,
      );
      /* Poll stdout/stderr for the listening line, rejecting if the child exits first. */
      const check = () => {
        if (stdout.includes("listening") || stderr.includes("listening")) {
          clearTimeout(t);
          resolve();
        } else if (child.exitCode !== null) {
          clearTimeout(t);
          reject(
            new Error(`server exited early: code=${child.exitCode}\n${stderr}`),
          );
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    /*
     * Send SIGINT and wait for clean exit (within 20s force-exit window).
     * Windows terminates Node child processes on child.kill("SIGINT") without
     * reliably delivering the JS signal handler, so the shutdown log is only
     * asserted on platforms where the handler actually runs.
     */
    const exitInfo = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      /* Force-kill and fail if the child doesn't exit within 22s of SIGINT. */
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("server did not exit within 22s after SIGINT"));
      }, 22_000);
      child.on("exit", (code, signal) => {
        clearTimeout(t);
        resolve({ code, signal });
      });
      child.kill("SIGINT");
    });

    const combined = stdout + stderr;
    if (process.platform === "win32") {
      expect(exitInfo.code === 0 || exitInfo.signal === "SIGINT").toBe(true);
    } else {
      expect(combined).toMatch(/shutting down/i);
      expect(exitInfo.code).toBe(0);
    }
  }, 30_000);
});
