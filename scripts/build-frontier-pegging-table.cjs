#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const HUMAN = "human";
const AI = "ai";
const MAGIC = Buffer.from("P45F");
const DEFAULT_EV_PATH = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const outDir = path.resolve(root, args.outDir || path.join("benchmarks", "pegging-table", `frontier-pegging-14.5-${dateSlug()}`));
  const outputPath = path.resolve(root, args.output || path.join(outDir, "pegging-outcome-frontier-overrides.bin"));
  const manifestPath = outputPath.replace(/\.bin$/i, ".manifest.json");
  const evPath = path.resolve(root, args.evPath || DEFAULT_EV_PATH);
  const checkpointDir = path.join(outDir, "checkpoints");
  const statusPath = path.join(outDir, "status.json");
  const workerCount = positiveInt(args.workers, Math.max(1, Math.min(os.cpus().length - 2, 6)));
  const oldMb = positiveInt(args.oldMb, 1024);
  const memoLimit = positiveInt(args.memoLimit, 50000);
  const keepLimit = positiveInt(args.limit, 0);
  const startKeep = positiveInt(args.startKeep, 0);
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keeps.slice(startKeep, keepLimit > 0 ? Math.min(keeps.length, startKeep + keepLimit) : keeps.length);
  fs.mkdirSync(checkpointDir, { recursive: true });

  const evTable = readEvPairwiseTable(evPath);
  if (evTable.keepCount !== keeps.length) throw new Error(`EV table keep count mismatch: ${evTable.keepCount} vs ${keeps.length}`);
  const statsCache = new Map();

  let stopping = false;
  const startedAt = Date.now();
  let lastCompletedRoots = 0;
  let lastCompletedAt = Date.now();
  const writeStatus = (status = "running") => {
    const completedRoots = countCompleted(activeKeeps, checkpointDir);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const deltaRoots = completedRoots - lastCompletedRoots;
    const deltaSeconds = Math.max(0.001, (Date.now() - lastCompletedAt) / 1000);
    const recentRootsPerSecond = deltaRoots / deltaSeconds;
    if (deltaRoots > 0) {
      lastCompletedRoots = completedRoots;
      lastCompletedAt = Date.now();
    }
    const rootsPerSecond = completedRoots / Math.max(0.001, elapsedSeconds);
    const pendingRoots = activeKeeps.length - completedRoots;
    const estimateRate = recentRootsPerSecond > 0 ? recentRootsPerSecond : rootsPerSecond;
    const estimatedRemainingSeconds = estimateRate > 0 ? Math.round(pendingRoots / estimateRate) : null;
    writeJsonAtomic(statusPath, {
      status,
      runId: path.basename(outDir),
      kind: "pegging-frontier-14.5",
      outDir: path.relative(root, outDir),
      checkpointDir: path.relative(root, checkpointDir),
      outputPath: path.relative(root, outputPath),
      evPath: path.relative(root, evPath),
      workers: Math.min(workerCount, Math.max(1, activeKeeps.length)),
      oldMb,
      memoLimit,
      startKeep,
      totalRoots: activeKeeps.length,
      totalRows: activeKeeps.length,
      completedRoots,
      completedRows: completedRoots,
      pendingRoots,
      progressPercent: activeKeeps.length ? round((completedRoots / activeKeeps.length) * 100, 3) : 100,
      rootsPerSecond: round(rootsPerSecond, 4),
      recentRootsPerSecond: round(recentRootsPerSecond, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      frontierStats: collectFrontierStats(activeKeeps, checkpointDir, evTable, statsCache),
      updatedAt: new Date().toISOString(),
    });
  };
  const stop = () => {
    stopping = true;
    writeStatus("stopping");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  writeStatus();
  const interval = setInterval(() => writeStatus(stopping ? "stopping" : "running"), 10000);
  const pending = activeKeeps.filter((keep) => !fs.existsSync(checkpointPath(checkpointDir, keep.id)));
  const workers = Math.max(1, Math.min(workerCount, pending.length || 1));
  const chunks = makeBalancedChunks(pending, workers);

  try {
    await Promise.all(chunks.map((chunk, workerIndex) => runChunk({ chunk, keeps, checkpointDir, memoLimit, oldMb, workerIndex })));
  } finally {
    clearInterval(interval);
  }

  const completedRoots = countCompleted(activeKeeps, checkpointDir);
  if (stopping || completedRoots < activeKeeps.length) {
    writeStatus("stopped");
    console.log(JSON.stringify({
      status: "stopped",
      completedRoots,
      totalRoots: activeKeeps.length,
      statusPath: path.relative(root, statusPath),
    }, null, 2));
    return;
  }

  writeStatus("assembling");
  const summary = assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, evPath, evTable, startedAt, workerCount, oldMb, memoLimit, statsCache });
  writeStatus("complete");
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--out-dir") args.outDir = next();
    else if (arg === "--output") args.output = next();
    else if (arg === "--ev-path") args.evPath = next();
    else if (arg === "--workers") args.workers = next();
    else if (arg === "--memo-limit") args.memoLimit = next();
    else if (arg === "--old-mb") args.oldMb = next();
    else if (arg === "--limit") args.limit = next();
    else if (arg === "--start-keep") args.startKeep = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-frontier-pegging-table.cjs [options]

