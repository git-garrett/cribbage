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

function versionFromHighestModel() {
  const engine = fs.readFileSync(enginePath, "utf8");
  const matches = [...engine.matchAll(/schell_table-peg_table-(\d+)\.(\d+)/g)];
  if (!matches.length) throw new Error(`Could not determine app model version from ${enginePath}`);
  const [major, minor] = matches
    .map((match) => [Number(match[1]), Number(match[2])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  return `${major}.${minor}.0`;
}

const pkg = readJson(packagePath);
const version = versionFromHighestModel();
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
