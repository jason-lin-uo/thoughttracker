#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import net from "node:net";

function fail(message) {
  console.error(`\nCould not start local Postgres:\n${message}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with code ${result.status}`);
}

function composeArgs(args) {
  const compose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (!compose.error && compose.status === 0) return ["docker", ["compose", ...args]];

  const legacy = spawnSync("docker-compose", ["version"], { encoding: "utf8" });
  if (!legacy.error && legacy.status === 0) return ["docker-compose", args];

  fail("Docker Compose was not found. Install Docker Desktop or Docker Engine with Compose support.");
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
      socket.on("timeout", () => socket.destroy());
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

const [command, args] = composeArgs(["up", "-d", "postgres"]);
run(command, args);
await waitForTcp("127.0.0.1", 5432, 60000).catch((err) => fail(err.message));
console.log("Local Postgres ready on localhost:5432");
