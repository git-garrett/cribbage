#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  RANKS,
  ROLES,
  createDiscardMemos,
  discardDistributionForHand,
  generateRankSets,
  nonNegativeInt,
  parseRanksKey,
  positiveInt,
  rankLabel,
  ranksKey,
  round,
  writeJsonAtomic,
} = require("./lib/six-card-rank-utils.cjs");

const root = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(root, "web", "src", "models", "rank-crib-discard");
const DEFAULT_OUTPUT = path.join(DEFAULT_OUT_DIR, "six-card-discard-policy.bin");
const MAGIC = "D6P1";
const RECORD_BYTES = 8;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const outputPath = path.resolve(root, args.output || DEFAULT_OUTPUT);
  const manifestPath = path.resolve(root, args.manifest || outputPath.replace(/\.bin$/i, ".manifest.json"));
  const checkpointPath = path.resolve(root, args.checkpoint || outputPath.replace(/\.bin$/i, ".checkpoint.json"));
  const statusPath = path.resolve(root, args.status || outputPath.replace(/\.bin$/i, ".status.json"));
  const checkpointInterval = positiveInt(args.checkpointInterval, 250);
  const memoLimit = positiveInt(args.memoLimit, 200000);
  const startRoot = nonNegativeInt(args.startRoot, 0);
  const limit = nonNegativeInt(args.limit, 0);
  const resume = args.resume !== false;

  const sixHands = generateRankSets(6);
  const pairKeys = generateRankSets(2).map(ranksKey);
  const pairIndexByKey = new Map(pairKeys.map((key, index) => [key, index]));
  const roots = buildRoots(sixHands);
  const activeRoots = roots.slice(startRoot, limit > 0 ? Math.min(roots.length, startRoot + limit) : roots.length);
  if (!activeRoots.length) throw new Error("No active roots selected");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });

  const fingerprint = {
    magic: MAGIC,
    version: 1,
    startRoot,
    limit,
    activeRootCount: activeRoots.length,
    totalRootCount: roots.length,
    sixHandCount: sixHands.length,
  };
  const memos = createDiscardMemos(memoLimit);
  const state = resume
    ? readCheckpoint(checkpointPath, fingerprint)
    : null;
  const rootOffsets = state?.rootOffsets ?? [0];
  const records = state?.records ?? [];
  const stats = state?.stats ?? emptyStats();
  const startedAt = Date.now();
  let nextActiveRoot = state?.nextActiveRoot ?? 0;
  let stopping = false;

  const writeStatus = (status = "running") => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const completedRoots = nextActiveRoot;
    const rootsPerSecond = completedRoots / Math.max(0.001, elapsedSeconds);
    const pendingRoots = activeRoots.length - completedRoots;
    writeJsonAtomic(statusPath, {
      status,
      kind: "six-card-discard-policy",
      outputPath: path.relative(root, outputPath),
      manifestPath: path.relative(root, manifestPath),
      checkpointPath: path.relative(root, checkpointPath),
      totalRoots: activeRoots.length,
      completedRoots,
      pendingRoots,
      progressPercent: round((completedRoots / activeRoots.length) * 100, 3),
      rootsPerSecond: round(rootsPerSecond, 3),
      estimatedRemainingSeconds: rootsPerSecond ? Math.round(pendingRoots / rootsPerSecond) : null,
      records: records.length,
      stats,
      memoHighWater: memoHighWater(memos),
      updatedAt: new Date().toISOString(),
    });
  };
  const writeCheckpoint = () => {
    writeJsonAtomic(checkpointPath, {
      ...fingerprint,
      nextActiveRoot,
      rootOffsets,
      records,
      stats,
      updatedAt: new Date().toISOString(),
    });
  };
  const stop = () => {
    stopping = true;
    writeStatus("stopping");
    writeCheckpoint();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  writeStatus();
  for (; nextActiveRoot < activeRoots.length; nextActiveRoot += 1) {
    if (stopping) break;
    const rootEntry = activeRoots[nextActiveRoot];
    const choices = discardDistributionForHand({
      hand: rootEntry.hand,
      role: rootEntry.role,
      memos,
    });
    let rowWeight = 0;
    for (const choice of choices) {
      const pairIndex = pairIndexByKey.get(choice.discardKey);
      if (pairIndex === undefined) throw new Error(`Unknown discard pair key: ${choice.discardKey}`);
      records.push({
        pairIndex,
        weight: positiveInt(choice.weight, 1),
      });
      rowWeight += positiveInt(choice.weight, 1);
      stats.discardPairCounts[choice.discardKey] = (stats.discardPairCounts[choice.discardKey] ?? 0) + 1;
    }
    rootOffsets.push(records.length);
    stats.rootCount += 1;
    stats.recordCount += choices.length;
    stats.totalRowWeight += rowWeight;
    stats.maxChoicesPerRoot = Math.max(stats.maxChoicesPerRoot, choices.length);
    stats.byRole[rootEntry.role].rootCount += 1;
    stats.byRole[rootEntry.role].recordCount += choices.length;

    if ((nextActiveRoot + 1) % checkpointInterval === 0) {
      nextActiveRoot += 1;
      writeCheckpoint();
      writeStatus();
      nextActiveRoot -= 1;
    }
  }

  if (stopping || nextActiveRoot < activeRoots.length) {
    writeCheckpoint();
    writeStatus("stopped");
    console.log(JSON.stringify({
      status: "stopped",
      completedRoots: nextActiveRoot,
      totalRoots: activeRoots.length,
      checkpointPath: path.relative(root, checkpointPath),
    }, null, 2));
    return;
  }

  writeStatus("packing");
  writeBinary(outputPath, { rootOffsets, records, pairCount: pairKeys.length });
  const manifest = buildManifest({
    outputPath,
    manifestPath,
    checkpointPath,
    statusPath,
    sixHands,
    pairKeys,
    activeRoots,
    roots,
    startRoot,
    limit,
    stats,
    memos,
    startedAt,
  });
  writeJsonAtomic(manifestPath, manifest);
  writeStatus("complete");
  console.log(JSON.stringify({
    status: "complete",
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    rootCount: activeRoots.length,
    recordCount: records.length,
    binaryBytes: fs.statSync(outputPath).size,
    manifestBytes: fs.statSync(manifestPath).size,
    elapsedSeconds: manifest.elapsedSeconds,
  }, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--output") args.output = next();
    else if (arg === "--manifest") args.manifest = next();
    else if (arg === "--checkpoint") args.checkpoint = next();
    else if (arg === "--status") args.status = next();
    else if (arg === "--checkpoint-interval") args.checkpointInterval = next();
    else if (arg === "--memo-limit") args.memoLimit = next();
    else if (arg === "--start-root") args.startRoot = next();
    else if (arg === "--limit") args.limit = next();
    else if (arg === "--no-resume") args.resume = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-six-card-discard-policy-table.cjs [options]

Builds a compact restartable table:
  six-card rank hand + role -> discard-rank histogram

The current policy is deterministic rank-only board-neutral model-13-style EV:
hand EV plus crib EV as dealer, or hand EV minus opponent crib EV as pone.

Options:
  --output <path>              Defaults to web/src/models/rank-crib-discard/six-card-discard-policy.bin
  --manifest <path>
  --checkpoint <path>
  --status <path>
  --checkpoint-interval <n>    Defaults to 250 roots
  --memo-limit <n>             Defaults to 200000 entries per memo
  --start-root <n>             Calibration subset start
  --limit <n>                  Calibration subset length; 0 means all
  --no-resume                  Ignore an existing matching checkpoint
`);
}

function buildRoots(sixHands) {
  const roots = [];
  let id = 0;
  for (const role of ROLES) {
    for (const hand of sixHands) {
      roots.push({
        id,
        role,
        hand,
        handKey: ranksKey(hand),
      });
      id += 1;
    }
  }
  return roots;
}

function emptyStats() {
  return {
    rootCount: 0,
    recordCount: 0,
    totalRowWeight: 0,
    maxChoicesPerRoot: 0,
    byRole: {
      dealer: { rootCount: 0, recordCount: 0 },
      pone: { rootCount: 0, recordCount: 0 },
    },
    discardPairCounts: {},
  };
}

function readCheckpoint(checkpointPath, fingerprint) {
  if (!fs.existsSync(checkpointPath)) return null;
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    for (const [key, value] of Object.entries(fingerprint)) {
      if (checkpoint[key] !== value) return null;
    }
    if (!Array.isArray(checkpoint.rootOffsets) || !Array.isArray(checkpoint.records)) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

function writeBinary(outputPath, table) {
  const headerBytes = 36;
  const rootOffsetBytes = table.rootOffsets.length * 4;
  const recordsOffset = headerBytes + rootOffsetBytes;
  const buffer = Buffer.alloc(recordsOffset + (table.records.length * RECORD_BYTES));
  let offset = 0;
  buffer.write(MAGIC, offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(RECORD_BYTES, offset);
  offset += 2;
  buffer.writeUInt32LE(table.rootOffsets.length - 1, offset);
  offset += 4;
  buffer.writeUInt32LE(table.records.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.rootOffsets.length, offset);
  offset += 4;
  buffer.writeUInt32LE(headerBytes, offset);
  offset += 4;
  buffer.writeUInt32LE(recordsOffset, offset);
  offset += 4;
  buffer.writeUInt16LE(table.pairCount, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  for (const value of table.rootOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const record of table.records) {
    buffer.writeUInt16LE(record.pairIndex, offset);
    offset += 2;
    buffer.writeUInt32LE(record.weight, offset);
    offset += 4;
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function buildManifest({
  outputPath,
  manifestPath,
  checkpointPath,
  statusPath,
  sixHands,
  pairKeys,
  activeRoots,
  roots,
  startRoot,
  limit,
  stats,
  memos,
  startedAt,
}) {
  const completeRootSet = startRoot === 0 && activeRoots.length === roots.length;
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "six-card rank discard policy table",
    policy: "deterministic rank-only board-neutral model-13-style discard EV",
    semantics: "For each six-card rank hand and role, records store a histogram of selected rank-only discard pairs. The deterministic initial table emits one record with weight 1 per root.",
    currentLimitations: [
      "Suit-shape aggregation is not represented yet; this is the deterministic rank-only policy used by the six-card frontier calibration builder.",
      "Weights are histogram counts. Consumers should normalize weights within a root before treating choices as probabilities.",
    ],
    binaryPath: path.relative(path.dirname(manifestPath), outputPath),
    checkpointPath: path.relative(root, checkpointPath),
    statusPath: path.relative(root, statusPath),
    binaryFormat: {
      magic: MAGIC,
      endian: "little",
      header: "magic D6P1, version u16, recordBytes u16, rootCount u32, recordCount u32, rootOffsetCount u32, rootOffsetsOffset u32, recordsOffset u32, pairCount u16, reserved",
      sections: [
        "rootOffsets uint32[rootCount + 1]",
        "records: discardPairIndex u16, weight u32, reserved u16",
      ],
      rootOrder: completeRootSet
        ? "role-major: all dealer six-card rank hands in sixHandKeys order, then all pone six-card rank hands"
        : "rootEntries order",
    },
    ranks: RANKS,
    roles: ROLES,
    pairKeys,
    sixHandKeys: sixHands.map(ranksKey),
    rootCount: activeRoots.length,
    totalRootCount: roots.length,
    completeRootSet,
    startRoot,
    limit,
    stats: {
      ...stats,
      uniqueDiscardPairs: Object.keys(stats.discardPairCounts).length,
    },
    memoHighWater: memoHighWater(memos),
    binaryBytes: fs.statSync(outputPath).size,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
  if (!completeRootSet) {
    manifest.rootEntries = activeRoots.map((entry) => ({
      id: entry.id,
      role: entry.role,
      handKey: entry.handKey,
      handLabel: rankLabel(parseRanksKey(entry.handKey)),
    }));
  }
  return manifest;
}

function memoHighWater(memos) {
  return Math.max(...Object.values(memos).map((memo) => memo.highWater));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
