#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withMl = process.argv.includes("--with-ml");

const checks = [];
const failures = [];
const warnings = [];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function loadEnv() {
  return {
    ...parseEnvFile(path.join(rootDir, ".env")),
    ...parseEnvFile(path.join(rootDir, "backend", ".env")),
    ...process.env,
  };
}

function ok(message) {
  checks.push(message);
}

function warn(message) {
  warnings.push(message);
}

function fail(message) {
  failures.push(message);
}

function resolveCommand(command) {
  if (process.platform === "win32" && ["npm", "npx", "pnpm", "yarn"].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function commandNeedsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function run(command, args, options = {}) {
  const resolved = resolveCommand(command);
  return spawnSync(resolved, args, {
    cwd: options.cwd || rootDir,
    encoding: options.encoding || "utf8",
    shell: commandNeedsShell(resolved),
    stdio: options.stdio || "pipe",
    timeout: options.timeout ?? 10000,
  });
}

function commandWorks(command, args) {
  const result = run(command, args);
  return !result.error && result.status === 0;
}

function bool(value) {
  return ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
}

function portIsFree(port) {
  const hasListener = portHasListener(port);
  if (hasListener !== null) {
    return Promise.resolve(!hasListener);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(err);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

function portHasListener(port) {
  if (process.platform === "win32") {
    const command = [
      `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if ($conn) { 'LISTENING' }",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10000,
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.includes("LISTENING");
  }

  const lsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (!lsof.error) {
    if (lsof.status === 0) return lsof.stdout.split(/\r?\n/).slice(1).some((line) => line.trim());
    if (lsof.status === 1) return false;
  }

  const ss = run("ss", ["-ltn", `sport = :${port}`]);
  if (!ss.error) {
    if (ss.status === 0) return ss.stdout.split(/\r?\n/).slice(1).some((line) => line.trim());
    if (ss.status === 1) return false;
  }

  return null;
}

function parseWindowsPortOwner(output) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) return null;
  const [pid, name, ...rest] = line.split("\t");
  return {
    pid: pid || "",
    name: name || "",
    command: rest.join("\t") || "",
  };
}

function getPortOwner(port) {
  if (process.platform === "win32") {
    const command = [
      `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if ($conn) {",
      '  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue',
      '  "$($conn.OwningProcess)`t$($proc.Name)`t$($proc.CommandLine)"',
      "}",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10000,
    });
    if (result.status !== 0 || result.error) return null;
    return parseWindowsPortOwner(result.stdout);
  }

  const lsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (!lsof.error && lsof.status === 0) {
    const line = lsof.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((value) => value.trim())
      .find(Boolean);
    if (line) {
      const parts = line.split(/\s+/);
      return {
        pid: parts[1] || "",
        name: parts[0] || "",
        command: line,
      };
    }
  }

  const ss = run("ss", ["-ltnp", `sport = :${port}`]);
  if (!ss.error && ss.status === 0) {
    const line = ss.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((value) => value.trim())
      .find(Boolean);
    if (line) {
      const pidMatch = line.match(/pid=(\d+)/);
      return {
        pid: pidMatch?.[1] || "",
        name: "",
        command: line,
      };
    }
  }

  return null;
}

function killHint(owner) {
  if (!owner?.pid) {
    return "Close the app that owns this port, then rerun npm run dev.";
  }
  if (process.platform === "win32") {
    return `Close that terminal, or run: Stop-Process -Id ${owner.pid}`;
  }
  return `Close that terminal, or run: kill ${owner.pid}`;
}

async function checkRequiredPort(port, label) {
  const free = await portIsFree(port);
  if (free) {
    ok(`${label} port ${port} is available.`);
    return;
  }

  const owner = getPortOwner(port);
  const ownerText = owner
    ? ` It appears to be owned by PID ${owner.pid || "unknown"} ${owner.name ? `(${owner.name})` : ""}.`
    : "";
  fail(`${label} port ${port} is already in use.${ownerText} ThoughtTracker will not auto-kill it. ${killHint(owner)}`);
}

async function checkPreferredPort(port, label) {
  const free = await portIsFree(port);
  if (free) {
    ok(`${label} preferred port ${port} is available.`);
    return;
  }

  const owner = getPortOwner(port);
  const ownerText = owner
    ? ` It appears to be owned by PID ${owner.pid || "unknown"} ${owner.name ? `(${owner.name})` : ""}.`
    : "";
  warn(`${label} preferred port ${port} is already in use.${ownerText} Vite should choose the next open port.`);
}

function thoughttrackerPostgresIsRunning() {
  const result = run("docker", [
    "ps",
    "--filter",
    "name=thoughttracker-postgres",
    "--filter",
    "status=running",
    "--format",
    "{{.Names}}",
  ]);
  return !result.error && result.status === 0 && result.stdout.split(/\r?\n/).includes("thoughttracker-postgres");
}

async function checkPostgresPort() {
  const port = 5432;
  const free = await portIsFree(port);
  if (free) {
    ok("Postgres port 5432 is available for Docker.");
    return;
  }

  if (thoughttrackerPostgresIsRunning()) {
    ok("Postgres port 5432 is already served by the ThoughtTracker Docker container.");
    return;
  }

  const owner = getPortOwner(port);
  const ownerText = owner
    ? ` It appears to be owned by PID ${owner.pid || "unknown"} ${owner.name ? `(${owner.name})` : ""}.`
    : "";
  fail(`Postgres port 5432 is already in use by something other than thoughttracker-postgres.${ownerText} Stop that service or change the local Docker port before running setup.`);
}

function findOllamaCommand() {
  const pathCheck = run("ollama", ["--version"]);
  if (!pathCheck.error && pathCheck.status === 0) return "ollama";

  if (process.platform !== "win32") return null;

  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Ollama", "ollama.exe") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 10000 });
    if (!check.error && check.status === 0) return candidate;
  }

  return null;
}

async function checkOllama(env) {
  const provider = String(env.AI_PROVIDER ?? "local").toLowerCase();
  if (bool(env.DEMO_MODE) || provider !== "local") {
    ok(`Local AI check skipped because AI_PROVIDER=${provider}.`);
    return;
  }

  const ollama = findOllamaCommand();
  if (!ollama) {
    fail("Ollama was not found. Install it first: Windows `winget install Ollama.Ollama`, macOS `brew install --cask ollama`, Linux `curl -fsSL https://ollama.com/install.sh | sh`.");
    return;
  }

  const baseUrl = String(env.LOCAL_LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      fail(`Ollama is installed, but ${baseUrl} returned HTTP ${response.status}. Open the Ollama app or run ollama serve.`);
      return;
    }

    const model = env.AI_MODEL || "llama3.1:8b";
    const payload = await response.json();
    const installed = new Set(
      Array.isArray(payload.models) ? payload.models.flatMap((item) => [item.name, item.model].filter(Boolean)) : [],
    );
    if (installed.has(model)) {
      ok(`Local AI is ready at ${baseUrl} with ${model}.`);
    } else {
      warn(`Ollama is running, but ${model} is not installed yet. npm run dev will pull it automatically.`);
    }
  } catch (err) {
    fail(`Ollama is installed, but ${baseUrl} is not responding. Open the Ollama app or run ollama serve.`);
  } finally {
    clearTimeout(timeout);
  }
}

function checkEnvFiles(env) {
  const rootEnv = path.join(rootDir, ".env");
  const backendEnv = path.join(rootDir, "backend", ".env");
  const frontendEnv = path.join(rootDir, "frontend", ".env.local");

  if (fs.existsSync(rootEnv)) ok("Root .env exists.");
  else warn("Root .env is missing. Run npm run setup:local if this is a fresh clone.");

  if (fs.existsSync(backendEnv)) ok("backend/.env exists.");
  else fail("backend/.env is missing. Run npm run setup:local before npm run dev.");

  if (fs.existsSync(frontendEnv)) ok("frontend/.env.local exists.");
  else warn("frontend/.env.local is missing. Run npm run setup:local if the frontend cannot reach the API.");

  if (!String(env.DATABASE_URL || "").trim()) {
    fail("DATABASE_URL is not configured. Run npm run setup:local or set it in backend/.env.");
  } else if (!/^postgres(?:ql)?:\/\//.test(String(env.DATABASE_URL))) {
    fail("DATABASE_URL must start with postgres:// or postgresql://.");
  } else {
    ok("DATABASE_URL is configured.");
  }

  const aiProvider = String(env.AI_PROVIDER ?? "local").toLowerCase();
  if (!["local", "openai", "anthropic"].includes(aiProvider)) {
    fail(`AI_PROVIDER="${env.AI_PROVIDER}" is invalid. Use local, openai, or anthropic.`);
  }

  if (!String(env.ADMIN_ONBOARDING_PIN || "").trim()) {
    warn("ADMIN_ONBOARDING_PIN is blank. The public browsing experience works, but admin-only controls will stay locked.");
  }
}

async function main() {
  console.log("Running ThoughtTracker local doctor...\n");

  const env = loadEnv();
  const backendPort = Number.parseInt(env.PORT || "4000", 10);
  const frontendPort = 5173;
  const mlPort = 8000;

  if (fs.existsSync(path.join(rootDir, "package.json"))) ok("Project root looks correct.");
  else fail("Run this command from the thoughttracker repository root.");

  if (commandWorks("npm", ["--version"])) ok("npm is available.");
  else fail("npm was not found. Install Node.js 20+.");

  if (commandWorks("docker", ["--version"])) ok("Docker CLI is available.");
  else fail("Docker was not found. Install Docker Desktop or Docker Engine.");

  if (commandWorks("docker", ["info"])) ok("Docker is running.");
  else fail("Docker is installed but not running. Start Docker Desktop, then rerun npm run dev.");

  checkEnvFiles(env);

  if (Number.isFinite(backendPort)) {
    await checkRequiredPort(backendPort, "Backend");
  } else {
    fail(`PORT must be a number. Current value: ${env.PORT}`);
  }

  await checkPreferredPort(frontendPort, "Frontend");
  await checkPostgresPort();

  if (withMl) {
    await checkRequiredPort(mlPort, "ML service");
  }

  await checkOllama(env);

  for (const message of checks) {
    console.log(`OK  ${message}`);
  }

  for (const message of warnings) {
    console.warn(`WARN ${message}`);
  }

  if (failures.length > 0) {
    console.error("\nFix these before starting the app:");
    for (const message of failures) {
      console.error(`FAIL ${message}`);
    }
    process.exit(1);
  }

  console.log("\nLocal doctor passed. It is safe to run npm run dev.");
}

main();
