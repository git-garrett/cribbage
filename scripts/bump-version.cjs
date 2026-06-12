#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const packagePath = "package.json";
const lockPath = "package-lock.json";
const enginePath = "web/src/engine.ts";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function versionFromDefaultModel() {
  const engine = fs.readFileSync(enginePath, "utf8");
  const match = /DEFAULT_OPPONENT:\s*Opponent\s*=\s*"[^"]*?(\d+)\.(\d+)"/.exec(engine);
  if (!match) throw new Error(`Could not determine default model version from ${enginePath}`);
  return `${match[1]}.${match[2]}.0`;
}

const pkg = readJson(packagePath);
const version = versionFromDefaultModel();
pkg.version = version;
writeJson(packagePath, pkg);

if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeJson(lockPath, lock);
}

execFileSync("git", ["add", packagePath, lockPath], { stdio: "inherit" });
console.log(`Bumped app version to ${version}`);
