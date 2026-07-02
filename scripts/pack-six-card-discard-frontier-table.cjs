#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const ROLES = ["dealer", "pone"];
const MAGIC = Buffer.from("D6F2");

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const inputPath = path.resolve(root, args.input || "benchmarks/discard-frontier/six-card-discard-frontier.json");
const outputPath = path.resolve(root, args.output || inputPath.replace(/\.json$/i, ".bin"));
const manifestPath = path.resolve(root, args.manifest || outputPath.replace(/\.bin$/i, ".manifest.json"));

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const pairKeys = generateRankSets(2).map(ranksKey);
const keepKeys = generateRankSets(4).map(ranksKey);
const sixHands = generateRankSets(6);
const pairIndexByKey = new Map(pairKeys.map((key, index) => [key, index]));
const keepIndexByKey = new Map(keepKeys.map((key, index) => [key, index]));

const rootEntries = [];
const candidateRecords = [];
const tupleRecords = [];
const tupleIdByKey = new Map();
const outcomeRefs = [];
const outcomeBlockByKey = new Map();
const rootCandidateOffsets = [0];

for (const role of ROLES) {
  for (const hand of sixHands) {
    const handKey = ranksKey(hand);
    const row = source.table?.[role]?.[handKey];
    if (!row) continue;
    rootEntries.push({ role, handKey, handLabel: row.handLabel || rankLabel(hand) });
    for (const candidate of row.candidates || []) {
      const discardPairIndex = pairIndexByKey.get(candidate.discardKey);
      const keepIndex = keepIndexByKey.get(candidate.keepKey);
      if (discardPairIndex === undefined) throw new Error(`Unknown discard pair key: ${candidate.discardKey}`);
      if (keepIndex === undefined) throw new Error(`Unknown keep key: ${candidate.keepKey}`);
      const localRefs = [];
      for (const outcome of candidate.outcomes || []) {
        const tuple = outcome.slice(0, 7);
        const tupleKey = tuple.join(",");
        let tupleId = tupleIdByKey.get(tupleKey);
        if (tupleId === undefined) {
          tupleId = tupleRecords.length;
          tupleIdByKey.set(tupleKey, tupleId);
          tupleRecords.push(tuple);
        }
        localRefs.push({ tupleId, weight: outcome[7] });
      }
      const blockKey = localRefs.map((ref) => `${ref.tupleId}:${ref.weight}`).join(";");
      let block = outcomeBlockByKey.get(blockKey);
      if (!block) {
        block = { outcomeOffset: outcomeRefs.length, outcomeCount: localRefs.length };
        outcomeBlockByKey.set(blockKey, block);
        for (const ref of localRefs) outcomeRefs.push(ref);
      }
      candidateRecords.push({
        discardPairIndex,
        keepIndex,
        outcomeOffset: block.outcomeOffset,
        outcomeCount: block.outcomeCount,
      });
    }
    rootCandidateOffsets.push(candidateRecords.length);
  }
}

writeBinary(outputPath, {
  rootCandidateOffsets,
  candidateRecords,
  tupleRecords,
  outcomeRefs,
});

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  kind: "packed six-card discard frontier validation asset",
  source: path.relative(root, inputPath),
  binaryPath: path.relative(path.dirname(manifestPath), outputPath),
  ranks: RANKS,
  roles: ROLES,
  rootCount: rootEntries.length,
  candidateCount: candidateRecords.length,
  outcomeRefCount: outcomeRefs.length,
  uniqueOutcomeTupleCount: tupleRecords.length,
  uniqueOutcomeBlockCount: outcomeBlockByKey.size,
  binaryFormat: {
    endian: "little",
    header: "magic D6F2, version u16, rootCount u32, candidateCount u32, outcomeRefCount u32, uniqueOutcomeTupleCount u32, rootOffsetCount u32, candidateRecordBytes u16, tupleRecordBytes u16, outcomeRefBytes u16",
    sections: [
      "rootCandidateOffsets uint32[rootCount + 1]",
      "candidateRecords: discardPairIndex u16, keepIndex u16, outcomeOffset u32, outcomeCount u32",
      "outcomeTupleRecords: cut u8, leadRankPlusOne u8, ownHand u8, opponentHand u8, crib u8, ownPegging u8, opponentPegging u8, reserved u8",
      "outcomeRefs: tupleId u32, weight u32",
    ],
    candidateRecordBytes: 12,
    tupleRecordBytes: 8,
    outcomeRefBytes: 8,
  },
  rootEntries,
  pairKeys,
  keepKeys,
  sourceStats: source.stats,
};
writeJsonAtomic(manifestPath, manifest);

