#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const { version } = require("../package.json");
const archive = join(root, `cribbage-server-${version}.tgz`);
const required = [
  "web/src/models/schell_table-peg_table-12.0/pegging-outcome-pairwise.bin",
  "web/src/models/schell_table-peg_table-13.0/pegging-remaining-hand-distribution.bin",
  "web/src/models/schell_table-peg_table-13.0/pone-lead-frequency.bin",
  "web/src/models/schell_table-peg_table-14.0/pegging-outcome-tripolicy-aligned.bin",
  "web/src/models/schell_table-peg_table-14.0/crib-score-histogram-tripolicy-by-discard-cut.bin",
  "web/src/models/schell_table-peg_table-14.4/pegging-outcome-bounded-overrides.bin",
  "web/src/models/schell_table-peg_table-14.4/crib-score-histogram-bounded-tripolicy-by-discard-cut.bin",
  "web/src/models/schell_table-peg_table-14.5/pegging-outcome-frontier-overrides.bin",
  "web/src/models/schell_table-peg_table-14.5/crib-score-histogram-frontier-by-discard-cut.bin",
  "web/src/models/schell_table-peg_table-14.6/crib-score-histogram-full-frontier-by-discard-cut.bin",
  "web/src/models/rank-crib-discard/six-card-discard-policy.bin",
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
  console.error("Server package is missing protected model assets:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

console.log("Server package check passed: protected model assets included.");
