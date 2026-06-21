#!/usr/bin/env node
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = join(__dirname, "..");
const dist = join(root, "dist");
const protectedPathPatterns = [
  /\.bin$/i,
  /peg-table-policy/i,
  /pegging-outcome/i,
  /pegging-remaining-hand/i,
  /pone-lead-frequency/i,
  /crib-score-histogram/i,
  /discard-cut/i,
];
const protectedContentPatterns = [
  /CribbageGame/,
  /chooseDiscards/,
  /chooseExhaustivePegPlay/,
  /recommendAiDiscard/,
  /recommendAiPeggingAction/,
  /peg-table-policy/,
  /pegging-outcome/,
  /pegging-remaining-hand/,
  /crib-score-histogram/,
];

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) entries.push(...walk(path));
    else entries.push(path);
  }
  return entries;
}

const failures = [];
for (const path of walk(dist)) {
  const rel = relative(dist, path);
  if (protectedPathPatterns.some((pattern) => pattern.test(rel))) {
    failures.push(`${rel}: protected model artifact path`);
    continue;
  }
  if (!/\.(js|html|css|json)$/i.test(rel)) continue;
  const text = readFileSync(path, "utf8");
  const pattern = protectedContentPatterns.find((candidate) => candidate.test(text));
  if (pattern) failures.push(`${rel}: protected content matched ${pattern}`);
}

if (failures.length) {
  console.error("Protected AI/model artifacts were emitted in the client build:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Client artifact check passed: no protected AI/model artifacts found.");
