#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mlDir = path.resolve(process.env.THOUGHTTRACKER_ML_DIR || path.join(rootDir, "..", "thoughttracker-ml"));
const pythonPath =
  process.platform === "win32"
    ? path.join(mlDir, ".venv", "Scripts", "python.exe")
    : path.join(mlDir, ".venv", "bin", "python");

if (!fs.existsSync(mlDir)) {
  console.error(`ML repo not found at ${mlDir}. Set THOUGHTTRACKER_ML_DIR if it lives elsewhere.`);
  process.exit(1);
}

if (!fs.existsSync(pythonPath)) {
  console.error(`ML virtualenv not found. Run "npm run setup:local:full" first.`);
  process.exit(1);
}

const child = spawn(
  pythonPath,
  ["-m", "uvicorn", "src.api.main:app", "--host", "127.0.0.1", "--port", "8000"],
  {
    cwd: mlDir,
    env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: "8000" },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
