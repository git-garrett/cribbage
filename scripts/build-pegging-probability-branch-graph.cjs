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
const GO_SYMBOL = 26;
const RESET_SYMBOL = 27;

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => parentPort.postMessage({ type: "error", message: error.stack || String(error) }));
}

async function main() {
  const outputDir = path.resolve(root, process.argv[2] || path.join("benchmarks", "pegging-state-table", "probability-branch-graph"));
  const workerCount = Number.parseInt(process.argv[3] || "", 10) || Math.max(1, Math.min(os.cpus().length - 2, 8));
  const keepLimit = Number.parseInt(process.argv[4] || "", 10) || 1;
  const oldMb = Number.parseInt(process.argv[5] || "", 10) || 1024;
  const memoLimit = Number.parseInt(process.argv[6] || "", 10) || 250000;
  const sampleMode = process.env.PEGGING_PROB_SAMPLE_MODE || "first";
  const startRoot = Number.parseInt(process.env.PEGGING_PROB_START_ROOT || "0", 10) || 0;
  const sampleLabel = process.env.PEGGING_PROB_SAMPLE_LABEL || `${sampleMode}-roots-${keepLimit}`;
  const statusPath = process.env.PEGGING_PROB_STATUS_PATH
    ? path.resolve(root, process.env.PEGGING_PROB_STATUS_PATH)
    : path.join(outputDir, "status.json");
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = selectKeeps(keeps, keepLimit, sampleMode, startRoot);
  const workers = Math.max(1, Math.min(workerCount, activeKeeps.length));
  const chunks = makeBalancedChunks(activeKeeps, workers);
  const startedAt = Date.now();
  let completedRoots = 0;
  const partials = [];

  fs.mkdirSync(outputDir, { recursive: true });
  const writeStatus = (status = "running") => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rootsPerSecond = completedRoots / Math.max(elapsedSeconds, 0.001);
    const remaining = activeKeeps.length - completedRoots;
    const estimatedRemainingSeconds = rootsPerSecond ? Math.round(remaining / rootsPerSecond) : null;
    writeJson(statusPath, {
      status,
      sampleLabel,
      sampleMode,
      completedRoots,
      totalRoots: activeKeeps.length,
      pendingRoots: remaining,
      workers,
      oldMb,
      memoLimit,
      rootsPerSecond: round(rootsPerSecond, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };
  writeStatus();
  const interval = setInterval(() => writeStatus(), 10000);

  await Promise.all(chunks.map((chunk, index) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { chunk, memoLimit, workerIndex: index },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        completedRoots += 1;
        partials.push(message.metrics);
      } else if (message?.type === "complete") {
        resolve();
      } else if (message?.type === "error") {
        reject(new Error(message.message));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker exited with code ${code}`));
    });
  })));
  clearInterval(interval);

  const metrics = summarizePartials({ partials, sampleRoots: activeKeeps.length, totalRoots: keeps.length, workers, oldMb, memoLimit, elapsedSeconds: (Date.now() - startedAt) / 1000 });
  const manifestPath = path.join(outputDir, `${sampleLabel}.manifest.json`);
  writeJson(manifestPath, {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "rank-only pegging probability-branch graph calibration",
    ranks: RANKS,
    selectedRoots: activeKeeps.map((keep) => ({ id: keep.id, key: keep.key, label: keepLabel(keep.ranks) })),
    metrics,
  });
  writeStatus("complete");
  console.log(JSON.stringify({ manifestPath: path.relative(root, manifestPath), metrics }, null, 2));
}

async function runWorker({ chunk, memoLimit }) {
  for (const keep of chunk) {
    const metrics = buildKeepMetrics(keep, memoLimit);
    parentPort.postMessage({ type: "progress", metrics });
  }
  parentPort.postMessage({ type: "complete" });
}

function buildKeepMetrics(keep, memoLimit) {
  const metrics = emptyMetrics();
  for (const role of ["pone", "dealer"]) {
    const nodes = new Set();
    const edges = new Set();
    const sequenceRecords = new Set();
    const memo = new Map();
    const touchOrder = [];
    const rootKey = `${keep.id}:${role}:root`;
    nodes.add(rootKey);
    if (role === "pone") {
      for (const rank of legalOwnRanks(keep.ranks, 0)) {
        const state = initialState(keep, role, rootKey);
        applyPlay(state, OWN, rank);
        continueFromState(state, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics, "own-lead");
      }
    } else {
      for (let rank = 0; rank < 13; rank += 1) {
        const state = initialState(keep, role, rootKey);
        applyPlay(state, OPP, rank);
        continueFromState(state, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics, "opp-lead");
      }
    }
    metrics.nodes += nodes.size;
    metrics.edges += edges.size;
    metrics.sequenceRecords += sequenceRecords.size;
    for (const record of sequenceRecords) metrics.sequenceRecordSymbols += Number(record.split(":")[0]);
    metrics.rootCount += 1;
  }
  metrics.keepId = keep.id;
  metrics.keepLabel = keepLabel(keep.ranks);
  return metrics;
}

function initialState(keep, role, sourceNode) {
  return {
    keepId: keep.id,
    role,
    own: keep.ranks.slice(),
    oppPlayed: Array(13).fill(0),
    oppPlayedTotal: 0,
    stack: [],
    count: 0,
    current: role === "pone" ? OPP : OWN,
    goPlayer: -1,
    lastPlayer: -1,
    edgeSymbols: [],
    edgeScores: [],
    fullSymbols: [],
    sourceNode,
  };
}

function continueFromState(state, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics, scoreType) {
  const lastScore = state.lastScore;
  if (lastScore) {
    metrics.scoringCheckpoints += 1;
    metrics.scoreByType[lastScore.type || scoreType] = (metrics.scoreByType[lastScore.type || scoreType] || 0) + 1;
    state.edgeScores.push({ at: state.edgeSymbols.length, scorer: lastScore.scorer, points: lastScore.points, terminal: isTerminal(state) });
    state.lastScore = null;
    if (!isTerminal(state) && continuationCount(state) > 1) {
      const destination = `${state.keepId}:${state.role}:${stateKeyCore(state)}`;
      nodes.add(destination);
      sequenceRecords.add(sequenceRecordKey(state));
      emitEdge(state, destination, false, edges, metrics);
      state.sourceNode = destination;
      state.edgeSymbols = [];
      state.edgeScores = [];
    }
  }
  walk(state, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics);
}

function walk(state, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics) {
  metrics.visitedStates += 1;
  if (isTerminal(state)) {
    sequenceRecords.add(sequenceRecordKey(state));
    emitEdge(state, "terminal", true, edges, metrics);
    metrics.terminalEdges += 1;
    return;
  }
  const key = stateKey(state);
  if (memo.has(key)) {
    const cached = memo.get(key);
    for (const node of cached.nodes) nodes.add(node);
    for (const edge of cached.edges) edges.add(edge);
    for (const record of cached.sequenceRecords) sequenceRecords.add(record);
    mergeMetrics(metrics, cached.metrics);
    return;
  }
  const beforeNodes = nodes.size;
  const beforeEdges = edges.size;
  const beforeSequenceRecords = sequenceRecords.size;
  const beforeMetrics = cloneMetrics(metrics);

  const legal = state.current === OWN ? legalOwnRanks(state.own, state.count) : legalOpponentRanks(state);
  if (!legal.length) {
    if (state.goPlayer !== -1) {
      const next = cloneState(state);
      next.edgeSymbols.push(RESET_SYMBOL);
      next.fullSymbols.push(RESET_SYMBOL);
      if (next.lastPlayer !== -1 && next.count !== 31) {
        next.lastScore = { scorer: next.lastPlayer, points: 1, type: "go" };
      }
      next.stack = [];
      next.count = 0;
      next.current = 1 - next.current;
      next.goPlayer = -1;
      next.lastPlayer = -1;
      continueFromState(next, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics, "go");
    } else {
      const next = cloneState(state);
      next.edgeSymbols.push(GO_SYMBOL);
      next.fullSymbols.push(GO_SYMBOL);
      next.current = 1 - next.current;
      next.goPlayer = state.current;
      walk(next, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics);
    }
    remember();
    return;
  }

  for (const rank of legal) {
    const next = cloneState(state);
    applyPlay(next, next.current, rank);
    continueFromState(next, nodes, edges, sequenceRecords, memo, touchOrder, memoLimit, metrics, "play");
  }
  remember();

  function remember() {
    if (memoLimit <= 0) return;
    const newNodes = [...nodes].slice(beforeNodes);
    const newEdges = [...edges].slice(beforeEdges);
    const newSequenceRecords = [...sequenceRecords].slice(beforeSequenceRecords);
    const metricDelta = diffMetrics(beforeMetrics, metrics);
    memo.set(key, { nodes: newNodes, edges: newEdges, sequenceRecords: newSequenceRecords, metrics: metricDelta });
    touchOrder.push(key);
    while (touchOrder.length > memoLimit) memo.delete(touchOrder.shift());
  }
}

function applyPlay(state, actor, rank) {
  if (actor === OWN) state.own[rank] -= 1;
  else {
    state.oppPlayed[rank] += 1;
    state.oppPlayedTotal += 1;
  }
  state.edgeSymbols.push(actor * 13 + rank);
  state.fullSymbols.push(actor * 13 + rank);
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
  if (points > 0) state.lastScore = { scorer: actor, points, type: terminal ? "terminal" : "play" };
}

function emitEdge(state, destination, terminal, edges, metrics) {
  const path = state.edgeSymbols.join(".");
  const scores = state.edgeScores.map((score) => `${score.at}.${score.scorer}.${score.points}.${score.terminal ? 1 : 0}`).join(",");
  edges.add(`${state.sourceNode}>${path}>${destination}:${terminal ? 1 : 0}:${scores}`);
  metrics.edgesWithScores += 1;
  metrics.pathSymbols += state.edgeSymbols.length;
  metrics.maxPathSymbols = Math.max(metrics.maxPathSymbols, state.edgeSymbols.length);
  metrics.scoreCheckpointsOnEdges += state.edgeScores.length;
  metrics.maxScoresPerEdge = Math.max(metrics.maxScoresPerEdge, state.edgeScores.length);
}

function continuationCount(state) {
  if (isTerminal(state)) return 0;
  return state.current === OWN ? legalOwnRanks(state.own, state.count).length : legalOpponentRanks(state).length;
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
  for (let rank = 0; rank < 13; rank += 1) {
    if (state.oppPlayed[rank] < 4 && state.count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function stateKey(state) {
  return [
    state.keepId,
    state.role,
    state.own.join(""),
    state.oppPlayed.join(""),
    state.oppPlayedTotal,
    state.stack.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
    state.sourceNode,
    state.edgeSymbols.join(","),
    state.fullSymbols.join(","),
    state.edgeScores.map((score) => `${score.at}.${score.scorer}.${score.points}.${score.terminal ? 1 : 0}`).join(","),
  ].join("|");
}

function stateKeyCore(state) {
  return [
    state.own.join(""),
    state.oppPlayed.join(""),
    state.stack.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
  ].join("|");
}

function cloneState(state) {
  return {
    keepId: state.keepId,
    role: state.role,
    own: state.own.slice(),
    oppPlayed: state.oppPlayed.slice(),
    oppPlayedTotal: state.oppPlayedTotal,
    stack: state.stack.slice(),
    count: state.count,
    current: state.current,
    goPlayer: state.goPlayer,
    lastPlayer: state.lastPlayer,
    edgeSymbols: state.edgeSymbols.slice(),
    edgeScores: state.edgeScores.map((score) => ({ ...score })),
    fullSymbols: state.fullSymbols.slice(),
    sourceNode: state.sourceNode,
    lastScore: state.lastScore ? { ...state.lastScore } : null,
  };
}

function emptyMetrics() {
  return {
    keepId: null,
    keepLabel: "",
    rootCount: 0,
    nodes: 0,
    edges: 0,
    visitedStates: 0,
    scoringCheckpoints: 0,
    terminalEdges: 0,
    edgesWithScores: 0,
    scoreCheckpointsOnEdges: 0,
    sequenceRecords: 0,
    sequenceRecordSymbols: 0,
    maxScoresPerEdge: 0,
    pathSymbols: 0,
    maxPathSymbols: 0,
    scoreByType: {},
  };
}

function mergeMetrics(target, source) {
  target.nodes += source.nodes;
  target.edges += source.edges;
  target.rootCount += source.rootCount;
  target.visitedStates += source.visitedStates;
  target.scoringCheckpoints += source.scoringCheckpoints;
  target.terminalEdges += source.terminalEdges;
  target.edgesWithScores += source.edgesWithScores;
  target.scoreCheckpointsOnEdges += source.scoreCheckpointsOnEdges;
  target.sequenceRecords += source.sequenceRecords;
  target.sequenceRecordSymbols += source.sequenceRecordSymbols;
  target.maxScoresPerEdge = Math.max(target.maxScoresPerEdge, source.maxScoresPerEdge);
  target.pathSymbols += source.pathSymbols;
  target.maxPathSymbols = Math.max(target.maxPathSymbols, source.maxPathSymbols);
  for (const [key, value] of Object.entries(source.scoreByType || {})) {
    target.scoreByType[key] = (target.scoreByType[key] || 0) + value;
  }
}

function cloneMetrics(metrics) {
  return JSON.parse(JSON.stringify(metrics));
}

function diffMetrics(before, after) {
  const diff = emptyMetrics();
  for (const key of ["nodes", "edges", "rootCount", "visitedStates", "scoringCheckpoints", "terminalEdges", "edgesWithScores", "scoreCheckpointsOnEdges", "pathSymbols", "sequenceRecords", "sequenceRecordSymbols"]) {
    diff[key] = after[key] - before[key];
  }
  diff.maxScoresPerEdge = after.maxScoresPerEdge;
  diff.maxPathSymbols = after.maxPathSymbols;
  for (const [key, value] of Object.entries(after.scoreByType || {})) diff.scoreByType[key] = value - (before.scoreByType?.[key] || 0);
  return diff;
}

function summarizePartials({ partials, sampleRoots, totalRoots, workers, oldMb, memoLimit, elapsedSeconds }) {
  const totals = emptyMetrics();
  let maxKeepBytes = 0;
  let maxKeep = null;
  for (const partial of partials) {
    mergeMetrics(totals, partial);
    const bytes = estimateBytes(partial);
    if (bytes > maxKeepBytes) {
      maxKeepBytes = bytes;
      maxKeep = { id: partial.keepId, label: partial.keepLabel, estimatedBytes: bytes, nodes: partial.nodes, edges: partial.edges };
    }
  }
  const estimatedBytes = estimateBytes(totals);
  const sequenceOnlyEstimatedBytes = estimateSequenceOnlyBytes(totals);
  const scale = totalRoots / Math.max(1, sampleRoots);
  return {
    sampleRoots,
    totalRoots,
    workers,
    oldMb,
    memoLimit,
    elapsedSeconds: round(elapsedSeconds, 3),
    rootsPerSecond: round(sampleRoots / Math.max(elapsedSeconds, 0.001), 4),
    nodes: totals.nodes,
    edges: totals.edges,
    visitedStates: totals.visitedStates,
    scoringCheckpoints: totals.scoringCheckpoints,
    terminalEdges: totals.terminalEdges,
    scoreCheckpointsOnEdges: totals.scoreCheckpointsOnEdges,
    averageScoresPerEdge: round(totals.scoreCheckpointsOnEdges / Math.max(1, totals.edges), 3),
    maxScoresPerEdge: totals.maxScoresPerEdge,
    averagePathSymbols: round(totals.pathSymbols / Math.max(1, totals.edges), 3),
    maxPathSymbols: totals.maxPathSymbols,
    estimatedBytes,
    sequenceRecords: totals.sequenceRecords,
    sequenceRecordSymbols: totals.sequenceRecordSymbols,
    sequenceOnlyEstimatedBytes,
    maxKeep,
    scoreByType: totals.scoreByType,
    perRoot: partials.map((partial) => ({
      id: partial.keepId,
      label: partial.keepLabel,
      nodes: partial.nodes,
      edges: partial.edges,
      scoringCheckpoints: partial.scoringCheckpoints,
      estimatedBytes: estimateBytes(partial),
      sequenceOnlyEstimatedBytes: estimateSequenceOnlyBytes(partial),
    })),
    linearEstimate: {
      nodes: Math.round(totals.nodes * scale),
      edges: Math.round(totals.edges * scale),
      estimatedBytes: Math.round(estimatedBytes * scale),
      sequenceOnlyEstimatedBytes: Math.round(sequenceOnlyEstimatedBytes * scale),
      elapsedSeconds: Math.round(elapsedSeconds * scale),
      expectedCompletionAt: new Date(Date.now() + elapsedSeconds * scale * 1000).toISOString(),
    },
  };
}

function estimateBytes(metrics) {
  return metrics.nodes * 24 + metrics.edges * 28 + metrics.scoreCheckpointsOnEdges * 4 + metrics.pathSymbols;
}

function estimateSequenceOnlyBytes(metrics) {
  const packedSymbolBytes = Math.ceil((metrics.sequenceRecordSymbols * 5) / 8);
  const recordIndexBytes = metrics.sequenceRecords * 8;
  return packedSymbolBytes + recordIndexBytes;
}

function sequenceRecordKey(state) {
  return `${state.fullSymbols.length}:${state.role}:${state.fullSymbols.join(".")}`;
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

function selectKeeps(keeps, limit, mode, startRoot) {
  if (limit <= 0) return keeps.slice(startRoot);
  if (mode === "spread") {
    if (limit === 1) return [keeps[startRoot] || keeps[0]];
    const last = keeps.length - 1;
    return Array.from({ length: limit }, (_, index) => keeps[Math.round((index * last) / (limit - 1))]);
  }
  return keeps.slice(startRoot, startRoot + limit);
}

function keepLabel(ranks) {
  return ranks.flatMap((count, rank) => Array(count).fill(RANKS[rank])).join(" ");
}

function ownTotal(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
}

function makeBalancedChunks(activeKeeps, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  activeKeeps.forEach((keep, index) => chunks[index % workers].push(keep));
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
