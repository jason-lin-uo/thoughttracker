import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, unrefMock, onMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  unrefMock: vi.fn(),
  /*
   * The launcher now attaches 'error'/'exit' listeners to the child to capture
   * spawn failures (no longer stdio:"ignore"), so the mock child needs `.on`.
   */
  onMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import request from "supertest";
import { buildApp } from "../src/app";
import {
  resolveCreatorOnboardingScriptPath,
  startCreatorOnboardingPipeline,
} from "../src/services/creatorOnboardingPipeline.service";

const envKeys = [
  "ADMIN_ONBOARDING_PIN",
  "CREATOR_ONBOARDING_API_BASE",
  "CREATOR_ONBOARDING_CONCURRENCY",
  "CREATOR_ONBOARDING_NO_START_SERVERS",
  "CREATOR_ONBOARDING_PIPELINE_SCRIPT",
  "CREATOR_ONBOARDING_NODE",
  "PORT",
] as const;

/* Snapshot of the env vars these tests mutate, captured so afterEach can restore them. */
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
const originalCwd = process.cwd();
const app = buildApp();

/* Restores each tracked env var to its snapshotted value (deleting ones that were unset). */
function restoreEnv() {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/* Writes a no-op onboarding pipeline script to a temp dir and returns its path. */
function writeTempScript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-onboarding-script-"));
  const script = path.join(dir, "add_creator_pipeline.mjs");
  fs.writeFileSync(script, "// noop\n");
  return script;
}

afterEach(() => {
  restoreEnv();
  process.chdir(originalCwd);
  spawnMock.mockReset();
  unrefMock.mockReset();
});

beforeEach(() => {
  spawnMock.mockReturnValue({ pid: 1, unref: unrefMock, on: onMock });
});