Builds a restartable 14.5 pegging frontier table. EV remains in the existing
12.0 pairwise table. This artifact stores only non-EV Pareto point-pair
frontier outcomes for each keep/opponent-keep/role/lead context.

Options:
  --out-dir <path>
  --output <path>
  --ev-path <path>       Defaults to 12.0 pegging-outcome-pairwise.bin
  --workers <n>
  --memo-limit <n>
  --old-mb <n>
  --limit <n>
  --start-keep <n>
`);
}

function runChunk({ chunk, keeps, checkpointDir, memoLimit, oldMb, workerIndex }) {
  return new Promise((resolve, reject) => {
    if (!chunk.length) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, checkpointDir, memoLimit, workerIndex },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "complete") resolve();
      else if (message?.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  });
}

async function runWorker({ chunk, keeps, checkpointDir, memoLimit, workerIndex }) {
  for (const ownKeep of chunk) {
    const outPath = checkpointPath(checkpointDir, ownKeep.id);
    if (fs.existsSync(outPath)) continue;
    const startedAt = Date.now();
    const checkpoint = buildKeepCheckpoint({ ownKeep, keeps, memoLimit });
    checkpoint.workerIndex = workerIndex;
    checkpoint.elapsedMs = Date.now() - startedAt;
    writeJsonAtomic(outPath, checkpoint);
  }
  parentPort.postMessage({ type: "complete" });
}

function buildKeepCheckpoint({ ownKeep, keeps, memoLimit }) {
  const legalLeadRanks = legalRanks(ownKeep.ranks, 0);
  const legalLeadSet = new Set(legalLeadRanks);
  const dealerRecords = [];
  const leadRecords = Array.from({ length: 13 }, () => []);
  let validPairCount = 0;
  let memoHighWater = 0;

  for (const opponentKeep of keeps) {
    if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
    const pairWeight = opponentWeight(ownKeep.ranks, opponentKeep.ranks);
    if (!pairWeight) continue;
    validPairCount += 1;

    const dealerMemo = new LimitedMemo(memoLimit);
    const dealerFrontier = solveFrontier({
      hands: { human: ownKeep.ranks.slice(), ai: opponentKeep.ranks.slice() },
      plays: [],
      count: 0,
      current: AI,
      goPlayer: null,
      lastPlayer: null,
      perspective: HUMAN,
    }, dealerMemo);
    memoHighWater = Math.max(memoHighWater, dealerMemo.highWater);
    dealerRecords.push([opponentKeep.id, pairWeight, dealerFrontier]);

    const leadMemo = new LimitedMemo(memoLimit);
    for (const lead of legalLeadRanks) {
      const afterLead = ownKeep.ranks.slice();
      afterLead[lead] -= 1;
      const frontier = solveFrontier({
        hands: { human: afterLead, ai: opponentKeep.ranks.slice() },
        plays: [lead],
        count: VALUES[lead],
        current: AI,
        goPlayer: null,
        lastPlayer: HUMAN,
        perspective: HUMAN,
      }, leadMemo);
      memoHighWater = Math.max(memoHighWater, leadMemo.highWater);
      leadRecords[lead].push([opponentKeep.id, pairWeight, frontier]);
    }
  }

  for (let lead = 0; lead < 13; lead += 1) {
    if (!legalLeadSet.has(lead)) leadRecords[lead] = [];
  }

  return {
    version: 1,
    keepId: ownKeep.id,
    keepKey: ownKeep.key,
    legalLeadRanks,
    validPairCount,
    memoHighWater,
    dealerRecords,
    leadRecords,
  };
}

function solveFrontier(state, memo) {
  const key = frontierStateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = totalRanks(state.hands.human) + totalRanks(state.hands.ai);
  if (remaining === 0) {
    let pair = packPair(0, 0);
    if (state.lastPlayer && state.count !== 0) {
      pair = state.lastPlayer === state.perspective ? packPair(1, 0) : packPair(0, 1);
    }
    const result = [pair];
    memo.set(key, result);
    return result;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  let result = [];
  if (!legal.length) {
    if (state.goPlayer) {
      const next = {
        ...state,
        plays: [],
        count: 0,
        current: otherPlayer(state.current),
        goPlayer: null,
        lastPlayer: null,
      };
      result = solveFrontier(next, memo).map((pair) => {
        if (!state.lastPlayer || state.count === 31) return pair;
        const [my, opponent] = unpackPair(pair);
        return state.lastPlayer === state.perspective ? packPair(my + 1, opponent) : packPair(my, opponent + 1);
      });
    } else {
      result = solveFrontier({
        ...state,
        current: otherPlayer(state.current),
        goPlayer: state.current,
      }, memo);
    }
    const filtered = paretoFilter(result);
    memo.set(key, filtered);
    return filtered;
  }

  const merged = [];
  for (const rank of legal) {
    const hands = {
      human: state.hands.human.slice(),
      ai: state.hands.ai.slice(),
    };
    hands[state.current][rank] -= 1;
    const plays = state.plays.concat(rank);
    const points = scoreCountRanks(plays);
    const nextCount = state.count + VALUES[rank];
    const nextState = nextCount === 31
      ? { ...state, hands, plays: [], count: 0, current: otherPlayer(state.current), goPlayer: null, lastPlayer: null }
      : { ...state, hands, plays, count: nextCount, current: otherPlayer(state.current), goPlayer: null, lastPlayer: state.current };
    for (const pair of solveFrontier(nextState, memo)) {
      const [my, opponent] = unpackPair(pair);
      merged.push(state.current === state.perspective ? packPair(my + points, opponent) : packPair(my, opponent + points));
    }
  }
  const filtered = paretoFilter(merged);
  memo.set(key, filtered);
  return filtered;
}

function paretoFilter(pairs) {
  const unique = [...new Set(pairs)];
  const keep = [];
  for (const pair of unique) {
    const [my, opponent] = unpackPair(pair);
    let dominated = false;
    for (const other of unique) {
      if (other === pair) continue;
      const [otherMy, otherOpponent] = unpackPair(other);
      if (otherMy >= my && otherOpponent <= opponent && (otherMy > my || otherOpponent < opponent)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) keep.push(pair);
  }
  keep.sort((a, b) => {
    const [aMy, aOpponent] = unpackPair(a);
    const [bMy, bOpponent] = unpackPair(b);
    return aMy - bMy || bOpponent - aOpponent;
  });
  return keep;
}

function assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, evPath, evTable, startedAt, workerCount, oldMb, memoLimit, statsCache }) {
  const dealerOffsets = new Uint32Array(keeps.length + 1);
  const poneOffsets = new Uint32Array((keeps.length * 13) + 1);
  const dealerRecords = [];
  const poneRecords = [];
  const outcomes = [];
  let validPairCount = 0;
  let memoHighWater = 0;
  const frontierStats = emptyFrontierStats();

  for (const keep of activeKeeps) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(checkpointDir, keep.id), "utf8"));
    validPairCount += checkpoint.validPairCount;
    memoHighWater = Math.max(memoHighWater, checkpoint.memoHighWater || 0);

    dealerOffsets[keep.id] = dealerRecords.length;
    const evDealer = evTable.dealerRecords.slice(evTable.dealerOffsets[keep.id], evTable.dealerOffsets[keep.id + 1]);
    addFrontierRecords(dealerRecords, outcomes, evDealer, checkpoint.dealerRecords, `dealer keep ${keep.id}`, frontierStats);
    dealerOffsets[keep.id + 1] = dealerRecords.length;

    for (let lead = 0; lead < 13; lead += 1) {
      const offsetIndex = (keep.id * 13) + lead;
      poneOffsets[offsetIndex] = poneRecords.length;
      const evPone = evTable.poneRecords.slice(evTable.poneOffsets[offsetIndex], evTable.poneOffsets[offsetIndex + 1]);
      addFrontierRecords(poneRecords, outcomes, evPone, checkpoint.leadRecords[lead] || [], `pone keep ${keep.id} lead ${lead}`, frontierStats);
      poneOffsets[offsetIndex + 1] = poneRecords.length;
    }
  }
  fillOffsets(dealerOffsets);
  fillOffsets(poneOffsets);
  addFrontierRates(frontierStats);
  writeFrontierBinary(outputPath, {
    keepCount: keeps.length,
    dealerOffsets,
    poneOffsets,
    dealerRecords,
    poneRecords,
    outcomes,
  });
  const liveFrontierStats = collectFrontierStats(activeKeeps, checkpointDir, evTable, statsCache);
  const manifest = {
    version: 1,
    model: "pegging-frontier-14.5",
    generatedAt: new Date().toISOString(),
    policy: "sparse Pareto pegging frontier supplement: EV rows are reused from 12.0; only non-EV non-dominated point-pair outcomes are stored",
    evSource: path.relative(root, evPath),
    ranks: RANKS,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      magic: "P45F",
      endian: "little",
      header: "magic P45F, version u16, keepCount u16, dealerRecordCount u32, poneRecordCount u32, outcomeCount u32, recordBytes u16, outcomeBytes u16, reserved u64",
      sections: [
        "dealerOffsets uint32[keepCount + 1]",
        "poneOffsets uint32[keepCount * 13 + 1]",
        "dealerRecords 8-byte records",
        "poneRecords 8-byte records",
        "outcomes uint16[outcomeCount]",
      ],
      record: "opponentKeepId u16, outcomeOffset u32, outcomeCount u16",
      outcome: "myPeggingPoints bits 0-5, opponentPeggingPoints bits 6-11",
    },
    workerCount,
    oldMb,
    memoLimit,
    memoHighWater,
    dealerRecordCount: dealerRecords.length,
    poneRecordCount: poneRecords.length,
    outcomeCount: outcomes.length,
    frontierStats,
    liveFrontierStats,
    keepKeys: keeps.map((keep) => keep.key),
  };
  writeJsonAtomic(manifestPath, manifest);
  return {
    status: "complete",
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    evPath: path.relative(root, evPath),
    binaryBytes: fs.statSync(outputPath).size,
    validPairCount,
    dealerRecordCount: dealerRecords.length,
    poneRecordCount: poneRecords.length,
    outcomeCount: outcomes.length,
    frontierStats,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
}

function addFrontierRecords(records, outcomes, evRecords, frontierRecords, label, stats) {
  if (evRecords.length !== frontierRecords.length) {
    throw new Error(`${label} record count mismatch: EV ${evRecords.length} vs frontier ${frontierRecords.length}`);
  }
  for (let index = 0; index < evRecords.length; index += 1) {
    const ev = unpackEvRecord(evRecords[index]);
    const [opponentKeepId, weight, frontier] = frontierRecords[index];
    if (ev.opponentKeepId !== opponentKeepId || ev.weight !== weight) {
      throw new Error(`${label} record ${index} mismatch: EV ${JSON.stringify(ev)} vs frontier ${JSON.stringify(frontierRecords[index])}`);
    }
    const kept = filterFrontierAgainstEv(frontier, ev);
    stats.sourceRecords += 1;
    stats.sourceOutcomes += frontier.length;
    if (!kept.length) {
      stats.recordsFullyOmitted += 1;
      continue;
    }
    stats.overrideRecords += 1;
    stats.storedOutcomes += kept.length;
    const outcomeOffset = outcomes.length;
    outcomes.push(...kept);
    records.push({ opponentKeepId, outcomeOffset, outcomeCount: kept.length });
  }
}

function filterFrontierAgainstEv(frontier, ev) {
  const evPair = packPair(ev.myPegging, ev.opponentPegging);
  const filtered = [];
  for (const pair of frontier) {
    if (pair === evPair) continue;
    const [my, opponent] = unpackPair(pair);
    if (ev.myPegging >= my && ev.opponentPegging <= opponent) continue;
    filtered.push(pair);
  }
  return paretoFilter(filtered);
}

function emptyFrontierStats() {
  return {
    sourceRecords: 0,
    overrideRecords: 0,
    recordsFullyOmitted: 0,
    sourceOutcomes: 0,
    storedOutcomes: 0,
    fullyOmittedRate: 0,
    averageSourceOutcomes: 0,
    averageStoredOutcomes: 0,
  };
}

function mergeFrontierStats(target, source) {
  for (const key of ["sourceRecords", "overrideRecords", "recordsFullyOmitted", "sourceOutcomes", "storedOutcomes"]) {
    target[key] += source[key] || 0;
  }
  return target;
}

function addFrontierRates(stats) {
  stats.fullyOmittedRate = stats.sourceRecords ? round(stats.recordsFullyOmitted / stats.sourceRecords, 6) : 0;
  stats.averageSourceOutcomes = stats.sourceRecords ? round(stats.sourceOutcomes / stats.sourceRecords, 4) : 0;
  stats.averageStoredOutcomes = stats.overrideRecords ? round(stats.storedOutcomes / stats.overrideRecords, 4) : 0;
  return stats;
}

function collectFrontierStats(activeKeeps, checkpointDir, evTable, cache) {
  const total = emptyFrontierStats();
  let completedRootsWithStats = 0;
  for (const keep of activeKeeps) {
    const outPath = checkpointPath(checkpointDir, keep.id);
    if (!fs.existsSync(outPath)) continue;
    let stats = cache.get(keep.id);
    if (!stats) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(outPath, "utf8"));
        stats = frontierStatsForCheckpoint(keep.id, checkpoint, evTable);
        cache.set(keep.id, stats);
      } catch {
        continue;
      }
    }
    completedRootsWithStats += 1;
    mergeFrontierStats(total, stats);
  }
  addFrontierRates(total);
  total.completedRootsWithStats = completedRootsWithStats;
  return total;
}

function frontierStatsForCheckpoint(keepId, checkpoint, evTable) {
  const stats = emptyFrontierStats();
  const evDealer = evTable.dealerRecords.slice(evTable.dealerOffsets[keepId], evTable.dealerOffsets[keepId + 1]);
  addFrontierRecords([], [], evDealer, checkpoint.dealerRecords, `dealer keep ${keepId}`, stats);
  for (let lead = 0; lead < 13; lead += 1) {
    const offsetIndex = (keepId * 13) + lead;
    const evPone = evTable.poneRecords.slice(evTable.poneOffsets[offsetIndex], evTable.poneOffsets[offsetIndex + 1]);
    addFrontierRecords([], [], evPone, checkpoint.leadRecords[lead] || [], `pone keep ${keepId} lead ${lead}`, stats);
  }
  return addFrontierRates(stats);
}

function writeFrontierBinary(outputPath, table) {
  const headerBytes = 32;
  const dealerOffsetBytes = table.dealerOffsets.length * 4;
  const poneOffsetBytes = table.poneOffsets.length * 4;
  const recordBytes = 8;
  const outcomeBytes = 2;
  const dealerBytes = table.dealerRecords.length * recordBytes;
  const poneBytes = table.poneRecords.length * recordBytes;
  const outcomesBytes = table.outcomes.length * outcomeBytes;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + dealerBytes + poneBytes + outcomesBytes);
  let offset = 0;
  MAGIC.copy(buffer, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(table.keepCount, offset);
  offset += 2;
  buffer.writeUInt32LE(table.dealerRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.poneRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.outcomes.length, offset);
  offset += 4;
  buffer.writeUInt16LE(recordBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(outcomeBytes, offset);
  offset += 2;
  buffer.writeBigUInt64LE(0n, offset);
  offset += 8;
  for (const value of table.dealerOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of table.poneOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  offset = writeFrontierRecords(buffer, offset, table.dealerRecords);
  offset = writeFrontierRecords(buffer, offset, table.poneRecords);
  for (const outcome of table.outcomes) {
    buffer.writeUInt16LE(outcome, offset);
    offset += 2;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function writeFrontierRecords(buffer, offset, records) {
  for (const record of records) {
    buffer.writeUInt16LE(record.opponentKeepId, offset);
    offset += 2;
    buffer.writeUInt32LE(record.outcomeOffset, offset);
    offset += 4;
    buffer.writeUInt16LE(record.outcomeCount, offset);
    offset += 2;
  }
  return offset;
}

function readEvPairwiseTable(filePath) {
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.subarray(0, 4).toString("ascii");
  if (magic !== "P12P") throw new Error(`Expected P12P EV table, found ${magic}`);
  const version = buffer.readUInt16LE(4);
  if (version !== 1) throw new Error(`Unsupported EV table version ${version}`);
  const keepCount = buffer.readUInt16LE(6);
  const dealerRecordCount = buffer.readUInt32LE(8);
  const poneRecordCount = buffer.readUInt32LE(12);
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerRecords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, dealerRecordCount);
  offset += dealerRecordCount * 4;
  const poneRecords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, poneRecordCount);
  return { keepCount, dealerOffsets, poneOffsets, dealerRecords, poneRecords };
}

function unpackEvRecord(record) {
  return {
    opponentKeepId: record & 0x7ff,
    myPegging: (record >>> 11) & 0x1f,
    opponentPegging: (record >>> 16) & 0x1f,
    weight: ((record >>> 21) & 0xff) + 1,
  };
}

function frontierStateKey(state) {
  return [
    state.hands.human.join(""),
    state.hands.ai.join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer ?? "-",
    state.lastPlayer ?? "-",
  ].join("|");
}

function scoreCountRanks(plays) {
  let points = 0;
  const total = plays.reduce((sum, rank) => sum + VALUES[rank], 0);
  if (total === 15 || total === 31) points += 2;
  const last = plays[plays.length - 1];
  let same = 0;
  for (let index = plays.length - 1; index >= 0 && plays[index] === last; index -= 1) same += 1;
  if (same === 2) points += 2;
  else if (same === 3) points += 6;
  else if (same === 4) points += 12;
  for (let length = Math.min(plays.length, 7); length >= 3; length -= 1) {
    const slice = plays.slice(-length);
    const sorted = [...slice].sort((a, b) => a - b);
    let run = true;
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== sorted[index - 1] + 1) {
        run = false;
        break;
      }
    }
    if (run) {
      points += length;
      break;
    }
  }
  return points;
}

function legalRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function isValidPair(a, b) {
  for (let rank = 0; rank < 13; rank += 1) {
    if (a[rank] + b[rank] > 4) return false;
  }
  return true;
}

function opponentWeight(own, opponent) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    const available = 4 - own[rank];
    if (opponent[rank] > available) return 0;
    weight *= choose(available, opponent[rank]);
  }
  return weight;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function enumerateKeeps() {
  const keeps = [];
  function visit(rank, remaining, counts) {
    if (rank === 13) {
      if (remaining === 0) keeps.push({ key: counts.join(""), ranks: counts.slice() });
      return;
    }
    for (let count = 0; count <= Math.min(4, remaining); count += 1) {
      counts[rank] = count;
      visit(rank + 1, remaining - count, counts);
    }
    counts[rank] = 0;
  }
  visit(0, 4, Array(13).fill(0));
  return keeps;
}

function totalRanks(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
}

function otherPlayer(player) {
  return player === HUMAN ? AI : HUMAN;
}

function packPair(my, opponent) {
  if (my < 0 || my > 63 || opponent < 0 || opponent > 63) throw new Error(`Point pair out of range: ${my}/${opponent}`);
  return my | (opponent << 6);
}

function unpackPair(pair) {
  return [pair & 0x3f, (pair >>> 6) & 0x3f];
}

function checkpointPath(checkpointDir, id) {
  return path.join(checkpointDir, `${String(id).padStart(4, "0")}.json`);
}

function countCompleted(activeKeeps, checkpointDir) {
  let count = 0;
  for (const keep of activeKeeps) {
    if (fs.existsSync(checkpointPath(checkpointDir, keep.id))) count += 1;
  }
  return count;
}

function makeBalancedChunks(items, workers) {
  return Array.from({ length: workers }, (_, worker) =>
    items.filter((_, index) => index % workers === worker));
}

function fillOffsets(offsets) {
  let last = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] === 0) offsets[index] = last;
    else last = offsets[index];
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function dateSlug() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

class LimitedMemo {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
    this.highWater = 0;
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.limit > 0 && this.map.size >= this.limit && !this.map.has(key)) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, value);
    if (this.map.size > this.highWater) this.highWater = this.map.size;
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => {
    parentPort.postMessage({ type: "error", message: error.stack || error.message });
  });
}
