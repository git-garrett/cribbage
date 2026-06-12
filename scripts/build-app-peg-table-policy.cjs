#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const [sourceRows, outputPath, sourceLabel = path.basename(sourceRows || "")] = process.argv.slice(2);

if (!sourceRows || !outputPath) {
  console.error("Usage: node scripts/build-app-peg-table-policy.cjs <iteration.rows.jsonl> <output.json> [source-label]");
  process.exit(1);
}

function round5(value) {
  return Math.round(value * 100000) / 100000;
}

async function main() {
  const pegEvs = {};
  let rows = 0;
  const input = fs.createReadStream(sourceRows, "utf8");
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rows += 1;
    pegEvs[row.key] = [
      round5(row.myPeggingEv),
      round5(row.opponentPeggingEv),
      row.bestLead?.rank ?? null,
    ];
  }

  const policy = {
    version: 2,
    source: sourceLabel,
    policy: "per-discard pegging EV table; app combines hand EV, Schell crib EV, and net pegging EV at runtime",
    rows,
    pegEvs,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(policy)}\n`);
  console.log(`Wrote ${rows} peg EV rows to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