console.log(JSON.stringify({
  status: "complete",
  inputPath: path.relative(root, inputPath),
  outputPath: path.relative(root, outputPath),
  manifestPath: path.relative(root, manifestPath),
  rootCount: rootEntries.length,
  candidateCount: candidateRecords.length,
  outcomeRefCount: outcomeRefs.length,
  uniqueOutcomeTupleCount: tupleRecords.length,
  uniqueOutcomeBlockCount: outcomeBlockByKey.size,
  jsonBytes: fs.statSync(inputPath).size,
  binaryBytes: fs.statSync(outputPath).size,
}, null, 2));

function writeBinary(outputPath, table) {
  const headerBytes = 40;
  const rootOffsetBytes = table.rootCandidateOffsets.length * 4;
  const candidateRecordBytes = 12;
  const tupleRecordBytes = 8;
  const outcomeRefBytes = 8;
  const candidateBytes = table.candidateRecords.length * candidateRecordBytes;
  const tupleBytes = table.tupleRecords.length * tupleRecordBytes;
  const outcomeRefBytesTotal = table.outcomeRefs.length * outcomeRefBytes;
  const buffer = Buffer.alloc(headerBytes + rootOffsetBytes + candidateBytes + tupleBytes + outcomeRefBytesTotal);
  let offset = 0;
  MAGIC.copy(buffer, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt32LE(table.rootCandidateOffsets.length - 1, offset);
  offset += 4;
  buffer.writeUInt32LE(table.candidateRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.outcomeRefs.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.tupleRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.rootCandidateOffsets.length, offset);
  offset += 4;
  buffer.writeUInt16LE(candidateRecordBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(tupleRecordBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(outcomeRefBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt32LE(0, offset);
  offset += 4;

  for (const value of table.rootCandidateOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const record of table.candidateRecords) {
    buffer.writeUInt16LE(record.discardPairIndex, offset);
    offset += 2;
    buffer.writeUInt16LE(record.keepIndex, offset);
    offset += 2;
    buffer.writeUInt32LE(record.outcomeOffset, offset);
    offset += 4;
    buffer.writeUInt32LE(record.outcomeCount, offset);
    offset += 4;
  }
  for (const tuple of table.tupleRecords) {
    const [cut, leadRank, ownHand, opponentHand, crib, ownPegging, opponentPegging] = tuple;
    buffer.writeUInt8(cut, offset);
    offset += 1;
    buffer.writeUInt8(leadRank + 1, offset);
    offset += 1;
    buffer.writeUInt8(ownHand, offset);
    offset += 1;
    buffer.writeUInt8(opponentHand, offset);
    offset += 1;
    buffer.writeUInt8(crib, offset);
    offset += 1;
    buffer.writeUInt8(ownPegging, offset);
    offset += 1;
    buffer.writeUInt8(opponentPegging, offset);
    offset += 1;
    buffer.writeUInt8(0, offset);
    offset += 1;
  }
  for (const outcome of table.outcomeRefs) {
    buffer.writeUInt32LE(outcome.tupleId, offset);
    offset += 4;
    buffer.writeUInt32LE(outcome.weight, offset);
    offset += 4;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = next();
    else if (arg === "--output") args.output = next();
    else if (arg === "--manifest") args.manifest = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/pack-six-card-discard-frontier-table.cjs --input <json> [--output <bin>] [--manifest <json>]

Packs a validation JSON six-card discard frontier table into an aligned binary
format. This is intentionally a separate step from generation so the JSON
builder remains easy to inspect and debug during calibration.
`);
}

function generateRankSets(size) {
  const result = [];
  const counts = Array.from({ length: 13 }, () => 0);
  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) result.push(counts.slice());
      return;
    }
    for (let used = 0; used <= Math.min(4, remaining); used += 1) {
      counts[rank] = used;
      visit(rank + 1, remaining - used);
    }
    counts[rank] = 0;
  }
  visit(0, size);
  return result;
}

function ranksKey(counts) {
  return counts.join("");
}

function rankLabel(counts) {
  const ranks = [];
  counts.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) ranks.push(RANKS[rank]);
  });
  return ranks.join(" ");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}
