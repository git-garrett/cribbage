#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const MAGIC = "C14B";
const POLICIES = ["ev", "frontier-on", "frontier-off"];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/pack-frontier-crib-discard-asset.cjs --input <json> --output <bin> [--manifest <json>]`);
  process.exit(0);
}

const inputPath = path.resolve(root, args.input || "web/src/models/schell_table-peg_table-14.5/crib-score-histogram-frontier-by-discard-cut.json");
const outputPath = path.resolve(root, args.output || inputPath.replace(/\.json$/i, ".bin"));
const manifestPath = path.resolve(root, args.manifest || outputPath.replace(/\.bin$/i, ".manifest.json"));
const startedAt = Date.now();
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const pairKeys = generateRankSets(2).map((ranks) => ranks.join(""));
const pairIndexByKey = new Map(pairKeys.map((key, index) => [key, index]));
const entryCount = 2 * pairKeys.length * 13 * POLICIES.length;
const directoryRecords = [];
const opponentRecords = [];
const stats = {
  roots: 0,
  frontierOnFallbacks: 0,
  frontierOffFallbacks: 0,
  opponentRecords: 0,
};

for (const role of ["dealer", "pone"]) {
  for (const pairKey of pairKeys) {
    for (let cut = 0; cut < 13; cut += 1) {
      const rootEntry = source.table?.[role]?.[pairKey]?.[cut] ?? null;
      if (rootEntry) stats.roots += 1;
      for (const policy of POLICIES) {
        const policyEntry = selectPolicyEntry(rootEntry, policy);
        const offset = opponentRecords.length;
        const discards = policyEntry?.opponentDiscards ?? [];
        for (const discard of discards) {
          const pairIndex = pairIndexByKey.get(discard.ranks);
          if (pairIndex === undefined) throw new Error(`Unknown discard key ${discard.ranks}`);
          opponentRecords.push({
            pairIndex,
            weight: discard.weight,
            rankScore: discard.rankScore,
          });
        }
        directoryRecords.push({
          average: policyEntry?.average ?? 0,
          offset,
          count: discards.length,
        });
      }
    }
  }
}
stats.opponentRecords = opponentRecords.length;

const headerBytes = 32;
const directoryBytes = directoryRecords.length * 10;
const opponentRecordBytes = opponentRecords.length * 9;
const buffer = Buffer.alloc(headerBytes + directoryBytes + opponentRecordBytes);
let offset = 0;
buffer.write(MAGIC, offset, "ascii");
offset += 4;
buffer.writeUInt16LE(1, offset);
offset += 2;
buffer.writeUInt16LE(pairKeys.length, offset);
offset += 2;
buffer.writeUInt32LE(entryCount, offset);
offset += 4;
buffer.writeUInt32LE(opponentRecords.length, offset);
offset += 4;
buffer.writeUInt32LE(headerBytes, offset);
offset += 4;
buffer.writeUInt32LE(headerBytes + directoryBytes, offset);
offset += 4;
buffer.writeUInt16LE(10, offset);
offset += 2;
buffer.writeUInt16LE(9, offset);
offset += 2;
buffer.writeUInt32LE(0, offset);
offset += 4;

for (const record of directoryRecords) {
  buffer.writeFloatLE(record.average, offset);
  offset += 4;
  buffer.writeUInt32LE(record.offset, offset);
  offset += 4;
  buffer.writeUInt16LE(record.count, offset);
  offset += 2;
}
for (const record of opponentRecords) {
  buffer.writeUInt8(record.pairIndex, offset);
  offset += 1;
  buffer.writeUInt32LE(record.weight, offset);
  offset += 4;
  buffer.writeFloatLE(record.rankScore, offset);
  offset += 4;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buffer);
const manifest = {
  version: 1,
  model: "schell_table-peg_table-14.5",
  generatedAt: new Date().toISOString(),
  sourceJsonPath: path.relative(root, inputPath),
  binaryPath: path.basename(outputPath),
  binaryFormat: {
    magic: MAGIC,
    endian: "little",
    header: "magic C14B, version u16, pairCount u16, entryCount u32, opponentRecordCount u32, directoryOffset u32, recordsOffset u32, directoryRecordBytes u16, opponentRecordBytes u16, reserved u32",
    directoryRecord: "average float32, opponentRecordOffset u32, opponentRecordCount u16",
    opponentRecord: "discardPairIndex u8, weight u32, rankScore float32",
    entryIndex: "((roleIndex * pairCount + discardPairIndex) * 13 + cutRank) * policyCount + policyIndex",
    roles: ["dealer", "pone"],
    policies: POLICIES,
  },
  pairKeys,
  entryCount,
  opponentRecordCount: opponentRecords.length,
  stats,
  sourceBytes: fs.statSync(inputPath).size,
  packedBytes: fs.statSync(outputPath).size,
  savedBytes: fs.statSync(inputPath).size - fs.statSync(outputPath).size,
  elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  manifestPath: path.relative(root, manifestPath),
  sourceBytes: manifest.sourceBytes,
  packedBytes: manifest.packedBytes,
  savedBytes: manifest.savedBytes,
  savedMiB: Number((manifest.savedBytes / 1024 / 1024).toFixed(2)),
  stats,
  elapsedSeconds: manifest.elapsedSeconds,
}, null, 2));

function selectPolicyEntry(rootEntry, policy) {
  if (!rootEntry) return null;
  if (policy === "ev") return rootEntry.ev ?? null;
  const best = bestFrontierEntry(rootEntry.frontier ?? [], policy);
  if (!best) {
    if (policy === "frontier-on") stats.frontierOnFallbacks += 1;
    if (policy === "frontier-off") stats.frontierOffFallbacks += 1;
  }
  return best ?? rootEntry.ev ?? null;
}

function bestFrontierEntry(frontier, policy) {
  let best = null;
  let bestScore = null;
  for (const item of frontier) {
    const entry = item.entry;
    const direct = entry?.direct ?? [entry?.average ?? 0, 0];
    const score = policy === "frontier-on"
      ? [direct[0], -direct[1]]
      : [-direct[1], direct[0]];
    if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--input") parsed.input = next();
    else if (arg === "--output") parsed.output = next();
    else if (arg === "--manifest") parsed.manifest = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function generateRankSets(size) {
  const ranks = Array.from({ length: 13 }, () => 0);
  const result = [];
  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) result.push([...ranks]);
      return;
    }
    const max = Math.min(4, remaining);
    for (let count = 0; count <= max; count += 1) {
      ranks[rank] = count;
      visit(rank + 1, remaining - count);
    }
    ranks[rank] = 0;
  }
  visit(0, size);
  return result;
}
