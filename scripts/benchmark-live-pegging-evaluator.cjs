#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const OWN = 0;
const OPP = 1;

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => parentPort.postMessage({ type: "error", message: error.stack || String(error) }));
}

async function main() {
  const outDir = path.resolve(root, process.argv[2] || path.join("benchmarks", "pegging-table", "live-evaluator-benchmark"));
  const workerCount = Number.parseInt(process.argv[3] || "", 10) || Math.max(1, Math.min(os.cpus().length - 2, 8));
  const memoLimit = Number.parseInt(process.argv[4] || "", 10) || 250000;
  const oldMb = Number.parseInt(process.argv[5] || "", 10) || 1024;
  const limit = Number.parseInt(process.env.LIVE_PEG_BENCH_LIMIT || "0", 10) || 0;
  const mode = process.env.LIVE_PEG_BENCH_MODE || "all";
  const opponentModel = process.env.LIVE_PEG_BENCH_OPPONENT_MODEL || "rank-branch";
  const statusPath = path.join(outDir, "status.json");
  fs.mkdirSync(outDir, { recursive: true });

  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  let tasks = makeTasks(keeps);
  if (mode === "dealer") tasks = tasks.filter((task) => task.role === "dealer");
  else if (mode === "pone") tasks = tasks.filter((task) => task.role === "pone");
  if (limit > 0) tasks = tasks.slice(0, limit);

  const workers = Math.max(1, Math.min(workerCount, tasks.length));
  const chunks = makeBalancedChunks(tasks, workers);
  const startedAt = Date.now();
  let completedTasks = 0;
  const samples = [];
  const aggregate = newAggregate();

  const writeStatus = (status = "running") => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rate = completedTasks / Math.max(elapsedSeconds, 0.001);
    const pendingTasks = tasks.length - completedTasks;
    const estimatedRemainingSeconds = rate ? Math.round(pendingTasks / rate) : null;
    writeJson(statusPath, {
      status,
      mode,
      opponentModel,
      workers,
      oldMb,
      memoLimit,
      completedTasks,
      totalTasks: tasks.length,
      pendingTasks,
      tasksPerSecond: round(rate, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };
  writeStatus();
  const interval = setInterval(() => writeStatus(), 10000);

  await Promise.all(chunks.map((chunk, index) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, memoLimit, opponentModel, workerIndex: index },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "result") {
        completedTasks += 1;
        mergeAggregate(aggregate, message.result);
        if (samples.length < 200 || message.result.elapsedMs > (samples[0]?.elapsedMs ?? 0)) {
          samples.push(message.result);
          samples.sort((a, b) => b.elapsedMs - a.elapsedMs);
          samples.length = Math.min(samples.length, 200);
        }
      } else if (message?.type === "complete") resolve();
      else if (message?.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker exited with code ${code}`));
    });
  })));
  clearInterval(interval);

  const summary = finalizeSummary({ aggregate, samples, tasks, opponentModel, workers, oldMb, memoLimit, elapsedSeconds: (Date.now() - startedAt) / 1000 });
  const summaryPath = path.join(outDir, "summary.json");
  writeJson(summaryPath, summary);
  writeStatus("complete");
  console.log(JSON.stringify({ summaryPath: path.relative(root, summaryPath), summary }, null, 2));
}

async function runWorker({ chunk, keeps, memoLimit, opponentModel }) {
  for (const task of chunk) {
    const result = benchmarkTask(task, keeps, memoLimit, opponentModel);
    parentPort.postMessage({ type: "result", result });
  }
  parentPort.postMessage({ type: "complete" });
}

function benchmarkTask(task, keeps, memoLimit, opponentModel) {
  const started = process.hrtime.bigint();
  const memo = new Map();
  const touchOrder = [];
  const histogram = opponentModel === "exact-hand"
    ? solveExactTask(task, keeps, memo, touchOrder, memoLimit)
    : solveRankBranchTask(task, memo, touchOrder, memoLimit);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    opponentModel,
    role: task.role,
    keepId: task.keepId,
    keep: task.keepLabel,
    leadRank: RANKS[task.leadRank],
    elapsedMs,
    memoSize: memo.size,
    histogramBuckets: histogram.size,
    opponentHands: histogram._handCount ?? null,
    terminalWeight: [...histogram.values()].reduce((sum, value) => sum + value, 0),
  };
}

function solveRankBranchTask(task, memo, touchOrder, memoLimit) {
  const state = initialState(task);
  const initialActor = task.role === "pone" ? OWN : OPP;
  applyPlay(state, initialActor, task.leadRank);
  return solve(state, memo, touchOrder, memoLimit);
}

function solveExactTask(task, keeps, memo, touchOrder, memoLimit) {
  const histogram = new Map();
  let handCount = 0;
  for (const opponentKeep of compatibleOpponentKeeps(task, keeps)) {
    const state = initialState(task);
    state.opp = opponentKeep.ranks.slice();
    const initialActor = task.role === "pone" ? OWN : OPP;
    if (initialActor === OPP && state.opp[task.leadRank] <= 0) continue;
    applyPlay(state, initialActor, task.leadRank);
    addHistogram(histogram, solve(state, memo, touchOrder, memoLimit));
    handCount += 1;
  }
  histogram._handCount = handCount;
  return histogram;
}

function initialState(task) {
  return {
    own: task.keep.slice(),
    opp: null,
    oppPlayed: Array(13).fill(0),
    oppPlayedTotal: 0,
    stack: [],
    count: 0,
    current: task.role === "pone" ? OWN : OPP,
    goPlayer: -1,
    lastPlayer: -1,
  };
}

function solve(state, memo, touchOrder, memoLimit) {
  if (isTerminal(state)) return new Map([["0:0", 1]]);
  const key = stateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const legal = state.current === OWN ? legalOwnRanks(state.own, state.count) : legalOpponentRanks(state);
  let result = new Map();
  if (!legal.length) {
    if (state.goPlayer !== -1) {
      const next = cloneState(state);
      let ownScore = 0;
      let oppScore = 0;
      if (next.lastPlayer !== -1 && next.count !== 31) {
        if (next.lastPlayer === OWN) ownScore = 1;
        else oppScore = 1;
      }
      next.stack = [];
      next.count = 0;
      next.current = 1 - next.current;
      next.goPlayer = -1;
      next.lastPlayer = -1;
      result = shiftHistogram(solve(next, memo, touchOrder, memoLimit), ownScore, oppScore);
    } else {
      const next = cloneState(state);
      next.current = 1 - next.current;
      next.goPlayer = state.current;
      result = solve(next, memo, touchOrder, memoLimit);
    }
  } else {
    for (const rank of legal) {
      const next = cloneState(state);
      const { ownScore, oppScore } = applyPlay(next, next.current, rank);
      addHistogram(result, shiftHistogram(solve(next, memo, touchOrder, memoLimit), ownScore, oppScore));
    }
  }

  if (memoLimit > 0) {
    memo.set(key, result);
    touchOrder.push(key);
    while (touchOrder.length > memoLimit) memo.delete(touchOrder.shift());
  }
  return result;
}

function applyPlay(state, actor, rank) {
  if (actor === OWN) state.own[rank] -= 1;
  else {
    if (state.opp) state.opp[rank] -= 1;
    state.oppPlayed[rank] += 1;
    state.oppPlayedTotal += 1;
  }
  state.stack.push(rank);
  let points = scoreCountRanks(state.stack);
  state.count += VALUES[rank];
  state.lastPlayer = actor;
  state.goPlayer = -1;
  if (state.count === 31) {
    state.stack = [];
    state.count = 0;
    state.lastPlayer = -1;
  }
  const terminal = ownTotal(state.own) === 0 && state.oppPlayedTotal === 4;
  if (terminal && state.count !== 31) points += 1;
  state.current = 1 - actor;
  return actor === OWN ? { ownScore: points, oppScore: 0 } : { ownScore: 0, oppScore: points };
}

function shiftHistogram(histogram, ownDelta, oppDelta) {
  if (!ownDelta && !oppDelta) return histogram;
  const shifted = new Map();
  for (const [key, weight] of histogram) {
    const [own, opp] = key.split(":").map(Number);
    shifted.set(`${own + ownDelta}:${opp + oppDelta}`, (shifted.get(`${own + ownDelta}:${opp + oppDelta}`) || 0) + weight);
  }
  return shifted;
}

function addHistogram(target, source) {
  for (const [key, value] of source) target.set(key, (target.get(key) || 0) + value);
}

function compatibleOpponentKeeps(task, keeps) {
  return keeps.filter((candidate) => {
    for (let rank = 0; rank < 13; rank += 1) {
      if (candidate.ranks[rank] + task.keep[rank] > 4) return false;
    }
    if (task.role === "dealer" && candidate.ranks[task.leadRank] <= 0) return false;
    return true;
  });
}

function makeTasks(keeps) {
  const tasks = [];
  for (const keep of keeps) {
    for (const rank of legalOwnRanks(keep.ranks, 0)) {
      tasks.push({ role: "pone", keepId: keep.id, keep: keep.ranks, keepLabel: keepLabel(keep.ranks), leadRank: rank });
    }
    for (let rank = 0; rank < 13; rank += 1) {
      tasks.push({ role: "dealer", keepId: keep.id, keep: keep.ranks, keepLabel: keepLabel(keep.ranks), leadRank: rank });
    }
  }
  return tasks;
}

function newAggregate() {
  return {
    count: 0,
    elapsedMsTotal: 0,
    maxElapsedMs: 0,
    histogramBucketTotal: 0,
    memoSizeTotal: 0,
    byRole: {
      dealer: { count: 0, elapsedMsTotal: 0, maxElapsedMs: 0 },
      pone: { count: 0, elapsedMsTotal: 0, maxElapsedMs: 0 },
    },
  };
}

function mergeAggregate(aggregate, result) {
  aggregate.count += 1;
  aggregate.elapsedMsTotal += result.elapsedMs;
  aggregate.maxElapsedMs = Math.max(aggregate.maxElapsedMs, result.elapsedMs);
  aggregate.histogramBucketTotal += result.histogramBuckets;
  aggregate.memoSizeTotal += result.memoSize;
  const role = aggregate.byRole[result.role];
  role.count += 1;
  role.elapsedMsTotal += result.elapsedMs;
  role.maxElapsedMs = Math.max(role.maxElapsedMs, result.elapsedMs);
}

function finalizeSummary({ aggregate, samples, tasks, opponentModel, workers, oldMb, memoLimit, elapsedSeconds }) {
  return {
    generatedAt: new Date().toISOString(),
    opponentModel,
    taskCount: tasks.length,
    workers,
    oldMb,
    memoLimit,
    elapsedSeconds: round(elapsedSeconds, 3),
    tasksPerSecond: round(tasks.length / Math.max(elapsedSeconds, 0.001), 4),
    averageTaskMs: round(aggregate.elapsedMsTotal / Math.max(1, aggregate.count), 4),
    maxTaskMs: round(aggregate.maxElapsedMs, 4),
    averageHistogramBuckets: round(aggregate.histogramBucketTotal / Math.max(1, aggregate.count), 2),
    averageMemoSize: round(aggregate.memoSizeTotal / Math.max(1, aggregate.count), 2),
    byRole: Object.fromEntries(Object.entries(aggregate.byRole).map(([role, value]) => [role, {
      count: value.count,
      averageTaskMs: round(value.elapsedMsTotal / Math.max(1, value.count), 4),
      maxTaskMs: round(value.maxElapsedMs, 4),
    }])),
    slowestTasks: samples.slice(0, 25).map((sample) => ({
      role: sample.role,
      keepId: sample.keepId,
      keep: sample.keep,
      leadRank: sample.leadRank,
      elapsedMs: round(sample.elapsedMs, 4),
      memoSize: sample.memoSize,
      histogramBuckets: sample.histogramBuckets,
      opponentHands: sample.opponentHands,
      terminalWeight: sample.terminalWeight,
    })),
    phoneMultiplierEstimates: [3, 5, 8, 12].map((multiplier) => ({
      multiplier,
      averageTaskMs: round((aggregate.elapsedMsTotal / Math.max(1, aggregate.count)) * multiplier, 2),
      maxTaskMs: round(aggregate.maxElapsedMs * multiplier, 2),
    })),
  };
}

function stateKey(state) {
  return [
    state.own.join(""),
    state.opp ? state.opp.join("") : "",
    state.oppPlayed.join(""),
    state.oppPlayedTotal,
    state.stack.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
  ].join("|");
}

function cloneState(state) {
  return {
    own: state.own.slice(),
    opp: state.opp ? state.opp.slice() : null,
    oppPlayed: state.oppPlayed.slice(),
    oppPlayedTotal: state.oppPlayedTotal,
    stack: state.stack.slice(),
    count: state.count,
    current: state.current,
    goPlayer: state.goPlayer,
    lastPlayer: state.lastPlayer,
  };
}

function isTerminal(state) {
  return ownTotal(state.own) === 0 && state.oppPlayedTotal === 4;
}

function legalOwnRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function legalOpponentRanks(state) {
  if (state.oppPlayedTotal >= 4) return [];
  const legal = [];
  if (state.opp) {
    for (let rank = 0; rank < 13; rank += 1) {
      if (state.opp[rank] > 0 && state.count + VALUES[rank] <= 31) legal.push(rank);
    }
    return legal;
  }
  for (let rank = 0; rank < 13; rank += 1) {
    if (state.oppPlayed[rank] < 4 && state.count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
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

function keepLabel(ranks) {
  return ranks.flatMap((count, rank) => Array(count).fill(RANKS[rank])).join(" ");
}

function ownTotal(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
}

function makeBalancedChunks(items, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  items.forEach((item, index) => chunks[index % workers].push(item));
  return chunks.filter((chunk) => chunk.length > 0);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
