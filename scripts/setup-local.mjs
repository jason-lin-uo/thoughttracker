#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mlDir = path.resolve(process.env.THOUGHTTRACKER_ML_DIR || path.join(rootDir, "..", "thoughttracker-ml"));
const withMl = process.argv.includes("--with-ml");
const dumpPath = path.resolve(process.env.THOUGHTTRACKER_DUMP || path.join(rootDir, "thoughttracker_full.dump"));
const dbUrl = "postgresql://postgres:postgres@localhost:5432/thoughttracker?schema=public";
const postgresContainer = "thoughttracker-postgres";

function log(message) {
  console.log(`\n==> ${message}`);
}

function fail(message) {
  console.error(`\nSetup failed:\n${message}\n`);
  process.exit(1);
}

function commandExists(command, args = ["--version"]) {
  const resolved = resolveCommand(command);
  const result = spawnSync(resolved, args, {
    encoding: "utf8",
    shell: commandNeedsShell(resolved),
  });
  return !result.error && result.status === 0;
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
  const printable = [command, ...args].join(" ");
  console.log(`$ ${printable}`);
  const resolved = resolveCommand(command);
  const result = spawnSync(resolved, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || "inherit",
    shell: commandNeedsShell(resolved),
  });

  if (result.error) {
    fail(`Could not run "${printable}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Command failed (${result.status}): ${printable}`);
  }
  return result;
}

function ensureFileFromExample(target, example) {
  if (fs.existsSync(target)) {
    console.log(`Keeping existing ${path.relative(rootDir, target)}`);
    return;
  }
  if (!fs.existsSync(example)) {
    fail(`Missing example env file: ${path.relative(rootDir, example)}`);
  }
  fs.copyFileSync(example, target);
  console.log(`Created ${path.relative(rootDir, target)} from ${path.relative(rootDir, example)}`);
}

function dockerComposeArgs(args) {
  const compose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (!compose.error && compose.status === 0) return ["docker", ["compose", ...args]];
  if (commandExists("docker-compose", ["version"])) return ["docker-compose", args];
  fail("Docker Compose was not found. Install Docker Desktop or Docker Engine with Compose support.");
}

function runDockerCompose(args) {
  const [command, composeArgs] = dockerComposeArgs(args);
  run(command, composeArgs);
}

function waitForTcp(host, port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const probe = () => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1500);
      socket.on("connect", () => {
        settled = true;
        socket.destroy();
        resolve();
      });
      socket.on("timeout", () => {
        socket.destroy();
      });
      socket.on("error", () => {});
      socket.on("close", () => {
        if (settled) return;
        if (Date.now() - start >= timeoutMs) {
          settled = true;
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(probe, 1000);
      });
    };
    probe();
  });
}

function ensurePortFree(host, port, label) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`${label} port ${port} is already in use. Stop the running app, then rerun setup.`));
        return;
      }
      reject(err);
    });
    server.once("listening", () => {
      server.close(() => resolve());
    });
    server.listen(port, host);
  });
}

