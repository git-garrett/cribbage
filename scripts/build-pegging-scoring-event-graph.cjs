#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const GO_SYMBOL = 13;
const RESET_SYMBOL = 14;
const root = path.resolve(__dirname, "..");

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

async function main() {
  const outputDir = path.resolve(root, process.argv[2] || path.join("benchmarks", "pegging-state-table", "scoring-event-graph"));
  const workerCount = Number.parseInt(process.argv[3] || "", 10) || Math.max(1, Math.min(os.cpus().length - 2, 8));
  const keepLimit = Number.parseInt(process.argv[4] || "", 10) || 20;
  const oldMb = Number.parseInt(process.argv[5] || "", 10) || 1024;
  const memoLimit = Number.parseInt(process.argv[6] || "", 10) || 250000;
  const startRoot = Number.parseInt(process.env.PEGGING_EVENT_START_ROOT || "0", 10) || 0;
  const statusPath = process.env.PEGGING_EVENT_STATUS_PATH
    ? path.resolve(root, process.env.PEGGING_EVENT_STATUS_PATH)
    : path.join(outputDir, "status.json");
  const sampleLabel = process.env.PEGGING_EVENT_SAMPLE_LABEL || `roots-${keepLimit}`;
  const startedAt = Date.now();
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keepLimit > 0 ? keeps.slice(startRoot, startRoot + keepLimit) : keeps.slice(startRoot);
  const workers = Math.max(1, Math.min(workerCount, activeKeeps.length));
  const chunks = makeBalancedChunks(activeKeeps, workers);
  let completedRoots = 0;
  const partials = [];

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const writeStatus = (status = "running") => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rootsPerSecond = completedRoots / Math.max(elapsedSeconds, 0.001);
    const pendingRoots = activeKeeps.length - completedRoots;
    const estimatedRemainingSeconds = rootsPerSecond ? Math.round(pendingRoots / rootsPerSecond) : null;
    writeJson(statusPath, {
      status,
      kind: "rank-only pegging scoring-event graph",
      sampleLabel,
      startRoot,
      completedRoots,
      totalRoots: activeKeeps.length,
      pendingRoots,
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
      workerData: { chunk, keeps, memoLimit, workerIndex: index },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        completedRoots += message.completedRoots;
        return;
      }
      if (message?.type === "complete") {
        partials.push(message.metrics);
        resolve();
        return;
      }
      if (message?.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker exited with code ${code}`));
    });
  })));
  clearInterval(interval);

  const metrics = summarizePartials({
    partials,
    sampleRoots: activeKeeps.length,
    totalRoots: keeps.length,
    startRoot,
    workers,
    oldMb,
    memoLimit,
    elapsedSeconds: (Date.now() - startedAt) / 1000,
  });
  const manifestPath = path.join(outputDir, `${sampleLabel}.manifest.json`);
  writeJson(manifestPath, {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "rank-only pegging scoring-event graph calibration",
    ranks: RANKS,
    symbolEncoding: {
      "0-12": "rank A-K",
      13: "go/pass",
      14: "reset after both players cannot play",
    },
    metrics,
  });
  writeJson(statusPath, {
    status: "complete",
    manifestPath: path.relative(root, manifestPath),
    ...metrics,
    updatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ manifestPath: path.relative(root, manifestPath), metrics }, null, 2));
}

async function runWorker({ chunk, keeps, memoLimit, workerIndex }) {
  const totals = emptyMetrics();
  for (const ownKeep of chunk) {
    const rootMetrics = buildRootMetrics(ownKeep, keeps, memoLimit);
    mergeMetrics(totals, rootMetrics);
    parentPort.postMessage({ type: "progress", completedRoots: 1, workerIndex });
  }
  parentPort.postMessage({ type: "complete", metrics: totals });
}

function buildRootMetrics(ownKeep, keeps, memoLimit) {
  const nodes = new Set();
  const edges = new Set();
  const memo = new Map();
  const metrics = emptyMetrics();
  const touchOrder = [];

  for (const opponentKeep of keeps) {
    if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
    const pairId = `${ownKeep.id}:${opponentKeep.id}`;
    for (const role of [0, 1]) {
      const current = role === 0 ? 0 : 1;
      const rootKey = `${pairId}:${role}:`;
      nodes.add(rootKey);
      metrics.roots += 1;
      walk({
        pairId,
        role,
        hands: [ownKeep.ranks.slice(), opponentKeep.ranks.slice()],
        plays: [],
        count: 0,
        current,
        goPlayer: -1,
        lastPlayer: -1,
        fullSymbols: [],
        edgeSymbols: [],
        edgeScores: [],
        sourceNode: rootKey,
      }, nodes, edges, memo, touchOrder, memoLimit, metrics);
    }
  }

  metrics.nodes = nodes.size;
  metrics.edges = edges.size;
  return metrics;
}

function walk(state, nodes, edges, memo, touchOrder, memoLimit, metrics) {
  metrics.visitedStates += 1;
  const memoKey = walkKey(state);
  if (memo.has(memoKey)) {
    const cached = memo.get(memoKey);
    for (const edge of cached.edges) edges.add(edge);
    for (const node of cached.nodes) nodes.add(node);
    mergePathMetrics(metrics, cached.pathMetrics);
    return;
  }

  const startEdgeCount = edges.size;
  const startNodeCount = nodes.size;
  const pathBefore = capturePathMetrics(metrics);
  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);

  if (remaining === 0) {
    remember();
    return;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (!legal.length) {
    if (state.goPlayer !== -1) {
      const next = cloneState(state);
      next.fullSymbols.push(RESET_SYMBOL);
      next.edgeSymbols.push(RESET_SYMBOL);
      let score = 0;
      let scorer = next.lastPlayer;
      if (next.lastPlayer !== -1 && next.count !== 31) score = 1;
      next.plays = [];
      next.count = 0;
      next.current = 1 - next.current;
      next.goPlayer = -1;
      next.lastPlayer = -1;
      if (score > 0) {
        continueAfterScore(next, scorer, score, "go", nodes, edges, memo, touchOrder, memoLimit, metrics);
      } else {
        walk(next, nodes, edges, memo, touchOrder, memoLimit, metrics);
      }
    } else {
      const next = cloneState(state);
      next.fullSymbols.push(GO_SYMBOL);
      next.edgeSymbols.push(GO_SYMBOL);
      next.current = 1 - next.current;
      next.goPlayer = state.current;
      walk(next, nodes, edges, memo, touchOrder, memoLimit, metrics);
    }
    remember();
    return;
  }

  for (const rank of legal) {
    const next = cloneState(state);
    next.hands[next.current][rank] -= 1;
    next.plays.push(rank);
    next.fullSymbols.push(rank);
    next.edgeSymbols.push(rank);
    let score = scoreCountRanks(next.plays);
    const scorer = next.current;
    next.count += VALUES[rank];
    next.lastPlayer = next.current;
    next.goPlayer = -1;
    const noCardsRemain = rankTotal(next.hands[0]) + rankTotal(next.hands[1]) === 0;
    if (noCardsRemain && next.count !== 31) score += 1;
    if (next.count === 31) {
      next.plays = [];
      next.count = 0;
      next.lastPlayer = -1;
    }
    next.current = 1 - next.current;
    if (score > 0) {
      continueAfterScore(next, scorer, score, noCardsRemain ? "terminal" : "play", nodes, edges, memo, touchOrder, memoLimit, metrics);
      continue;
    }
    walk(next, nodes, edges, memo, touchOrder, memoLimit, metrics);
  }

  remember();

  function remember() {
    if (memoLimit <= 0) return;
    const cached = {
      nodes: [...nodes].slice(startNodeCount),
      edges: [...edges].slice(startEdgeCount),
      pathMetrics: diffPathMetrics(pathBefore, capturePathMetrics(metrics)),
    };
    memo.set(memoKey, cached);
    touchOrder.push(memoKey);
    while (touchOrder.length > memoLimit) memo.delete(touchOrder.shift());
  }
}

function continueAfterScore(state, scorer, score, scoreType, nodes, edges, memo, touchOrder, memoLimit, metrics) {
  const terminal = rankTotal(state.hands[0]) + rankTotal(state.hands[1]) === 0;
  metrics.scoringEvents += 1;
  metrics.scoreByType[scoreType] = (metrics.scoreByType[scoreType] || 0) + 1;
  state.edgeScores.push({ scorer, score, type: scoreType, at: state.edgeSymbols.length, terminal });
  const shouldStoreNode = !terminal && hasMultipleLegalContinuations(state);
  if (shouldStoreNode) {
    const destination = `${state.pairId}:${state.role}:${packSymbols(state.fullSymbols)}`;
    nodes.add(destination);
    emitEdge(state, destination, false, edges, metrics);
    const next = cloneState(state);
    next.sourceNode = destination;
    next.edgeSymbols = [];
    next.edgeScores = [];
    walk(next, nodes, edges, new Map(), [], 0, metrics);
    return;
  }
  if (terminal) {
    emitEdge(state, "terminal", true, edges, metrics);
    metrics.terminalEvents += 1;
    return;
  }
  walk(state, nodes, edges, memo, touchOrder, memoLimit, metrics);
}

function emitEdge(state, destination, terminal, edges, metrics) {
  const encodedEdge = packSymbols(state.edgeSymbols);
  const encodedScores = state.edgeScores.map((event) => `${event.at}.${event.scorer}.${event.score}.${event.terminal ? 1 : 0}`).join(",");
  edges.add(`${state.sourceNode}>${encodedEdge}>${destination}:${terminal ? 1 : 0}:${encodedScores}`);
  metrics.edgesWithScores += 1;
  metrics.scoreCheckpointsOnEdges += state.edgeScores.length;
  metrics.maxScoresPerEdge = Math.max(metrics.maxScoresPerEdge, state.edgeScores.length);
  metrics.maxEdgeSymbols = Math.max(metrics.maxEdgeSymbols, state.edgeSymbols.length);
  metrics.edgeSymbolTotal += state.edgeSymbols.length;
  if (state.edgeSymbols.length <= 16) metrics.inline64Edges += 1;
  else metrics.overflowEdges += 1;
}

function hasMultipleLegalContinuations(state) {
  const legal = legalRanks(state.hands[state.current], state.count);
  return legal.length > 1;
}

function emptyMetrics() {
  return {
    roots: 0,
    nodes: 0,
    edges: 0,
    scoringEvents: 0,
    terminalEvents: 0,
    visitedStates: 0,
    inline64Edges: 0,
    overflowEdges: 0,
    edgesWithScores: 0,
    scoreCheckpointsOnEdges: 0,
    maxScoresPerEdge: 0,
    maxEdgeSymbols: 0,
    edgeSymbolTotal: 0,
    scoreByType: {},
  };
}

function mergeMetrics(target, source) {
  target.roots += source.roots;
  target.nodes += source.nodes;
  target.edges += source.edges;
  target.scoringEvents += source.scoringEvents;
  target.terminalEvents += source.terminalEvents;
  target.visitedStates += source.visitedStates;
  target.inline64Edges += source.inline64Edges;
  target.overflowEdges += source.overflowEdges;
  target.edgesWithScores += source.edgesWithScores;
  target.scoreCheckpointsOnEdges += source.scoreCheckpointsOnEdges;
  target.maxScoresPerEdge = Math.max(target.maxScoresPerEdge, source.maxScoresPerEdge);
  target.maxEdgeSymbols = Math.max(target.maxEdgeSymbols, source.maxEdgeSymbols);
  target.edgeSymbolTotal += source.edgeSymbolTotal;
  for (const [key, value] of Object.entries(source.scoreByType || {})) {
    target.scoreByType[key] = (target.scoreByType[key] || 0) + value;
  }
}

function capturePathMetrics(metrics) {
  return {
    scoringEvents: metrics.scoringEvents,
    terminalEvents: metrics.terminalEvents,
    inline64Edges: metrics.inline64Edges,
    overflowEdges: metrics.overflowEdges,
    edgesWithScores: metrics.edgesWithScores,
    scoreCheckpointsOnEdges: metrics.scoreCheckpointsOnEdges,
    maxScoresPerEdge: metrics.maxScoresPerEdge,
    edgeSymbolTotal: metrics.edgeSymbolTotal,
    maxEdgeSymbols: metrics.maxEdgeSymbols,
    scoreByType: { ...metrics.scoreByType },
  };
}

function diffPathMetrics(before, after) {
  const diff = {
    scoringEvents: after.scoringEvents - before.scoringEvents,
    terminalEvents: after.terminalEvents - before.terminalEvents,
    inline64Edges: after.inline64Edges - before.inline64Edges,
    overflowEdges: after.overflowEdges - before.overflowEdges,
    edgesWithScores: after.edgesWithScores - before.edgesWithScores,
    scoreCheckpointsOnEdges: after.scoreCheckpointsOnEdges - before.scoreCheckpointsOnEdges,
    maxScoresPerEdge: after.maxScoresPerEdge,
    edgeSymbolTotal: after.edgeSymbolTotal - before.edgeSymbolTotal,
    maxEdgeSymbols: after.maxEdgeSymbols,
    scoreByType: {},
  };
  for (const [key, value] of Object.entries(after.scoreByType)) {
    diff.scoreByType[key] = value - (before.scoreByType[key] || 0);
  }
  return diff;
}

function mergePathMetrics(metrics, diff) {
  metrics.scoringEvents += diff.scoringEvents;
  metrics.terminalEvents += diff.terminalEvents;
  metrics.inline64Edges += diff.inline64Edges;
  metrics.overflowEdges += diff.overflowEdges;
  metrics.edgesWithScores += diff.edgesWithScores;
  metrics.scoreCheckpointsOnEdges += diff.scoreCheckpointsOnEdges;
  metrics.maxScoresPerEdge = Math.max(metrics.maxScoresPerEdge, diff.maxScoresPerEdge);
  metrics.edgeSymbolTotal += diff.edgeSymbolTotal;
  metrics.maxEdgeSymbols = Math.max(metrics.maxEdgeSymbols, diff.maxEdgeSymbols);
  for (const [key, value] of Object.entries(diff.scoreByType || {})) {
    metrics.scoreByType[key] = (metrics.scoreByType[key] || 0) + value;
  }
}

function summarizePartials({ partials, sampleRoots, totalRoots, startRoot, workers, oldMb, memoLimit, elapsedSeconds }) {
  const totals = emptyMetrics();
  for (const partial of partials) mergeMetrics(totals, partial);
  const scale = totalRoots / Math.max(1, sampleRoots);
  const avgEdgeSymbols = totals.edges ? totals.edgeSymbolTotal / totals.edges : 0;
  const estimatedBytes = estimateBytes(totals.nodes, totals.edges, totals.edgeSymbolTotal, totals.overflowEdges, totals.scoreCheckpointsOnEdges);
  return {
    sampleRoots,
    totalRoots,
    startRoot,
    workers,
    oldMb,
    memoLimit,
    elapsedSeconds: round(elapsedSeconds, 3),
    rootsPerSecond: round(sampleRoots / Math.max(elapsedSeconds, 0.001), 4),
    nodes: totals.nodes,
    edges: totals.edges,
    scoringEvents: totals.scoringEvents,
    terminalEvents: totals.terminalEvents,
    visitedStates: totals.visitedStates,
    inline64Edges: totals.inline64Edges,
    overflowEdges: totals.overflowEdges,
    edgesWithScores: totals.edgesWithScores,
    scoreCheckpointsOnEdges: totals.scoreCheckpointsOnEdges,
    averageScoreCheckpointsPerEdge: round(totals.scoreCheckpointsOnEdges / Math.max(1, totals.edges), 3),
    maxScoresPerEdge: totals.maxScoresPerEdge,
    overflowRate: round(totals.overflowEdges / Math.max(1, totals.edges), 6),
    averageEdgeSymbols: round(avgEdgeSymbols, 3),
    maxEdgeSymbols: totals.maxEdgeSymbols,
    scoreByType: totals.scoreByType,
    estimatedBytes,
    linearEstimate: {
      nodes: Math.round(totals.nodes * scale),
      edges: Math.round(totals.edges * scale),
      scoringEvents: Math.round(totals.scoringEvents * scale),
      estimatedBytes: Math.round(estimatedBytes * scale),
      elapsedSeconds: Math.round(elapsedSeconds * scale),
      expectedCompletionAt: new Date(Date.now() + elapsedSeconds * scale * 1000).toISOString(),
    },
  };
}

function estimateBytes(nodes, edges, edgeSymbolTotal, overflowEdges, scoreCheckpoints = 0) {
  const nodeBytes = nodes * 24;
  const edgeBytes = edges * 24;
  const scoreBytes = scoreCheckpoints * 4;
  const overflowBytes = overflowEdges * 8 + Math.ceil(Math.max(0, edgeSymbolTotal - (edges - overflowEdges) * 16) / 2);
  return nodeBytes + edgeBytes + scoreBytes + overflowBytes;
}

function walkKey(state) {
  return [
    state.pairId,
    state.role,
    state.hands[0].join(""),
    state.hands[1].join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
    state.sourceNode,
    state.edgeSymbols.join(","),
    state.edgeScores.map((event) => `${event.at}.${event.scorer}.${event.score}.${event.terminal ? 1 : 0}`).join(","),
  ].join("|");
}

function cloneState(state) {
  return {
    pairId: state.pairId,
    role: state.role,
    hands: [state.hands[0].slice(), state.hands[1].slice()],
    plays: state.plays.slice(),
    count: state.count,
    current: state.current,
    goPlayer: state.goPlayer,
    lastPlayer: state.lastPlayer,
    fullSymbols: state.fullSymbols.slice(),
    edgeSymbols: state.edgeSymbols.slice(),
    edgeScores: state.edgeScores.map((event) => ({ ...event })),
    sourceNode: state.sourceNode,
  };
}

function packSymbols(symbols) {
  if (symbols.length <= 16) {
    let packed = 0n;
    for (let index = 0; index < symbols.length; index += 1) packed |= BigInt(symbols[index] & 0xf) << BigInt(index * 4);
    return `${symbols.length}:${packed.toString(16)}`;
  }
  return `${symbols.length}:${symbols.map((symbol) => symbol.toString(16)).join("")}`;
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

function isValidPair(a, b) {
  for (let rank = 0; rank < 13; rank += 1) {
    if (a[rank] + b[rank] > 4) return false;
  }
  return true;
}

function legalRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < ranks.length; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function rankTotal(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
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
