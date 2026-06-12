#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const separatorIndex = process.argv.indexOf("--");
const runName = process.argv[2];

if (!runName || separatorIndex < 0 || separatorIndex === process.argv.length - 1) {
  console.error("Usage: node scripts/launch-background.cjs <run-name> -- <command> [args...]");
  process.exit(1);
}

const command = process.argv[separatorIndex + 1];
const args = process.argv.slice(separatorIndex + 2);
const childPath = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  process.env.PATH || "",
].filter(Boolean).join(":");
const runSlug = runName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "background-run";
const runDir = path.join(root, ".background", runSlug);
const logPath = path.join(runDir, "output.log");
const statusPath = path.join(runDir, "status.json");

fs.mkdirSync(runDir, { recursive: true });
const out = fs.openSync(logPath, "a");
const child = spawn(command, args, {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, out],
  env: { ...process.env, PATH: childPath },
});

child.unref();

const status = {
  version: 1,
  status: "started",
  runName,
  pid: child.pid,
  command: [command, ...args].join(" "),
  cwd: root,
  logPath,
  host: os.hostname(),
  startedAt: new Date().toISOString(),
};

fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
console.log(`Started ${runName} as PID ${child.pid}`);
console.log(`Status: ${statusPath}`);
console.log(`Log: ${logPath}`);