describe("creator onboarding pipeline launcher", () => {
  it("discovers the sibling thoughttracker-ml script from a backend cwd", () => {
    /*
     * realpathSync resolves the macOS /tmp -> /private/tmp symlink up front, so
     * the derived script path matches the canonicalized process.cwd() below.
     */
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "tt-default-onboarding-")),
    );
    const backendDir = path.join(root, "thoughttracker", "backend");
    const script = path.join(
      root,
      "thoughttracker-ml",
      "scripts",
      "add_creator_pipeline.mjs",
    );
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "// noop\n");

    delete process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT;
    process.chdir(backendDir);

    expect(resolveCreatorOnboardingScriptPath()).toBe(script);
  });

  it("spawns the full pipeline with owner-only settings and redacted response details", () => {
    const script = writeTempScript();
    process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT = script;
    process.env.ADMIN_ONBOARDING_PIN = "2468";
    process.env.CREATOR_ONBOARDING_API_BASE = "http://127.0.0.1:4100/api";
    process.env.CREATOR_ONBOARDING_CONCURRENCY = "7";
    process.env.CREATOR_ONBOARDING_NO_START_SERVERS = "true";
    /*
     * Pin the interpreter so the assertion is OS-independent rather than
     * depending on this test runner's own process.execPath.
     */
    process.env.CREATOR_ONBOARDING_NODE = "node";
    spawnMock.mockReturnValue({ pid: 777, unref: unrefMock, on: onMock });

    const run = startCreatorOnboardingPipeline({
      channelUrls: [
        "https://www.youtube.com/@mkbhd",
        "https://www.youtube.com/@verge",
      ],
      requestedLimit: 50,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      expect.arrayContaining([
        script,
        "--channel-url",
        "https://www.youtube.com/@mkbhd",
        "--channel-url",
        "https://www.youtube.com/@verge",
        "--limit",
        "50",
        "--api-base",
        "http://127.0.0.1:4100/api",
        "--concurrency",
        "7",
        "--no-start-servers",
      ]),
      expect.objectContaining({
        cwd: path.dirname(path.dirname(script)),
        detached: true,
        env: expect.objectContaining({ THOUGHTTRACKER_ADMIN_PIN: "2468" }),
        windowsHide: true,
      }),
    );
    /* The .mjs script must be the first arg so `node <script> ...` runs it. */
    expect(spawnMock.mock.calls[0][1][0]).toBe(script);
    expect(spawnMock.mock.calls[0][1]).not.toContain("-AdminPin");
    expect(spawnMock.mock.calls[0][1]).not.toContain("--admin-pin");
    expect(JSON.stringify(spawnMock.mock.calls[0][1])).not.toContain("2468");
    expect(unrefMock).toHaveBeenCalled();
    expect(run).toEqual({
      status: "started",
      processId: 777,
      statusPath: path.join(
        path.dirname(path.dirname(script)),
        "reports",
        "metrics",
        "add_creator_pipeline_status.json",
      ),
      logDir: path.join(path.dirname(path.dirname(script)), "logs"),
    });
    expect(JSON.stringify(run)).not.toContain("2468");
  });

  it("uses localhost API defaults and the running Node interpreter when optional launcher env is absent", () => {
    const script = writeTempScript();
    process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT = script;
    process.env.PORT = "4555";
    delete process.env.CREATOR_ONBOARDING_NODE;
    spawnMock.mockReturnValue({ pid: undefined, unref: unrefMock, on: onMock });

    const run = startCreatorOnboardingPipeline({
      channelUrls: ["@creator"],
      requestedLimit: 10,
    });

    /* With no override, the child reuses this process's own Node binary. */
    expect(spawnMock.mock.calls[0][0]).toBe(process.execPath);
    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "--api-base",
        "http://localhost:4555/api",
        "--concurrency",
        "5",
      ]),
    );
    expect(run.processId).toBeNull();
  });

  it("fails fast when the local pipeline script is unavailable", () => {
    process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT = path.join(
      os.tmpdir(),
      `missing-onboarding-${Date.now()}.mjs`,
    );

    expect(() =>
      startCreatorOnboardingPipeline({
        channelUrls: ["@creator"],
        requestedLimit: 10,
      }),
    ).toThrow("Creator onboarding pipeline script is not available");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/creator-onboarding/run", () => {
  it("verifies the admin PIN before unlocking the frontend controls", async () => {
    process.env.ADMIN_ONBOARDING_PIN = "2468";

    const accepted = await request(app)
      .post("/api/creator-onboarding/verify-pin")
      .set("X-Admin-Pin", "2468")
      .send();
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ ok: true });

    const rejected = await request(app)
      .post("/api/creator-onboarding/verify-pin")
      .set("X-Admin-Pin", "1234")
      .send();
    expect(rejected.status).toBe(403);
  });

  it("requires the admin PIN before validating the request", async () => {
    process.env.ADMIN_ONBOARDING_PIN = "2468";

    const response = await request(app)
      .post("/api/creator-onboarding/run")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("FORBIDDEN");
  });

  it("rejects malformed bodies and invalid creator URLs", async () => {
    process.env.ADMIN_ONBOARDING_PIN = "2468";

    const missing = await request(app)
      .post("/api/creator-onboarding/run")
      .set("X-Admin-Pin", "2468")
      .send({});
    expect(missing.status).toBe(400);

    const invalid = await request(app)
      .post("/api/creator-onboarding/run")
      .set("X-Admin-Pin", "2468")
      .send({ channelUrls: ["ftp://example.com/nope"], requestedLimit: 10 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toMatch(/Creator URL looks invalid/);
  });

  it("starts the owner-only local pipeline", async () => {
    const script = writeTempScript();
    process.env.ADMIN_ONBOARDING_PIN = "2468";
    process.env.CREATOR_ONBOARDING_PIPELINE_SCRIPT = script;
    spawnMock.mockReturnValue({ pid: 101, unref: unrefMock, on: onMock });

    const response = await request(app)
      .post("/api/creator-onboarding/run")
      .set("X-Admin-Pin", "2468")
      .send({
        channelUrls: ["https://www.youtube.com/@mkbhd"],
        requestedLimit: 25,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: "started",
        processId: 101,
      }),
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
