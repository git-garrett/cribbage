#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const { version } = require("../package.json");
const archive = join(root, `cribbage-server-${version}.tgz`);
const required = [
  "rust/Cargo.toml",
  "rust/Cargo.lock",
  "rust/cribbage-api/Cargo.toml",
  "rust/cribbage-api/main.rs",
  "rust/cribbage-policy-trainer/Cargo.toml",
  "rust/cribbage-policy-trainer/src/lib.rs",
  "rust/cribbage-runner/Cargo.toml",
  "rust/cribbage-runner/src/main.rs",
  "rust/cribbage-shadow-engine/Cargo.toml",
  "rust/cribbage-shadow-engine/lib.rs",
  "rust/cribbage-shadow-engine/assets/model13-pairwise.bin",
  "rust/cribbage-shadow-engine/assets/model13-hold.bin",
  "rust/cribbage-shadow-engine/assets/model91-discard-ev.bin",
  "rust/cribbage-shadow-engine/assets/model911-discard-ev.bin",
  "rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin",
  "rust/cribbage-shadow-engine/assets/model143-pairwise.bin",
  "rust/cribbage-shadow-engine/assets/model143-crib.bin",
  "rust/cribbage-shadow-engine/assets/empirical-discard-keep-14.8.bin",
  "rust/cribbage-shadow-engine/assets/crib-rank-score-by-discard-cut.json",
  "rust/cribbage-shadow-engine/assets/crib-score-histogram-by-discard-cut.json",
  "scripts/migrate-legacy-leaderboard.py",
  "scripts/repair_leaderboard_timestamps.py",
];

if (!existsSync(archive)) {
  console.error(`Missing server archive: ${archive}`);
  process.exit(1);
}

const entries = new Set(
  execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean),
);
const missing = required.filter((entry) => !entries.has(entry));
if (missing.length) {
  console.error("Rust server package is missing required runtime assets:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

console.log("Rust server package check passed: API source and runtime assets included.");
