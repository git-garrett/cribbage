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
const MAGIC = Buffer.from("P13P");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const outDir = path.resolve(root, args.outDir || path.join("benchmarks", "pegging-table", `model13-policy-outcomes-${dateSlug()}`));
  const checkpointDir = path.join(outDir, "checkpoints");
  const statusPath = path.join(outDir, "status.json");
  const outputPath = path.join(outDir, "pegging-outcome-model13-policy.bin");
  const manifestPath = path.join(outDir, "pegging-outcome-model13-policy.manifest.json");
  const workerCount = positiveInt(args.workers, Math.max(1, Math.min(os.cpus().length - 2, 6)));
  const oldMb = positiveInt(args.oldMb, 1024);
  const memoLimit = positiveInt(args.memoLimit, 250000);
  const keepLimit = positiveInt(args.limit, 0);
  const startKeep = positiveInt(args.startKeep, 0);
  const rootScore = positiveInt(args.rootScore, 60);
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keeps
    .slice(startKeep, keepLimit > 0 ? Math.min(keeps.length, startKeep + keepLimit) : keeps.length);

  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let stopping = false;
  const stop = () => {
    stopping = true;
    writeStatus("stopping");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const startedAt = Date.now();
  let completedRoots = countCompleted(activeKeeps, checkpointDir);
  let lastCompletedRoots = completedRoots;
  let lastCompletedAt = Date.now();

  const writeStatus = (status = "running") => {
    completedRoots = countCompleted(activeKeeps, checkpointDir);
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
      policy: "model13-rank-only-exact-hand-minimax-wp",
      outDir: path.relative(root, outDir),
      checkpointDir: path.relative(root, checkpointDir),
      outputPath: path.relative(root, outputPath),
      manifestPath: path.relative(root, manifestPath),
      workers: Math.min(workerCount, Math.max(1, activeKeeps.length)),
      oldMb,
      memoLimit,
      rootScore,
      startKeep,
      totalRoots: activeKeeps.length,
      completedRoots,
      pendingRoots,
      progressPercent: activeKeeps.length ? round((completedRoots / activeKeeps.length) * 100, 3) : 100,
      rootsPerSecond: round(rootsPerSecond, 4),
      recentRootsPerSecond: round(recentRootsPerSecond, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  writeStatus("running");
  const interval = setInterval(() => writeStatus(stopping ? "stopping" : "running"), 10000);
  const pending = activeKeeps.filter((keep) => !fs.existsSync(checkpointPath(checkpointDir, keep.id)));
  const workers = Math.max(1, Math.min(workerCount, pending.length || 1));
  const chunks = makeBalancedChunks(pending, workers);

  try {
    await Promise.all(chunks.map((chunk, workerIndex) => runChunk({
      chunk,
      keeps,
      checkpointDir,
      memoLimit,
      rootScore,
      oldMb,
      workerIndex,
      shouldStop: () => stopping,
    })));
  } finally {
    clearInterval(interval);
  }

  completedRoots = countCompleted(activeKeeps, checkpointDir);
  if (completedRoots < activeKeeps.length || stopping) {
    writeStatus("stopped");
    console.log(JSON.stringify({
      status: "stopped",
      statusPath: path.relative(root, statusPath),
      completedRoots,
      totalRoots: activeKeeps.length,
      resumeCommand: `node scripts/build-model13-pegging-outcome-asset.cjs --out-dir ${path.relative(root, outDir)} --workers ${workerCount} --memo-limit ${memoLimit} --old-mb ${oldMb} --root-score ${rootScore}`,
    }, null, 2));
    return;
  }

  writeStatus("assembling");
  const summary = assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, rootScore, workerCount, memoLimit, oldMb, startedAt });
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
    else if (arg === "--workers") args.workers = next();
    else if (arg === "--memo-limit") args.memoLimit = next();
    else if (arg === "--old-mb") args.oldMb = next();
    else if (arg === "--limit") args.limit = next();
    else if (arg === "--start-keep") args.startKeep = next();
    else if (arg === "--root-score") args.rootScore = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-model13-pegging-outcome-asset.cjs [options]

Builds a restartable rank-only pegging outcome asset using model-13-style
exact-hand minimax over approximate future win probability.

Options:
  --out-dir <path>       Output directory
  --workers <n>          Worker threads
  --memo-limit <n>       Per-worker LRU-ish memo entry limit
  --old-mb <n>           Worker old-generation MB limit
  --limit <n>            Number of own keeps to process, for benchmarking
  --start-keep <n>       First own keep id
  --root-score <n>       Symmetric board score used for WP objective; default 60
`);
}

function runChunk({ chunk, keeps, checkpointDir, memoLimit, rootScore, oldMb, workerIndex }) {
  return new Promise((resolve, reject) => {
    if (chunk.length === 0) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, checkpointDir, memoLimit, rootScore, workerIndex },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "progress") return;
      if (message?.type === "complete") resolve();
      else if (message?.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  });
}

async function runWorker({ chunk, keeps, checkpointDir, memoLimit, rootScore, workerIndex }) {
  for (const ownKeep of chunk) {
    const outPath = checkpointPath(checkpointDir, ownKeep.id);
    if (fs.existsSync(outPath)) {
      parentPort.postMessage({ type: "progress", workerIndex, keepId: ownKeep.id, skipped: true });
      continue;
    }
    const startedAt = Date.now();
    const checkpoint = buildKeepCheckpoint({ ownKeep, keeps, memoLimit, rootScore });
    checkpoint.workerIndex = workerIndex;
    checkpoint.elapsedMs = Date.now() - startedAt;
    writeJsonAtomic(outPath, checkpoint);
    parentPort.postMessage({ type: "progress", workerIndex, keepId: ownKeep.id });
  }
  parentPort.postMessage({ type: "complete" });
}

function buildKeepCheckpoint({ ownKeep, keeps, memoLimit, rootScore }) {
  const legalLeadRanks = legalRanks(ownKeep.ranks, 0);
  const legalLeadSet = new Set(legalLeadRanks);
  const dealerRecords = [];
  const poneLeadRecords = Array.from({ length: 13 }, () => []);
  let validPairCount = 0;
  let pairCount = 0;
  let memoHighWater = 0;

  for (const opponentKeep of keeps) {
    if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
    const weight = opponentWeight(ownKeep.ranks, opponentKeep.ranks);
    if (!weight) continue;
    validPairCount += 1;
    pairCount += 1;

    const memo = new LimitedMemo(memoLimit);
    const dealerOutcome = simulateOptimal({
      hands: { human: ownKeep.ranks.slice(), ai: opponentKeep.ranks.slice() },
      plays: [],
      count: 0,
      current: AI,
      goPlayer: null,
      lastPlayer: null,
      perspective: HUMAN,
      scores: { human: rootScore, ai: rootScore },
      rootScores: { human: rootScore, ai: rootScore },
      perspectiveRole: "dealer",
    }, memo);
    memoHighWater = Math.max(memoHighWater, memo.highWater);
    dealerRecords.push(packRecord(opponentKeep.id, dealerOutcome.my, dealerOutcome.opponent, weight));

    for (const lead of legalLeadSet) {
      const afterLead = ownKeep.ranks.slice();
      afterLead[lead] -= 1;
      const leadScore = scoreCountRanks([lead]);
      const scores = { human: rootScore + leadScore, ai: rootScore };
      const outcome = scores.human >= 121
        ? { my: leadScore, opponent: 0 }
        : simulateOptimal({
          hands: { human: afterLead, ai: opponentKeep.ranks.slice() },
          plays: VALUES[lead] === 31 ? [] : [lead],
          count: VALUES[lead] === 31 ? 0 : VALUES[lead],
          current: AI,
          goPlayer: null,
          lastPlayer: VALUES[lead] === 31 ? null : HUMAN,
          perspective: HUMAN,
          scores,
          rootScores: { human: rootScore, ai: rootScore },
          perspectiveRole: "pone",
        }, memo);
      memoHighWater = Math.max(memoHighWater, memo.highWater);
      poneLeadRecords[lead].push(packRecord(opponentKeep.id, outcome.my, outcome.opponent, weight));
    }
  }

  return {
    version: 1,
    keepId: ownKeep.id,
    keepKey: ownKeep.key,
    keepLabel: keepLabel(ownKeep.ranks),
    legalLeadRanks,
    validPairCount,
    pairCount,
    memoHighWater,
    dealerRecords,
    poneLeadRecords,
  };
}

function simulateOptimal(state, memo) {
  const key = optimalStateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = totalRanks(state.hands.human) + totalRanks(state.hands.ai);
  if (remaining === 0) {
    const scores = { ...state.scores };
    if (state.lastPlayer && state.count !== 0) scores[state.lastPlayer] += 1;
    const result = outcomeFromScores(state.rootScores, scores, state.perspective);
    memo.set(key, result);
    return result;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (legal.length === 0) {
    if (state.goPlayer) {
      const scores = { ...state.scores };
      if (state.lastPlayer && state.count !== 31) {
        scores[state.lastPlayer] += 1;
        if (scores[state.lastPlayer] >= 121) {
          const result = outcomeFromScores(state.rootScores, scores, state.perspective);
          memo.set(key, result);
          return result;
        }
      }
      const result = simulateOptimal({
        ...state,
        scores,
        plays: [],
        count: 0,
        current: otherPlayer(state.current),
        goPlayer: null,
        lastPlayer: null,
      }, memo);
      memo.set(key, result);
      return result;
    }
    const result = simulateOptimal({
      ...state,
      current: otherPlayer(state.current),
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  let best = null;
  let bestScore = state.current === state.perspective ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let bestPointEv = Number.NEGATIVE_INFINITY;
  for (const rank of legal) {
    const candidate = optimalBranch(state, rank, memo);
    const score = expectedWinProbability(state.rootScores[state.perspective] + candidate.my, state.rootScores[otherPlayer(state.perspective)] + candidate.opponent, state.perspectiveRole);
    const pointEv = candidate.my - candidate.opponent;
    const isBetter = state.current === state.perspective
      ? score > bestScore || (score === bestScore && pointEv > bestPointEv)
      : score < bestScore || (score === bestScore && pointEv < bestPointEv);
    if (!best || isBetter) {
      best = candidate;
      bestScore = score;
      bestPointEv = pointEv;
    }
  }
  memo.set(key, best);
  return best;
}

function optimalBranch(state, rank, memo) {
  const hands = {
    human: state.hands.human.slice(),
    ai: state.hands.ai.slice(),
  };
  hands[state.current][rank] -= 1;
  const plays = state.plays.concat(rank);
  const points = scoreCountRanks(plays);
  const scores = { ...state.scores };
  scores[state.current] += points;
  if (scores[state.current] >= 121) return outcomeFromScores(state.rootScores, scores, state.perspective);
  const nextCount = state.count + VALUES[rank];
  const nextState = nextCount === 31
    ? {
      ...state,
      hands,
      scores,
      plays: [],
      count: 0,
      current: otherPlayer(state.current),
      goPlayer: null,
      lastPlayer: null,
    }
    : {
      ...state,
      hands,
      scores,
      plays,
      count: nextCount,
      current: otherPlayer(state.current),
      goPlayer: null,
      lastPlayer: state.current,
    };
  return simulateOptimal(nextState, memo);
}

const WP_MEMO = new Map();
const SCORE_PHASES = {
  peggingPone: scoreDistribution(2.1933, 2.0902, 0, 21),
  peggingDealer: scoreDistribution(3.6912, 2.2810, 0, 24),
  handPone: scoreDistribution(7.8938, 3.9012, 0, 29),
  handDealer: scoreDistribution(7.4683, 4.2170, 0, 28),
  crib: scoreDistribution(4.3284, 3.3689, 0, 24),
};

function expectedWinProbability(myScore, opponentScore, perspectiveRole, phase = "handPone") {
  const my = Math.min(121, Math.max(0, Math.round(myScore)));
  const opponent = Math.min(121, Math.max(0, Math.round(opponentScore)));
  if (my >= 121) return 1;
  if (opponent >= 121) return 0;
  if (my < 90 && opponent < 90) return heuristicWinProbability(my, opponent, perspectiveRole);
  const key = `${my}:${opponent}:${perspectiveRole}:${phase}`;
  const cached = WP_MEMO.get(key);
  if (cached !== undefined) return cached;
  WP_MEMO.set(key, 0.5);
  const scorerRole = phase === "peggingPone" || phase === "handPone" ? "pone" : "dealer";
  const perspectiveScores = perspectiveRole === scorerRole;
  let probability = 0;
  for (const [points, weight] of SCORE_PHASES[phase]) {
    probability += weight * (perspectiveScores
      ? (my + points >= 121 ? 1 : expectedWinProbability(my + points, opponent, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase)))
      : (opponent + points >= 121 ? 0 : expectedWinProbability(my, opponent + points, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase))));
  }
  WP_MEMO.set(key, probability);
  return probability;
}

function heuristicWinProbability(myScore, opponentScore, perspectiveRole) {
  const roleBonus = perspectiveRole === "dealer" ? 2.4 : -1.2;
  return Math.max(0.02, Math.min(0.98, 0.5 + (myScore - opponentScore + roleBonus) / 80));
}

function nextScorePhase(phase) {
  if (phase === "peggingPone") return "peggingDealer";
  if (phase === "peggingDealer") return "handPone";
  if (phase === "handPone") return "handDealer";
  if (phase === "handDealer") return "crib";
  return "peggingPone";
}

function nextPerspectiveRole(role, phase) {
  if (phase !== "crib") return role;
  return role === "dealer" ? "pone" : "dealer";
}

function scoreDistribution(average, standardDeviation, min, max) {
  const values = [];
  let total = 0;
  for (let points = min; points <= max; points += 1) {
    const probability = normalCdf(points + 0.5, average, standardDeviation) -
      normalCdf(points - 0.5, average, standardDeviation);
    if (probability > 0) {
      values.push([points, probability]);
      total += probability;
    }
  }
  return values.map(([points, probability]) => [points, probability / total]);
}

function normalCdf(value, mean, sd) {
  return 0.5 * (1 + erf((value - mean) / (sd * Math.sqrt(2))));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function outcomeFromScores(rootScores, scores, perspective) {
  const opponent = otherPlayer(perspective);
  return {
    my: Math.max(0, scores[perspective] - rootScores[perspective]),
    opponent: Math.max(0, scores[opponent] - rootScores[opponent]),
  };
}

function assemble({ keeps, activeKeeps, checkpointDir, outputPath, manifestPath, rootScore, workerCount, memoLimit, oldMb, startedAt }) {
  const dealerOffsets = new Uint32Array(keeps.length + 1);
  const poneOffsets = new Uint32Array((keeps.length * 13) + 1);
  const dealerRecords = [];
  const poneRecords = [];
  let validPairCount = 0;
  let dealerRecordCount = 0;
  let poneRecordCount = 0;
  let memoHighWater = 0;

  for (const keep of activeKeeps) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(checkpointDir, keep.id), "utf8"));
    validPairCount += checkpoint.validPairCount;
    memoHighWater = Math.max(memoHighWater, checkpoint.memoHighWater || 0);
    dealerOffsets[keep.id] = dealerRecords.length;
    for (const record of checkpoint.dealerRecords) dealerRecords.push(record);
    dealerOffsets[keep.id + 1] = dealerRecords.length;
    for (let lead = 0; lead < 13; lead += 1) {
      poneOffsets[(keep.id * 13) + lead] = poneRecords.length;
      for (const record of checkpoint.poneLeadRecords[lead] || []) poneRecords.push(record);
      poneOffsets[(keep.id * 13) + lead + 1] = poneRecords.length;
    }
  }

  for (let index = 1; index < dealerOffsets.length; index += 1) {
    if (dealerOffsets[index] === 0 && dealerOffsets[index - 1] !== 0) dealerOffsets[index] = dealerOffsets[index - 1];
  }
  for (let index = 1; index < poneOffsets.length; index += 1) {
    if (poneOffsets[index] === 0 && poneOffsets[index - 1] !== 0) poneOffsets[index] = poneOffsets[index - 1];
  }

  const dealerRecordArray = Uint32Array.from(dealerRecords);
  const poneRecordArray = Uint32Array.from(poneRecords);
  writeBinaryTable(outputPath, {
    keepCount: keeps.length,
    dealerOffsets,
    poneOffsets,
    dealerRecords: dealerRecordArray,
    poneRecords: poneRecordArray,
  });
  dealerRecordCount = dealerRecordArray.length;
  poneRecordCount = poneRecordArray.length;

  const manifest = {
    version: 1,
    model: "schell_table-peg_table-13.0",
    generatedAt: new Date().toISOString(),
    policy: "rank-only exact-hand model-13-style minimax over approximate future win probability",
    rootScore,
    ranks: RANKS,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      endian: "little",
      header: "magic P13P, version u16, keepCount u16, dealerRecordCount u32, poneRecordCount u32",
      sections: [
        "dealerOffsets uint32[keepCount + 1]",
        "poneOffsets uint32[keepCount * 13 + 1]",
        "dealerRecords uint32[dealerRecordCount]",
        "poneRecords uint32[poneRecordCount]",
      ],
      record: "bits 0-10 opponentKeepId, 11-15 myPeggingPoints, 16-20 opponentPeggingPoints, 21-28 weightMinusOne",
    },
    workerCount,
    oldMb,
    memoLimit,
    memoHighWater,
    dealerRecordCount,
    poneRecordCount,
    keepKeys: keeps.map((keep) => keep.key),
  };
  writeJsonAtomic(manifestPath, manifest);
  return {
    status: "complete",
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    checkpointDir: path.relative(root, checkpointDir),
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    dealerRecordCount,
    poneRecordCount,
    binaryBytes: fs.statSync(outputPath).size,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
}

function writeBinaryTable(outputPath, table) {
  const headerBytes = 20;
  const dealerOffsetBytes = table.dealerOffsets.length * 4;
  const poneOffsetBytes = table.poneOffsets.length * 4;
  const dealerRecordBytes = table.dealerRecords.length * 4;
  const poneRecordBytes = table.poneRecords.length * 4;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + dealerRecordBytes + poneRecordBytes);
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
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  for (const value of table.dealerOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of table.poneOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of table.dealerRecords) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of table.poneRecords) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

class LimitedMemo {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
    this.order = [];
    this.highWater = 0;
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.limit <= 0) return;
    this.map.set(key, value);
    this.order.push(key);
    while (this.order.length > this.limit) this.map.delete(this.order.shift());
    this.highWater = Math.max(this.highWater, this.map.size);
  }
}

function optimalStateKey(state) {
  return [
    state.hands.human.join(""),
    state.hands.ai.join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer ?? "-",
    state.lastPlayer ?? "-",
    state.scores.human,
    state.scores.ai,
    state.rootScores.human,
    state.rootScores.ai,
    state.perspectiveRole,
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

function packRecord(opponentKeepId, myPoints, opponentPoints, weight) {
  if (opponentKeepId < 0 || opponentKeepId > 2047) throw new Error(`Opponent keep id out of range: ${opponentKeepId}`);
  if (myPoints < 0 || myPoints > 31) throw new Error(`My pegging points out of range: ${myPoints}`);
  if (opponentPoints < 0 || opponentPoints > 31) throw new Error(`Opponent pegging points out of range: ${opponentPoints}`);
  if (weight < 1 || weight > 256) throw new Error(`Weight out of range: ${weight}`);
  return opponentKeepId |
    (myPoints << 11) |
    (opponentPoints << 16) |
    ((weight - 1) << 21);
}

function checkpointPath(checkpointDir, keepId) {
  return path.join(checkpointDir, `${String(keepId).padStart(4, "0")}.json`);
}

function countCompleted(activeKeeps, checkpointDir) {
  let completed = 0;
  for (const keep of activeKeeps) {
    if (fs.existsSync(checkpointPath(checkpointDir, keep.id))) completed += 1;
  }
  return completed;
}

function makeBalancedChunks(items, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  items.forEach((item, index) => chunks[index % workers].push(item));
  return chunks.filter((chunk) => chunk.length > 0);
}

function keepLabel(ranks) {
  return ranks.flatMap((count, rank) => Array(count).fill(RANKS[rank])).join(" ");
}

function totalRanks(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
}

function otherPlayer(player) {
  return player === HUMAN ? AI : HUMAN;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function dateSlug() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => {
    parentPort.postMessage({ type: "error", message: error.stack || String(error) });
  });
}
