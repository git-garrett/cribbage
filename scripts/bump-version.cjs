#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const packagePath = "package.json";
const lockPath = "package-lock.json";
const modelIdPath = "rust/cribbage-shadow-engine/model_id.rs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function versionFromHighestModel() {
  const modelIds = fs.readFileSync(modelIdPath, "utf8");
  const matches = [...modelIds.matchAll(/schell_table-peg_table-(\d+(?:\.\d+)+)/g)];
  if (!matches.length) throw new Error(`Could not determine app model version from ${modelIdPath}`);
  const highest = matches
    .map((match) => match[1].split(".").map(Number))
    .sort((a, b) => {
      const length = Math.max(a.length, b.length, 3);
      for (let index = 0; index < length; index += 1) {
        const diff = (b[index] ?? 0) - (a[index] ?? 0);
        if (diff) return diff;
      }
      return 0;
    })[0];
  while (highest.length < 3) highest.push(0);
  return highest.slice(0, 3).join(".");
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