function findPythonCommand() {
  const configured = process.env.PYTHON;
  const candidates = configured
    ? [[configured, []]]
    : process.platform === "win32"
      ? [
          ["py", ["-3.11"]],
          ["python", []],
          ["python3", []],
        ]
      : [
          ["python3.11", []],
          ["python3", []],
          ["python", []],
        ];

  for (const [command, prefixArgs] of candidates) {
    const result = spawnSync(command, [...prefixArgs, "--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return { command, prefixArgs };
    }
  }

  fail("Python 3.11+ was not found. Install Python, then rerun npm run setup:local:full.");
}

function venvPython() {
  return process.platform === "win32"
    ? path.join(mlDir, ".venv", "Scripts", "python.exe")
    : path.join(mlDir, ".venv", "bin", "python");
}

function restoreDumpWithDocker() {
  if (!fs.existsSync(dumpPath)) {
    fail("Missing thoughttracker_full.dump. Run git lfs pull, then rerun setup.");
  }

  console.log(`Restoring ${path.basename(dumpPath)} into local Postgres. This overwrites the local ThoughtTracker database.`);

  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        postgresContainer,
        "pg_restore",
        "--username=postgres",
        "--dbname=thoughttracker",
        "--no-owner",
        "--clean",
        "--if-exists",
      ],
      { cwd: rootDir, stdio: ["pipe", "inherit", "inherit"] },
    );

    fs.createReadStream(dumpPath).pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore inside Docker exited with code ${code}`));
    });
  });
}

async function main() {
  log("Checking required tools");
  if (!commandExists("git", ["--version"])) fail("Git was not found.");
  if (!commandExists("git", ["lfs", "version"])) fail("Git LFS was not found. Install Git LFS, then rerun setup.");
  if (!commandExists("npm", ["--version"])) fail("npm was not found. Install Node.js 20+.");
  if (!commandExists("docker", ["--version"])) fail("Docker was not found. Install Docker Desktop or Docker Engine.");
  if (withMl && !fs.existsSync(mlDir)) {
    fail(`Expected the ML repo at ${mlDir}. Set THOUGHTTRACKER_ML_DIR if it lives elsewhere.`);
  }
  await ensurePortFree("127.0.0.1", 4000, "Backend").catch((err) => fail(err.message));

  log("Preparing env files");
  ensureFileFromExample(path.join(rootDir, ".env"), path.join(rootDir, ".env.example"));
  ensureFileFromExample(path.join(rootDir, "backend", ".env"), path.join(rootDir, ".env.example"));
  ensureFileFromExample(path.join(rootDir, "frontend", ".env.local"), path.join(rootDir, ".env.example"));
  if (withMl) {
    ensureFileFromExample(path.join(mlDir, ".env"), path.join(mlDir, ".env.example"));
  }

  log("Pulling Git LFS artifacts");
  run("git", ["lfs", "pull"], { cwd: rootDir });
  if (withMl) {
    run("git", ["lfs", "pull"], { cwd: mlDir });
  }

  log("Installing Node dependencies");
  run("npm", ["install"], { cwd: rootDir });
  run("npm", ["run", "db:generate", "--workspace", "backend"], { cwd: rootDir });

  log("Starting local Postgres");
  runDockerCompose(["up", "-d", "postgres"]);
  await waitForTcp("127.0.0.1", 5432, 60000).catch((err) => fail(err.message));

  log("Restoring real product database snapshot");
  await restoreDumpWithDocker().catch((err) => fail(err.message));
  run("npm", ["run", "db:setup", "--workspace", "backend"], { cwd: rootDir, env: { DATABASE_URL: dbUrl } });

  if (withMl) {
    log("Preparing ML service environment");
    const py = findPythonCommand();
    if (!fs.existsSync(venvPython())) {
      run(py.command, [...py.prefixArgs, "-m", "venv", ".venv"], { cwd: mlDir });
    }
    run(venvPython(), ["-m", "pip", "install", "--index-url", "https://pypi.org/simple/", "--upgrade", "pip"], { cwd: mlDir });
    run(venvPython(), ["-m", "pip", "install", "--index-url", "https://pypi.org/simple/", "-r", "requirements.txt"], {
      cwd: mlDir,
    });
  } else {
    console.log("Skipping ML repo setup. Use `npm run setup:local:full` for owner reanalysis workflows.");
  }

  log("Checking local report model");
  run("node", [path.join(rootDir, "scripts", "setup-local-ai.mjs")], { cwd: rootDir });

  console.log(`
Local setup complete.

Start the full product with:
  npm run dev

Then open the Vite URL printed in the terminal, usually:
  http://localhost:5173

If a reviewer only wants the app stack after setup, they do not need to run db:seed.
Owner reanalysis workflows can run:
  npm run setup:local:full
  npm run dev:full
`);
}

main();
