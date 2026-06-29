#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const MAGIC = "C14B";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/pack-full-frontier-crib-discard-asset.cjs --input <json> --output <bin> [--manifest <json>]

Packs a full crib-discard frontier JSON table into the existing C14B binary
shape, preserving EV plus every indexed frontier entry as policies:
ev, frontier:0, frontier:1, ...
`);
  process.exit(0);
}

const inputPath = path.resolve(root, args.input || "benchmarks/crib-discard/frontier-crib-14.5-full-20260628/crib-score-histogram-frontier-by-discard-cut.json");
const outputPath = path.resolve(root, args.output || "web/src/models/schell_table-peg_table-14.6/crib-score-histogram-full-frontier-by-discard-cut.bin");
const manifestPath = path.resolve(root, args.manifest || outputPath.replace(/\.bin$/i, ".manifest.json"));
const startedAt = Date.now();
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const pairKeys = generateRankSets(2).map((ranks) => ranks.join(""));
const pairIndexByKey = new Map(pairKeys.map((key, index) => [key, index]));
const maxFrontierEntries = findMaxFrontierEntries(source.table);
const policies = ["ev", ...Array.from({ length: maxFrontierEntries }, (_, index) => `frontier:${index}`)];
const entryCount = 2 * pairKeys.length * 13 * policies.length;
const directoryRecords = [];
const opponentRecords = [];
const stats = {
  roots: 0,
  maxFrontierEntries,
  frontierEntriesStored: 0,
  frontierFallbacks: 0,
  opponentRecords: 0,
};

for (const role of ["dealer", "pone"]) {
  for (const pairKey of pairKeys) {
    for (let cut = 0; cut < 13; cut += 1) {
      const rootEntry = source.table?.[role]?.[pairKey]?.[cut] ?? null;
      if (rootEntry) stats.roots += 1;
      for (const policy of policies) {
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
  model: "schell_table-peg_table-14.6",
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
    policies,
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

function findMaxFrontierEntries(table) {
  let max = 0;
  for (const role of ["dealer", "pone"]) {
    for (const cuts of Object.values(table?.[role] ?? {})) {
      for (const entry of cuts ?? []) {
        max = Math.max(max, entry?.frontier?.length ?? 0);
      }
    }
  }
  return max;
}

function selectPolicyEntry(rootEntry, policy) {
  if (!rootEntry) return null;
  if (policy === "ev") return rootEntry.ev ?? null;
  const index = frontierPolicyIndex(policy);
  if (index === null) return null;
  const entry = rootEntry.frontier?.[index]?.entry ?? null;
  if (entry) {
    stats.frontierEntriesStored += 1;
    return entry;
  }
  stats.frontierFallbacks += 1;
  return null;
}

function frontierPolicyIndex(policy) {
  if (!policy.startsWith("frontier:")) return null;
  const value = Number.parseInt(policy.slice("frontier:".length), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
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
