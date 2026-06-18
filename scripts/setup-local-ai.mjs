#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check-only");

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileEnv = {
 ...parseEnvFile(path.join(rootDir, ".env")),
 ...parseEnvFile(path.join(rootDir, "backend", ".env")),
};
const env = { ...fileEnv, ...process.env };
const provider = (env.AI_PROVIDER ?? "local").toLowerCase();
const demoMode = ["true", "1"].includes((env.DEMO_MODE ?? "false").toLowerCase());

if (demoMode || provider !== "local") {
  console.log(`Local AI preflight skipped (AI_PROVIDER=${provider || "local"}).`);
  process.exit(0);
}

const model = env.AI_MODEL || "llama3.1:8b";
const baseUrl = (env.LOCAL_LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");

function fail(message) {
  console.error(`\nLocal AI setup failed:\n${message}\n`);
  console.error("Install/start Ollama, then run this again:");
  console.error(" Windows: winget install Ollama.Ollama");
  console.error(" macOS: brew install --cask ollama");
  console.error(" Linux: curl -fsSL https://ollama.com/install.sh | sh");
  console.error("\nAfter installation, open the Ollama app or run `ollama serve`.");
  console.error(`Then run: npm run setup:local-ai\n`);
  process.exit(1);
}

function findOllamaCommand() {
  const pathCheck = spawnSync("ollama", ["--version"], { encoding: "utf8" });
  if (!pathCheck.error && pathCheck.status === 0) return "ollama";

  if (process.platform !== "win32") return null;

  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe")
      : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Ollama", "ollama.exe") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!check.error && check.status === 0) return candidate;
  }

  return null;
}

const ollamaCommand = findOllamaCommand();
if (!ollamaCommand) {
 fail("The `ollama` command was not found.");
}

const version = spawnSync(ollamaCommand, ["--version"], { encoding: "utf8" });
if (version.error || version.status !== 0) {
 fail("The `ollama` command was not found.");
}

async function fetchTags() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let tags;
try {
  tags = await fetchTags();
} catch (err) {
  fail(
    `Ollama is installed, but ${baseUrl} is not responding (${err.message}). ` +
      "Start Ollama before running the app.",
  );
}

const installedModels = new Set(
  Array.isArray(tags.models)
    ? tags.models.flatMap((m) => [m.name, m.model].filter(Boolean))
    : [],
);

if (!installedModels.has(model)) {
  if (checkOnly) {
    fail(`Ollama is running, but required model "${model}" is not installed.`);
  }
  console.log(`Pulling local report model: ${model}`);
  const pull = spawnSync(ollamaCommand, ["pull", model], { stdio: "inherit" });
  if (pull.error || pull.status !== 0) {
    fail(`Failed to pull model "${model}".`);
  }
}

try {
  tags = await fetchTags();
} catch (err) {
  fail(`Ollama stopped responding after model setup (${err.message}).`);
}

const refreshedModels = new Set(
  Array.isArray(tags.models)
    ? tags.models.flatMap((m) => [m.name, m.model].filter(Boolean))
    : [],
);
if (!refreshedModels.has(model)) {
  fail(`Model "${model}" still was not found after setup.`);
}

console.log(`Local AI ready: ${model} via ${baseUrl}`);
