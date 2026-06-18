import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UpstreamUnavailableError } from "../utils/errors";

export interface CreatorOnboardingPipelineRequest {
  channelUrls: string[];
  requestedLimit: number;
}

export interface CreatorOnboardingPipelineRun {
  status: "started";
  processId: number | null;
  statusPath: string;
  logDir: string;
}

/**
 * resolveCreatorOnboardingScriptPath — locate the Node pipeline script
 * (`add_creator_pipeline.mjs`) that drives creator onboarding.
 *
 * Prefers an explicit `CREATOR_ONBOARDING_PIPELINE_SCRIPT` override
 * (resolved to an absolute path); otherwise probes the sibling
 * `thoughttracker-ml/scripts` repo at one and two levels above cwd to
 * cover both monorepo layouts. Returns the first existing candidate, or
 * the first candidate as a best-effort default so callers can surface a
 * clear "not available" error.
 */
export function resolveCreatorOnboardingScriptPath(): string {
  const configured = process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  const candidates = [
    path.resolve(
      cwd,
      "..",
      "thoughttracker-ml",
      "scripts",
      "add_creator_pipeline.mjs",
    ),
    path.resolve(
      cwd,
      "..",
      "..",
      "thoughttracker-ml",
      "scripts",
      "add_creator_pipeline.mjs",
    ),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

/**
 * pipelineApiBase — resolve the API base URL the spawned pipeline should
 * call back into to ingest the creators it discovers.
 *
 * Uses `CREATOR_ONBOARDING_API_BASE` when set, otherwise points at this
 * server's own loopback address on `PORT` (default 4000), since the
 * child process runs on the same host.
 */
function pipelineApiBase(): string {
  const configured = process.env.CREATOR_ONBOARDING_API_BASE?.trim();
  return configured || `http://localhost:${process.env.PORT ?? "4000"}/api`;
}

/**
 * resolveNodeExecutable — pick the Node.js binary used to run the pipeline
 * script.
 *
 * Honors a `CREATOR_ONBOARDING_NODE` override (handy in tests or unusual
 * deployments); otherwise reuses this process's own interpreter
 * (`process.execPath`), guaranteeing the child runs the same Node that the
 * server is already running on, on every OS.
 */
function resolveNodeExecutable(): string {
  const configured = process.env.CREATOR_ONBOARDING_NODE?.trim();
  if (configured) return configured;
  return process.execPath;
}

/**
 * startCreatorOnboardingPipeline — kick off the long-running creator
 * onboarding pipeline as a detached Node child process and return
 * immediately with handles (pid, status file, log dir) the caller can
 * poll.
 *
 * Flow:
 * 1. Resolve the script path; if it is missing, throw
 * UpstreamUnavailableError so the API degrades gracefully instead of
 * crashing on machines without the ML toolchain.
 * 2. Build the Node argument list (the .mjs script path, channel URLs,
 * requested limit, the API base to call back into, concurrency, and an
 * optional `--no-start-servers`).
 *
 * Security-relevant details:
 * - The admin PIN is NOT passed on the command line (where it could leak
 * via process listings); instead it is injected into the child's
 * environment as `THOUGHTTRACKER_ADMIN_PIN`, and explicitly *deleted*
 * from the child env when no PIN is configured so a stale value can't
 * leak through from the parent process.
 * - The child is spawned `detached` and then `unref()`-ed so it outlives this
 * request/event-loop and the Node process never blocks on it — this is what
 * makes the controller's 202 "started" (fire-and-forget) contract possible.
 * - Instead of `stdio: "ignore"` (which silently swallowed every failure —
 * a missing python, a crash on launch, a stack trace — leaving operators
 * staring at a pipeline that "started" but produced nothing), the child's
 * stdout+stderr are redirected to a timestamped log file under `logs/`, and
 * an `error` listener catches spawn-level failures (e.g. ENOENT) and appends
 * them to that same file. The parent still doesn't read the pipes, so the
 * fire-and-forget semantics are unchanged.
 */
export function startCreatorOnboardingPipeline(
  request: CreatorOnboardingPipelineRequest,
): CreatorOnboardingPipelineRun {
  const scriptPath = resolveCreatorOnboardingScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new UpstreamUnavailableError(
      "ML_UNAVAILABLE",
      "Creator onboarding pipeline script is not available on this machine",
    );
  }

  const node = resolveNodeExecutable();

  const mlRoot = path.dirname(path.dirname(scriptPath));
  /*
   * The script parses repeatable flags with node:util parseArgs, so each
   * channel URL must be preceded by its own `--channel-url`.
   */
  const channelUrlArgs = request.channelUrls.flatMap((url) => [
    "--channel-url",
    url,
  ]);
  const args = [
    scriptPath,
    ...channelUrlArgs,
    "--limit",
    String(request.requestedLimit),
    "--api-base",
    pipelineApiBase(),
    "--concurrency",
    process.env.CREATOR_ONBOARDING_CONCURRENCY ?? "5",
  ];

  const adminPin = (process.env.ADMIN_ONBOARDING_PIN ?? "").trim();
  if (process.env.CREATOR_ONBOARDING_NO_START_SERVERS === "true")
    args.push("--no-start-servers");

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (adminPin) {
    childEnv.THOUGHTTRACKER_ADMIN_PIN = adminPin;
  } else {
    delete childEnv.THOUGHTTRACKER_ADMIN_PIN;
  }

  /*
   * Open a per-run log file and point the detached child's stdout+stderr at
   * it, so a spawn/runtime failure leaves a diagnosable trail instead of
   * vanishing into `stdio: "ignore"`. We keep stdin ignored.
   */
  const logDir = path.join(mlRoot, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFilePath = path.join(
    logDir,
    `add_creator_pipeline_${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
  );
  const logFd = fs.openSync(logFilePath, "a");

  const child = spawn(node, args, {
    cwd: mlRoot,
    detached: true,
    env: childEnv,
    /* [stdin, stdout, stderr]: ignore input, tee both output streams to the fd. */
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });

  /*
   * Capture spawn-level failures (e.g. ENOENT when the node binary or script
   * is missing) — these fire AFTER the function returns and would otherwise be
   * an unhandled 'error' event. Append to the same log so the failure is
   * visible to anyone tailing it.
   */
  child.on("error", (err) => {
    try {
      fs.appendFileSync(
        logFd,
        `\n[spawn-error] ${new Date().toISOString()} ${err.stack ?? err.message}\n`,
      );
    } catch {
      /* best-effort: never let a logging failure crash the parent */
    }
  });
  /*
   * Close our copy of the fd once the child has it / exits, so we don't leak a
   * descriptor; the child keeps its own duplicated handle for its lifetime.
   */
  child.on("exit", () => {
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
  });

  child.unref();

  return {
    status: "started",
    processId: child.pid ?? null,
    statusPath: path.join(
      mlRoot,
      "reports",
      "metrics",
      "add_creator_pipeline_status.json",
    ),
    logDir,
  };
}
