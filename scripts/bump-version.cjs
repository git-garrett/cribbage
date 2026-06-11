#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const packagePath = "package.json";
const lockPath = "package-lock.json";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) throw new Error(`Unsupported version format: ${version}`);
  const [, major, minor, patch, suffix] = match;
  return `${major}.${minor}.${Number(patch) + 1}${suffix}`;
}

const pkg = readJson(packagePath);
const version = nextPatch(pkg.version);
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
