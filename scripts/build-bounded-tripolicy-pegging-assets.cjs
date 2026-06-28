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
const POLICIES = ["on", "off"];
const MAGIC = Buffer.from("P14S");
const MISSING_PAIR = 0xffff;
const DEFAULT_EV_PATH = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const outDir = path.resolve(root, args.outDir || path.join("benchmarks", "pegging-table", `bounded-tripolicy-pegging-assets-${dateSlug()}`));
  const outputPath = path.resolve(root, args.output || path.join(outDir, "pegging-outcome-bounded-overrides.bin"));
  const manifestPath = outputPath.replace(/\.bin$/i, ".manifest.json");
  const evPath = path.resolve(root, args.evPath || DEFAULT_EV_PATH);
  const checkpointDir = path.join(outDir, "checkpoints");
  const statusPath = path.join(outDir, "status.json");
  const workerCount = positiveInt(args.workers, Math.max(1, Math.min(os.cpus().length - 2, 6)));
  const oldMb = positiveInt(args.oldMb, 1024);
  const memoLimit = positiveInt(args.memoLimit, 50000);
  const tradeoffRatio = positiveInt(args.tradeoffRatio, 2);
  const keepLimit = positiveInt(args.limit, 0);
  const startKeep = positiveInt(args.startKeep, 0);
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keeps.slice(startKeep, keepLimit > 0 ? Math.min(keeps.length, startKeep + keepLimit) : keeps.length);
  fs.mkdirSync(checkpointDir, { recursive: true });

  const evTable = readEvPairwiseTable(evPath);
  if (evTable.keepCount !== keeps.length) throw new Error(`EV table keep count mismatch: ${evTable.keepCount} vs ${keeps.length}`);
  const sparseStatsCache = new Map();

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
    const sparseStats = collectSparseStats(activeKeeps, checkpointDir, evTable, sparseStatsCache);
    writeJsonAtomic(statusPath, {
      status,
      runId: path.basename(outDir),
      policy: "bounded-tripolicy-sparse-overrides",
      outDir: path.relative(root, outDir),
      checkpointDir: path.relative(root, checkpointDir),
      outputPath: path.relative(root, outputPath),
      evPath: path.relative(root, evPath),
      workers: Math.min(workerCount, Math.max(1, activeKeeps.length)),
      oldMb,
      memoLimit,
      tradeoffRatio,
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
      sparseStats,
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
    await Promise.all(chunks.map((chunk, workerIndex) => runChunk({ chunk, keeps, checkpointDir, memoLimit, oldMb, workerIndex, tradeoffRatio })));
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
  const summary = assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, evPath, evTable, startedAt, workerCount, oldMb, memoLimit, tradeoffRatio, sparseStatsCache });
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
    else if (arg === "--tradeoff-ratio") args.tradeoffRatio = next();
    else if (arg === "--old-mb") args.oldMb = next();
    else if (arg === "--limit") args.limit = next();
    else if (arg === "--start-keep") args.startKeep = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-tripolicy-pegging-assets.cjs [options]

Builds a restartable bounded sparse pairwise pegging table by reusing 12.0 EV
rows and generating only on/off overrides that pass the 2:1 tradeoff test.

Options:
  --out-dir <path>
  --output <path>
  --ev-path <path>       Defaults to 12.0 pegging-outcome-pairwise.bin
  --workers <n>
  --memo-limit <n>
  --old-mb <n>
  --tradeoff-ratio <n> Defaults to 2
  --limit <n>
  --start-keep <n>
`);
}

function runChunk({ chunk, keeps, checkpointDir, memoLimit, oldMb, workerIndex, tradeoffRatio }) {
  return new Promise((resolve, reject) => {
    if (!chunk.length) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, checkpointDir, memoLimit, workerIndex, tradeoffRatio },
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

async function runWorker({ chunk, keeps, checkpointDir, memoLimit, workerIndex, tradeoffRatio }) {
  for (const ownKeep of chunk) {
    const outPath = checkpointPath(checkpointDir, ownKeep.id);
    if (fs.existsSync(outPath)) continue;
    const startedAt = Date.now();
    const checkpoint = buildKeepCheckpoint({ ownKeep, keeps, memoLimit, tradeoffRatio });
    checkpoint.workerIndex = workerIndex;
    checkpoint.elapsedMs = Date.now() - startedAt;
    writeJsonAtomic(outPath, checkpoint);
  }
  parentPort.postMessage({ type: "complete" });
}

function buildKeepCheckpoint({ ownKeep, keeps, memoLimit, tradeoffRatio }) {
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

    const policyOutcomes = {};
    const forcedLeadOutcomes = {};
    for (const policy of POLICIES) {
      const memo = new LimitedMemo(memoLimit);
      const dealer = solvePolicy({
        hands: { human: ownKeep.ranks.slice(), ai: opponentKeep.ranks.slice() },
        plays: [],
        count: 0,
        current: AI,
        goPlayer: null,
        lastPlayer: null,
        perspective: HUMAN,
        policy,
        tradeoffRatio,
      }, memo);
      memoHighWater = Math.max(memoHighWater, memo.highWater);
      policyOutcomes[policy] = { dealer };

      forcedLeadOutcomes[policy] = {};
      for (const lead of legalLeadRanks) {
        const afterLead = ownKeep.ranks.slice();
        afterLead[lead] -= 1;
        const leadOutcome = solvePolicy({
          hands: { human: afterLead, ai: opponentKeep.ranks.slice() },
          plays: [lead],
          count: VALUES[lead],
          current: AI,
          goPlayer: null,
          lastPlayer: HUMAN,
          perspective: HUMAN,
          policy,
          tradeoffRatio,
        }, memo);
        memoHighWater = Math.max(memoHighWater, memo.highWater);
        forcedLeadOutcomes[policy][lead] = leadOutcome;
      }
    }

    dealerRecords.push(packOnOffRecord(opponentKeep.id, pairWeight, policyOutcomes.on.dealer, policyOutcomes.off.dealer));
    for (let lead = 0; lead < 13; lead += 1) {
      if (!legalLeadSet.has(lead)) continue;
      leadRecords[lead].push(packOnOffRecord(opponentKeep.id, pairWeight, forcedLeadOutcomes.on[lead], forcedLeadOutcomes.off[lead]));
    }
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

function solvePolicy(state, memo) {
  const key = policyStateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = totalRanks(state.hands.human) + totalRanks(state.hands.ai);
  if (remaining === 0) {
    const result = { my: 0, opponent: 0 };
    if (state.lastPlayer && state.count !== 0) {
      if (state.lastPlayer === state.perspective) result.my += 1;
      else result.opponent += 1;
    }
    memo.set(key, result);
    return result;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  let result;
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
      result = { ...solvePolicy(next, memo) };
      if (state.lastPlayer && state.count !== 31) {
        if (state.lastPlayer === state.perspective) result.my += 1;
        else result.opponent += 1;
      }
    } else {
      result = solvePolicy({
        ...state,
        current: otherPlayer(state.current),
        goPlayer: state.current,
      }, memo);
    }
    memo.set(key, result);
    return result;
  }

  const candidates = legal.map((rank) => ({
    rank,
    outcome: playBranch(state, rank, memo),
  }));
  const best = chooseBoundedCandidate(candidates, state.current, state.policy, state.tradeoffRatio).outcome;
  memo.set(key, best);
  return best;
}

function playBranch(state, rank, memo) {
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
  const future = { ...solvePolicy(nextState, memo) };
  if (state.current === state.perspective) future.my += points;
  else future.opponent += points;
  return future;
}

function chooseBoundedCandidate(candidates, actor, policy, tradeoffRatio) {
  const evBest = chooseByUtility(candidates, (candidate) => evUtilityTuple(candidate, actor));
  const actorMode = policy === "on"
    ? (actor === HUMAN ? "on" : "off")
    : (actor === HUMAN ? "off" : "on");
  const acceptable = candidates.filter((candidate) => candidate !== evBest && boundedAccepts(candidate, evBest, actor, actorMode, tradeoffRatio));
  if (!acceptable.length) return evBest;
  return chooseByUtility(acceptable, (candidate) => boundedUtilityTuple(candidate, actor, actorMode));
}

function chooseByUtility(candidates, utility) {
  let best = null;
  let bestTuple = null;
  for (const candidate of candidates) {
    const current = utility(candidate);
    if (!best || compareTuple(current, bestTuple) > 0) {
      best = candidate;
      bestTuple = current;
    }
  }
  return best;
}

function boundedAccepts(candidate, evBest, actor, actorMode, tradeoffRatio) {
  const current = scoresForActor(candidate.outcome, actor);
  const ev = scoresForActor(evBest.outcome, actor);
  if (actorMode === "on") {
    const ownGain = current.own - ev.own;
    const opponentCost = current.opponent - ev.opponent;
    return ownGain > 0 && opponentCost <= tradeoffRatio * ownGain;
  }
  const opponentSuppressed = ev.opponent - current.opponent;
  const ownCost = ev.own - current.own;
  return opponentSuppressed > 0 && ownCost <= tradeoffRatio * opponentSuppressed;
}

function evUtilityTuple(candidate, actor) {
  const scores = scoresForActor(candidate.outcome, actor);
  return [scores.own - scores.opponent, scores.own, -scores.opponent, -VALUES[candidate.rank]];
}

function boundedUtilityTuple(candidate, actor, actorMode) {
  const scores = scoresForActor(candidate.outcome, actor);
  if (actorMode === "on") return [scores.own, scores.own - scores.opponent, -scores.opponent, -VALUES[candidate.rank]];
  return [-scores.opponent, scores.own - scores.opponent, scores.own, -VALUES[candidate.rank]];
}

function scoresForActor(outcome, actor) {
  return actor === HUMAN
    ? { own: outcome.my, opponent: outcome.opponent }
    : { own: outcome.opponent, opponent: outcome.my };
}

function compareTuple(a, b) {
  if (!b) return 1;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, evPath, evTable, startedAt, workerCount, oldMb, memoLimit, tradeoffRatio, sparseStatsCache }) {
  const dealerOffsets = new Uint32Array(keeps.length + 1);
  const poneOffsets = new Uint32Array((keeps.length * 13) + 1);
  const dealerRecords = [];
  const poneRecords = [];
  let validPairCount = 0;
  let memoHighWater = 0;
  const sparseStats = emptySparseStats();

  for (const keep of activeKeeps) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(checkpointDir, keep.id), "utf8"));
    validPairCount += checkpoint.validPairCount;
    memoHighWater = Math.max(memoHighWater, checkpoint.memoHighWater || 0);

    dealerOffsets[keep.id] = dealerRecords.length;
    const evDealer = evTable.dealerRecords.slice(evTable.dealerOffsets[keep.id], evTable.dealerOffsets[keep.id + 1]);
    addSparseRecords(dealerRecords, evDealer, checkpoint.dealerRecords, `dealer keep ${keep.id}`, sparseStats);
    dealerOffsets[keep.id + 1] = dealerRecords.length;

    for (let lead = 0; lead < 13; lead += 1) {
      const offsetIndex = (keep.id * 13) + lead;
      poneOffsets[offsetIndex] = poneRecords.length;
      const evPone = evTable.poneRecords.slice(evTable.poneOffsets[offsetIndex], evTable.poneOffsets[offsetIndex + 1]);
      addSparseRecords(poneRecords, evPone, checkpoint.leadRecords[lead] || [], `pone keep ${keep.id} lead ${lead}`, sparseStats);
      poneOffsets[offsetIndex + 1] = poneRecords.length;
    }
  }
  fillOffsets(dealerOffsets);
  fillOffsets(poneOffsets);
  writeSparseTripolicyBinary(outputPath, {
    keepCount: keeps.length,
    dealerOffsets,
    poneOffsets,
    dealerRecords,
    poneRecords,
  });
  addSparseRates(sparseStats);
  const liveSparseStats = collectSparseStats(activeKeeps, checkpointDir, evTable, sparseStatsCache);
  const manifest = {
    version: 1,
    model: "bounded-tripolicy-pegging",
    generatedAt: new Date().toISOString(),
    policy: "sparse bounded pairwise pegging supplement: EV rows are reused from 12.0; only on/off deviations are stored",
    policyModes: ["ev", "on", "off"],
    policySemantics: {
      ev: "existing 12.0 policy: both players maximize own net pegging points",
      on: `perspective player deviates from EV only to gain own points at no more than ${tradeoffRatio}:1 opponent-point cost; opponent uses the reciprocal off rule`,
      off: `perspective player deviates from EV only to suppress opponent points at no more than ${tradeoffRatio}:1 own-point cost; opponent uses the reciprocal on rule`,
    },
    evSource: path.relative(root, evPath),
    ranks: RANKS,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      magic: "P14S",
      endian: "little",
      header: "magic P14S, version u16, keepCount u16, dealerOverrideCount u32, poneOverrideCount u32, recordBytes u16, reserved u16",
      sections: [
        "dealerOffsets uint32[keepCount + 1]",
        "poneOffsets uint32[keepCount * 13 + 1]",
        "dealer override records",
        "pone override records",
      ],
      recordBytes: 6,
      record: "opponentKeepId u16, onPair u16 or 0xffff, offPair u16 or 0xffff; pair packs my points in bits 0-4 and opponent points in bits 5-9",
    },
    workerCount,
    oldMb,
    memoLimit,
    tradeoffRatio,
    memoHighWater,
    dealerOverrideCount: dealerRecords.length,
    poneOverrideCount: poneRecords.length,
    sparseStats,
    liveSparseStats,
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
    dealerOverrideCount: dealerRecords.length,
    poneOverrideCount: poneRecords.length,
    sparseStats,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
}

function addSparseRecords(records, evRecords, onOffRecords, label, stats) {
  if (evRecords.length !== onOffRecords.length) {
    throw new Error(`${label} record count mismatch: EV ${evRecords.length} vs on/off ${onOffRecords.length}`);
  }
  for (let index = 0; index < evRecords.length; index += 1) {
    const ev = unpackEvRecord(evRecords[index]);
    const onOff = unpackOnOffRecord(onOffRecords[index]);
    if (ev.opponentKeepId !== onOff.opponentKeepId || ev.weight !== onOff.weight) {
      throw new Error(`${label} record ${index} mismatch: EV ${JSON.stringify(ev)} vs on/off ${JSON.stringify(onOff)}`);
    }
    addSparseRecord(records, ev, onOff, stats);
  }
}

function addSparseRecord(records, ev, onOff, stats) {
  stats.sourceRecords += 1;
  if (onOff.on.my === ev.myPegging && onOff.on.opponent === ev.opponentPegging) stats.onOmitted += 1;
  else stats.onStored += 1;
  if (onOff.off.my === ev.myPegging && onOff.off.opponent === ev.opponentPegging) stats.offOmitted += 1;
  else stats.offStored += 1;
  const onPair = onOff.on.my === ev.myPegging && onOff.on.opponent === ev.opponentPegging
    ? MISSING_PAIR
    : packPointPair(onOff.on.my, onOff.on.opponent);
  const offPair = onOff.off.my === ev.myPegging && onOff.off.opponent === ev.opponentPegging
    ? MISSING_PAIR
    : packPointPair(onOff.off.my, onOff.off.opponent);
  if (onPair === MISSING_PAIR && offPair === MISSING_PAIR) {
    stats.recordsFullyOmitted += 1;
    return;
  }
  stats.overrideRecords += 1;
  records.push({
    opponentKeepId: ev.opponentKeepId,
    onPair,
    offPair,
  });
}

function packOnOffRecord(opponentKeepId, weight, on, off) {
  if (weight < 1 || weight > 256) throw new Error(`Weight out of range: ${weight}`);
  return [opponentKeepId, weight, on.my, on.opponent, off.my, off.opponent];
}

function unpackOnOffRecord(record) {
  const [opponentKeepId, weight, onMy, onOpponent, offMy, offOpponent] = record;
  return {
    opponentKeepId,
    weight,
    on: { my: onMy, opponent: onOpponent },
    off: { my: offMy, opponent: offOpponent },
  };
}

function unpackEvRecord(record) {
  return {
    opponentKeepId: record & 0x7ff,
    myPegging: (record >>> 11) & 0x1f,
    opponentPegging: (record >>> 16) & 0x1f,
    weight: ((record >>> 21) & 0xff) + 1,
  };
}

function emptySparseStats() {
  return {
    sourceRecords: 0,
    overrideRecords: 0,
    recordsFullyOmitted: 0,
    onStored: 0,
    onOmitted: 0,
    offStored: 0,
    offOmitted: 0,
    onOmittedRate: 0,
    offOmittedRate: 0,
    fullyOmittedRate: 0,
  };
}

function addSparseRates(stats) {
  stats.onOmittedRate = stats.sourceRecords ? round(stats.onOmitted / stats.sourceRecords, 6) : 0;
  stats.offOmittedRate = stats.sourceRecords ? round(stats.offOmitted / stats.sourceRecords, 6) : 0;
  stats.fullyOmittedRate = stats.sourceRecords ? round(stats.recordsFullyOmitted / stats.sourceRecords, 6) : 0;
  return stats;
}

function mergeSparseStats(target, source) {
  for (const key of ["sourceRecords", "overrideRecords", "recordsFullyOmitted", "onStored", "onOmitted", "offStored", "offOmitted"]) {
    target[key] += source[key] || 0;
  }
  return target;
}

function collectSparseStats(activeKeeps, checkpointDir, evTable, cache) {
  const total = emptySparseStats();
  let completedRoots = 0;
  for (const keep of activeKeeps) {
    const outPath = checkpointPath(checkpointDir, keep.id);
    if (!fs.existsSync(outPath)) continue;
    completedRoots += 1;
    let stats = cache.get(keep.id);
    if (!stats) {
      const checkpoint = JSON.parse(fs.readFileSync(outPath, "utf8"));
      stats = sparseStatsForCheckpoint(keep.id, checkpoint, evTable);
      cache.set(keep.id, stats);
    }
    mergeSparseStats(total, stats);
  }
  addSparseRates(total);
  total.completedRootsWithStats = completedRoots;
  return total;
}

function sparseStatsForCheckpoint(keepId, checkpoint, evTable) {
  const stats = emptySparseStats();
  const evDealer = evTable.dealerRecords.slice(evTable.dealerOffsets[keepId], evTable.dealerOffsets[keepId + 1]);
  addSparseRecords([], evDealer, checkpoint.dealerRecords, `dealer keep ${keepId}`, stats);
  for (let lead = 0; lead < 13; lead += 1) {
    const offsetIndex = (keepId * 13) + lead;
    const evPone = evTable.poneRecords.slice(evTable.poneOffsets[offsetIndex], evTable.poneOffsets[offsetIndex + 1]);
    addSparseRecords([], evPone, checkpoint.leadRecords[lead] || [], `pone keep ${keepId} lead ${lead}`, stats);
  }
  return addSparseRates(stats);
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

function packPointPair(my, opponent) {
  return my | (opponent << 5);
}

function writeSparseTripolicyBinary(outputPath, table) {
  const headerBytes = 20;
  const dealerOffsetBytes = table.dealerOffsets.length * 4;
  const poneOffsetBytes = table.poneOffsets.length * 4;
  const recordBytes = 6;
  const dealerBytes = table.dealerRecords.length * recordBytes;
  const poneBytes = table.poneRecords.length * recordBytes;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + dealerBytes + poneBytes);
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
  buffer.writeUInt16LE(recordBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  for (const value of table.dealerOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of table.poneOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  offset = writeSparseRecords(buffer, offset, table.dealerRecords);
  offset = writeSparseRecords(buffer, offset, table.poneRecords);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function writeSparseRecords(buffer, offset, records) {
  for (const record of records) {
    buffer.writeUInt16LE(record.opponentKeepId, offset);
    offset += 2;
    buffer.writeUInt16LE(record.onPair, offset);
    offset += 2;
    buffer.writeUInt16LE(record.offPair, offset);
    offset += 2;
  }
  return offset;
}

function policyStateKey(state) {
  return [
    state.policy,
    state.hands.human.join(""),
    state.hands.ai.join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer ?? "-",
    state.lastPlayer ?? "-",
    state.tradeoffRatio,
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

function packCheckpointPath(id) {
  return `${String(id).padStart(4, "0")}.json`;
}

function checkpointPath(checkpointDir, id) {
  return path.join(checkpointDir, packCheckpointPath(id));
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
