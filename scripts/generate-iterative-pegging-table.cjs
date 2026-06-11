const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const SCHELL_OWN = [
  [5.38, 4.23, 4.52, 5.43, 5.45, 3.85, 3.85, 3.80, 3.40, 3.42, 3.65, 3.42, 3.41],
  [4.23, 5.72, 7.00, 4.52, 5.45, 3.93, 3.81, 3.66, 3.71, 3.55, 3.84, 3.58, 3.52],
  [4.52, 7.00, 5.94, 4.91, 5.97, 3.81, 3.58, 3.92, 3.78, 3.57, 3.90, 3.59, 3.67],
  [5.43, 4.52, 4.91, 5.63, 6.48, 3.85, 3.72, 3.83, 3.72, 3.59, 3.88, 3.59, 3.60],
  [5.45, 5.45, 5.97, 6.48, 8.79, 6.63, 6.01, 5.48, 5.43, 6.66, 7.00, 6.63, 6.66],
  [3.85, 3.93, 3.81, 3.85, 6.63, 5.76, 4.98, 4.63, 5.13, 3.17, 3.41, 3.23, 3.13],
  [3.85, 3.81, 3.58, 3.72, 6.01, 4.98, 5.92, 6.53, 4.04, 3.23, 3.53, 3.23, 3.26],
  [3.80, 3.66, 3.92, 3.83, 5.48, 4.63, 6.53, 5.45, 4.72, 3.80, 3.52, 3.19, 3.16],
  [3.40, 3.71, 3.78, 3.72, 5.43, 5.13, 4.04, 4.72, 5.16, 4.29, 3.97, 2.99, 3.06],
  [3.42, 3.55, 3.57, 3.59, 6.66, 3.17, 3.23, 3.80, 4.29, 4.76, 4.61, 3.31, 2.84],
  [3.65, 3.84, 3.90, 3.88, 7.00, 3.41, 3.53, 3.52, 3.97, 4.61, 5.33, 4.81, 3.96],
  [3.42, 3.58, 3.59, 3.59, 6.63, 3.23, 3.23, 3.19, 2.99, 3.31, 4.81, 4.79, 3.46],
  [3.41, 3.52, 3.67, 3.60, 6.66, 3.13, 3.26, 3.16, 3.06, 2.84, 3.96, 3.46, 4.58],
];
const SCHELL_OPPONENT = [
  [6.02, 5.07, 5.07, 5.72, 6.01, 4.91, 4.89, 4.85, 4.55, 4.48, 4.68, 4.33, 4.30],
  [5.07, 6.38, 7.33, 5.33, 6.11, 4.97, 4.97, 4.94, 4.70, 4.59, 4.81, 4.56, 4.45],
  [5.07, 7.33, 6.68, 5.96, 6.78, 4.87, 5.01, 5.05, 4.87, 4.63, 4.86, 4.59, 4.48],
  [5.72, 5.33, 5.96, 6.53, 7.26, 5.34, 4.88, 4.94, 4.68, 4.53, 4.85, 4.46, 4.36],
  [6.01, 6.11, 6.78, 7.26, 9.37, 7.47, 7.00, 6.30, 6.15, 7.41, 7.76, 7.34, 7.25],
  [4.91, 4.97, 4.87, 5.34, 7.47, 7.08, 6.42, 5.86, 6.26, 4.31, 4.57, 4.22, 4.14],
  [4.89, 4.97, 5.01, 4.88, 7.00, 6.42, 7.14, 7.63, 5.26, 4.31, 4.68, 4.32, 4.27],
  [4.85, 4.94, 5.05, 4.94, 6.30, 5.86, 7.63, 6.82, 5.83, 5.10, 4.59, 4.31, 4.20],
  [4.55, 4.70, 4.87, 4.68, 6.15, 6.26, 5.26, 5.83, 6.39, 5.43, 4.96, 4.11, 4.03],
  [4.48, 4.59, 4.63, 4.53, 7.41, 4.31, 4.31, 5.10, 5.43, 6.08, 5.63, 4.61, 3.88],
  [4.68, 4.81, 4.86, 4.85, 7.76, 4.57, 4.68, 4.59, 4.96, 5.63, 6.42, 5.46, 4.77],
  [4.33, 4.56, 4.59, 4.46, 7.34, 4.22, 4.32, 4.31, 4.11, 4.61, 5.46, 5.79, 4.49],
  [4.30, 4.45, 4.48, 4.36, 7.25, 4.14, 4.27, 4.20, 4.03, 3.88, 4.77, 4.49, 5.65],
];

const mode = process.argv[2] || "benchmark";
const root = path.resolve(__dirname, "..");
const defaultOutDir = path.join(root, "benchmarks", "pegging-table");

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData);
}

async function main() {
  if (mode === "benchmark") {
    const sampleRows = numberArg(3, 12);
    const workerCounts = (process.argv[4] || "1,2,4")
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    const memoWindowRows = numberArg(5, 3);
    const rows = sampleDeterministic(enumerateTableRows(), sampleRows, 997);
    const fullRows = enumerateTableRows().length;
    const collectHistograms = process.env.PEG_TABLE_COLLECT_HISTOGRAMS === "1";
    const results = [];
    for (const workerCount of workerCounts) {
      const result = await runRows({
        rows,
        workerCount,
        memoWindowRows,
        writeOutput: false,
        collectHistograms,
      });
      results.push({
        workerCount,
        sampleRows,
        fullRows,
        elapsedSeconds: result.elapsedSeconds,
        rowsPerSecond: result.rowsPerSecond,
        estimatedFullRunSeconds: fullRows / result.rowsPerSecond,
        estimatedFullRun: formatDuration(fullRows / result.rowsPerSecond),
        maxWorkerHeapMb: result.maxWorkerHeapMb,
        maxWorkerMemoEntries: result.maxWorkerMemoEntries,
        averageOpponentSixHands: result.averageOpponentSixHands,
        averageAggregatedKeeps: result.averageAggregatedKeeps,
      });
    }
    console.log(JSON.stringify({ mode, memoWindowRows, collectHistograms, results }, null, 2));
    return;
  }

  if (mode === "generate") {
    const outDir = process.argv[3] || defaultOutDir;
    const workerCount = numberArg(4, Math.max(1, Math.min(os.cpus().length - 2, 6)));
    const memoWindowRows = numberArg(5, 3);
    const start = numberArg(6, 0);
    const count = numberArg(7, 0);
    const priorPolicyArg = process.argv[8] || "";
    const priorPolicyPath = ["", "none", "-"].includes(priorPolicyArg) ? "" : priorPolicyArg;
    const iteration = numberArg(9, priorPolicyPath ? 1 : 0);
    const iterationCount = Math.max(1, numberArg(10, 1));
    const rows = enumerateTableRows();
    fs.mkdirSync(outDir, { recursive: true });
    const statusPath = path.join(outDir, "status.json");
    let activePriorPolicyPath = priorPolicyPath;
    let activePriorPolicy = priorPolicyPath ? readPolicy(priorPolicyPath) : null;
    for (let offset = 0; offset < iterationCount; offset += 1) {
      const activeIteration = iteration + offset;
      const activeStart = offset === 0 ? start : 0;
      const activeRows = count > 0 && offset === 0
        ? rows.slice(activeStart, activeStart + count)
        : rows.slice(activeStart);
      const appendOutput = offset === 0 && activeStart > 0;
      const outputPath = path.join(outDir, `iteration-${activeIteration}.rows.jsonl`);
      const policyPath = path.join(outDir, `iteration-${activeIteration}.policy.json`);
      const summaryPath = path.join(outDir, `iteration-${activeIteration}.summary.json`);
      const collectHistograms = shouldCollectHistograms(offset, iterationCount);
      validateOutputTarget(outputPath, appendOutput, activeStart);
      writeStatus(statusPath, {
        status: "running",
        phase: "generating-rows",
        updatedAt: new Date().toISOString(),
        command: exactCommand(),
        gitCommit: gitCommitHash(),
        gitStatus: gitStatusShort(),
        iteration: activeIteration,
        iterationOffset: offset,
        iterationCount,
        outputPath,
        policyPath,
        summaryPath,
        priorPolicyPath: activePriorPolicyPath || null,
        completedRows: activeStart,
        totalRows: rows.length,
        remainingRows: activeRows.length,
        fullRows: rows.length,
        start: activeStart,
        workerCount,
        memoWindowRows,
        appendOutput,
        collectHistograms,
      });
      const result = await runRows({
        rows: activeRows,
        workerCount,
        memoWindowRows,
        writeOutput: true,
        outputPath,
        appendOutput,
        completedOffset: activeStart,
        totalRows: rows.length,
        priorPolicy: activePriorPolicy,
        collectHistograms,
        statusPath,
        statusContext: {
          command: exactCommand(),
          gitCommit: gitCommitHash(),
          gitStatus: gitStatusShort(),
          iteration: activeIteration,
          iterationOffset: offset,
          iterationCount,
          outputPath,
          policyPath,
          summaryPath,
          priorPolicyPath: activePriorPolicyPath || null,
          fullRows: rows.length,
          start: activeStart,
          workerCount,
          memoWindowRows,
          appendOutput,
          collectHistograms,
        },
      });
      const expectedWrittenRows = appendOutput ? activeStart + activeRows.length : activeRows.length;
      const validation = validateRowsFile(outputPath, expectedWrittenRows, rows);
      writeStatus(statusPath, {
        status: "running",
        phase: "deriving-policy",
        updatedAt: new Date().toISOString(),
        command: exactCommand(),
        gitCommit: gitCommitHash(),
        gitStatus: gitStatusShort(),
        iteration: activeIteration,
        iterationOffset: offset,
        iterationCount,
        outputPath,
        policyPath,
        summaryPath,
        priorPolicyPath: activePriorPolicyPath || null,
        completedRows: activeStart + activeRows.length,
        totalRows: rows.length,
        remainingRows: activeRows.length,
        fullRows: rows.length,
        start: activeStart,
        workerCount,
        memoWindowRows,
        appendOutput,
        collectHistograms,
        validation,
        ...result,
      });
      const policy = derivePolicy(outputPath, activePriorPolicy);
      fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
      const summary = {
        version: 1,
        iteration: activeIteration,
        policy: activePriorPolicyPath
          ? `rank hand EV +/- Schell crib table + prior pegging policy from ${activePriorPolicyPath}`
          : "rank hand EV +/- Schell crib table; no prior pegging EV table",
        generatedAt: new Date().toISOString(),
        command: exactCommand(),
        gitCommit: gitCommitHash(),
        gitStatus: gitStatusShort(),
        outputPath,
        policyPath,
        summaryPath,
        priorPolicyPath: activePriorPolicyPath || null,
        fullRows: rows.length,
        start: activeStart,
        rows: activeRows.length,
        totalRows: rows.length,
        appendOutput,
        collectHistograms,
        workerCount,
        memoWindowRows,
        iterationCount,
        validation,
        policyStats: policy.stats,
        ...result,
      };
      fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
      writeStatus(statusPath, {
        status: offset === iterationCount - 1 ? "complete" : "running",
        phase: offset === iterationCount - 1 ? "complete" : "iteration-complete",
        updatedAt: new Date().toISOString(),
        command: exactCommand(),
        gitCommit: gitCommitHash(),
        gitStatus: gitStatusShort(),
        iteration: activeIteration,
        iterationOffset: offset,
        iterationCount,
        outputPath,
        policyPath,
        summaryPath,
        priorPolicyPath: activePriorPolicyPath || null,
        completedRows: activeStart + activeRows.length,
        totalRows: rows.length,
        remainingRows: activeRows.length,
        fullRows: rows.length,
        start: activeStart,
        workerCount,
        memoWindowRows,
        appendOutput,
        collectHistograms,
        validation,
        policyStats: policy.stats,
        ...result,
      });
      console.log(JSON.stringify(summary, null, 2));
      activePriorPolicyPath = policyPath;
      activePriorPolicy = policy;
    }
    return;
  }

  if (mode === "derive-policy") {
    const rowsPath = process.argv[3];
    const outputPath = process.argv[4] || rowsPath?.replace(/\.rows\.jsonl$/, ".policy.json");
    if (!rowsPath || !outputPath) {
      throw new Error("Usage: node scripts/generate-iterative-pegging-table.cjs derive-policy <rows.jsonl> [policy.json]");
    }
    const policy = derivePolicy(rowsPath);
    fs.writeFileSync(outputPath, `${JSON.stringify(policy, null, 2)}\n`);
    console.log(JSON.stringify({
      rowsPath,
      outputPath,
      entries: Object.keys(policy.bestDiscards).length,
    }, null, 2));
    return;
  }

  throw new Error("Usage: node scripts/generate-iterative-pegging-table.cjs benchmark [sampleRows] [workerCounts] [memoWindowRows] | generate [outDir] [workers] [memoWindowRows] [start] [count] [priorPolicyPath|none] [iteration] [iterationCount] | derive-policy <rows.jsonl> [policy.json]");
}

async function runRows({
  rows,
  workerCount,
  memoWindowRows,
  writeOutput,
  outputPath,
  appendOutput = false,
  completedOffset = 0,
  totalRows = rows.length,
  priorPolicy = null,
  statusPath = "",
  statusContext = {},
  collectHistograms = false,
}) {
  const startedAt = performance.now();
  let completed = 0;
  let myPeggingEvTotal = 0;
  let opponentPeggingEvTotal = 0;
  let opponentSixHandsTotal = 0;
  let aggregatedKeepsTotal = 0;
  let maxWorkerHeapMb = 0;
  let maxWorkerMemoEntries = 0;
  const output = writeOutput ? fs.createWriteStream(outputPath, { flags: appendOutput ? "a" : "w" }) : null;
  const chunks = splitRows(rows, workerCount);

  await Promise.all(chunks.map((chunk, workerIndex) => new Promise((resolve, reject) => {
    if (chunk.length === 0) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: {
        rows: chunk,
        workerIndex,
        memoWindowRows,
        priorPolicy,
        collectHistograms,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: Number.parseInt(process.env.PEG_TABLE_WORKER_OLD_MB || "2048", 10),
        maxYoungGenerationSizeMb: Number.parseInt(process.env.PEG_TABLE_WORKER_YOUNG_MB || "128", 10),
      },
    });
    worker.on("message", (message) => {
      if (message.type === "row") {
        completed += 1;
        myPeggingEvTotal += message.row.myPeggingEv;
        opponentPeggingEvTotal += message.row.opponentPeggingEv;
        opponentSixHandsTotal += message.row.opponentSixHands;
        aggregatedKeepsTotal += message.row.aggregatedKeeps;
        maxWorkerHeapMb = Math.max(maxWorkerHeapMb, message.heapUsedMb);
        maxWorkerMemoEntries = Math.max(maxWorkerMemoEntries, message.memoEntries);
        if (output) output.write(`${JSON.stringify(message.row)}\n`);
        if (completed % 25 === 0 || completed === rows.length) {
          const elapsedSeconds = (performance.now() - startedAt) / 1000;
          const rowsPerSecond = completed / elapsedSeconds;
          const remainingRows = rows.length - completed;
          const estimatedRemainingSeconds = rowsPerSecond ? remainingRows / rowsPerSecond : null;
          if (statusPath) {
            const updatedAt = new Date().toISOString();
            writeStatus(statusPath, {
              status: "running",
              phase: "generating-rows",
              updatedAt,
              ...statusContext,
              completedRows: completedOffset + completed,
              totalRows,
              remainingRows: rows.length,
              progressPercent: totalRows ? ((completedOffset + completed) / totalRows) * 100 : 100,
              elapsedSeconds,
              rowsPerSecond,
              estimatedRemainingSeconds,
              expectedCompletionAt: expectedCompletionAt(updatedAt, estimatedRemainingSeconds),
              maxWorkerHeapMb,
              maxWorkerMemoEntries,
              averageMyPeggingEv: completed ? myPeggingEvTotal / completed : 0,
              averageOpponentPeggingEv: completed ? opponentPeggingEvTotal / completed : 0,
              averageNetPeggingEv: completed ? (myPeggingEvTotal - opponentPeggingEvTotal) / completed : 0,
              averageOpponentSixHands: completed ? opponentSixHandsTotal / completed : 0,
              averageAggregatedKeeps: completed ? aggregatedKeepsTotal / completed : 0,
            });
          }
          process.stdout.write(
            `Rows ${completed}/${rows.length} ` +
              `(${rowsPerSecond.toFixed(3)} rows/sec, heap ${maxWorkerHeapMb.toFixed(0)} MB)\n`,
          );
        }
      } else if (message.type === "stats") {
        maxWorkerHeapMb = Math.max(maxWorkerHeapMb, message.heapUsedMb);
        maxWorkerMemoEntries = Math.max(maxWorkerMemoEntries, message.memoEntries);
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  })));

  if (output) await new Promise((resolve) => output.end(resolve));
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  return {
    elapsedSeconds,
    rowsPerSecond: rows.length / elapsedSeconds,
    averageMyPeggingEv: rows.length ? myPeggingEvTotal / rows.length : 0,
    averageOpponentPeggingEv: rows.length ? opponentPeggingEvTotal / rows.length : 0,
    averageNetPeggingEv: rows.length ? (myPeggingEvTotal - opponentPeggingEvTotal) / rows.length : 0,
    averageOpponentSixHands: rows.length ? opponentSixHandsTotal / rows.length : 0,
    averageAggregatedKeeps: rows.length ? aggregatedKeepsTotal / rows.length : 0,
    maxWorkerHeapMb,
    maxWorkerMemoEntries,
  };
}

function runWorker({ rows, memoWindowRows, priorPolicy, collectHistograms }) {
  let stateMemo = new Map();
  let opponentSixMemo = new Map();
  let opponentKeepDistributionMemo = new Map();
  let discardMemo = new Map();
  let handScoreMemo = new Map();
  const policy = priorPolicy ? inflatePolicy(priorPolicy) : null;
  let currentSourceHandKey = "";

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sourceHandKey = row.hand.join("");
    if (sourceHandKey !== currentSourceHandKey) {
      currentSourceHandKey = sourceHandKey;
      stateMemo = new Map();
      opponentSixMemo = new Map();
      opponentKeepDistributionMemo = new Map();
      discardMemo = new Map();
      handScoreMemo = new Map();
    }
    const result = peggingEvForRow(row, {
      stateMemo,
      opponentSixMemo,
      opponentKeepDistributionMemo,
      discardMemo,
      handScoreMemo,
      priorPolicy: policy,
      collectHistograms,
    });
    parentPort.postMessage({
      type: "row",
      row: result,
      heapUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
      memoEntries: stateMemo.size,
    });
    if ((index + 1) % memoWindowRows === 0) stateMemo = new Map();
  }
  parentPort.postMessage({
    type: "stats",
    heapUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
    memoEntries: stateMemo.size,
  });
}

function peggingEvForRow(row, caches) {
  const available = Array.from({ length: 13 }, (_, rank) => 4 - row.hand[rank]);
  const opponentSixHands = enumerateRankHands(available, 6, caches.opponentSixMemo);
  const keepDistribution = aggregateOpponentKeeps(opponentSixHands, row, caches);
  let myTotal = 0;
  let opponentTotal = 0;
  let weight = 0;
  const jointHist = caches.collectHistograms ? new Map() : null;
  const rowPlayer = row.role === "dealer" ? 1 : 0;

  for (const opponent of keepDistribution.values()) {
    const hands = row.role === "dealer"
      ? [opponent.ranks, row.keep]
      : [row.keep, opponent.ranks];
    const pegging = simulatePegging({
      hands,
      plays: [],
      count: 0,
      current: 0,
      goPlayer: -1,
      lastPlayer: -1,
    }, caches.stateMemo, caches.collectHistograms);
    const myPoints = pegging.points[rowPlayer];
    const opponentPoints = pegging.points[1 - rowPlayer];
    myTotal += myPoints * opponent.weight;
    opponentTotal += opponentPoints * opponent.weight;
    weight += pegging.weight * opponent.weight;
    if (jointHist && pegging.hist) {
      for (const [key, count] of pegging.hist) {
        const [leftPoints, rightPoints] = parseHistKey(key);
        const my = rowPlayer === 0 ? leftPoints : rightPoints;
        const opponentScore = rowPlayer === 0 ? rightPoints : leftPoints;
        addHist(jointHist, histKey(my, opponentScore), count * opponent.weight);
      }
    }
  }

  const myPeggingEv = weight ? myTotal / weight : 0;
  const opponentPeggingEv = weight ? opponentTotal / weight : 0;
  const leadOptions = row.role === "pone" ? leadOptionsForPone(row, keepDistribution, caches) : null;
  const result = {
    key: rowKey(row.hand, row.discard, row.role),
    hand: row.hand.join(""),
    discard: row.discard.join(""),
    keep: row.keep.join(""),
    role: row.role,
    myPeggingEv,
    opponentPeggingEv,
    netPeggingEv: myPeggingEv - opponentPeggingEv,
    leadOptions,
    bestLead: leadOptions ? bestLeadFromOptions(leadOptions) : null,
    opponentSixHands: opponentSixHands.length,
    aggregatedKeeps: keepDistribution.size,
  };
  if (jointHist) {
    result.pegJointHist = compactJointHist(jointHist);
    result.pegNetHist = compactNetHist(jointHist);
    result.pegStats = peggingStats(jointHist, weight);
    result.rankHandScoreHist = rankHandScoreHist(row.keep, row.hand);
  }
  return result;
}

function aggregateOpponentKeeps(opponentSixHands, row, caches) {
  const memoKey = `${row.hand.join("")}:${row.role}`;
  const cached = caches.opponentKeepDistributionMemo.get(memoKey);
  if (cached) return cached;
  const distribution = new Map();
  for (const opponentHand of opponentSixHands) {
    const opponentRole = row.role === "dealer" ? "pone" : "dealer";
    const opponentDiscard = chooseBestDiscard(opponentHand.ranks, opponentRole, caches);
    const keep = subtractRanks(opponentHand.ranks, opponentDiscard.discard);
    const key = keep.join("");
    const existing = distribution.get(key);
    if (existing) existing.weight += opponentHand.weight;
    else distribution.set(key, { ranks: keep, weight: opponentHand.weight });
  }
  caches.opponentKeepDistributionMemo.set(memoKey, distribution);
  return distribution;
}

function leadOptionsForPone(row, keepDistribution, caches) {
  const legalLeads = legalRanks(row.keep, 0);
  const options = [];
  for (const lead of legalLeads) {
    const ownAfterLead = row.keep.slice();
    ownAfterLead[lead] -= 1;
    let myTotal = 0;
    let opponentTotal = 0;
    let weight = 0;
    const jointHist = caches.collectHistograms ? new Map() : null;
    for (const opponent of keepDistribution.values()) {
      const pegging = simulatePegging({
        hands: [ownAfterLead, opponent.ranks],
        plays: [lead],
        count: VALUES[lead],
        current: 1,
        goPlayer: -1,
        lastPlayer: 0,
      }, caches.stateMemo, caches.collectHistograms);
      myTotal += pegging.points[0] * opponent.weight;
      opponentTotal += pegging.points[1] * opponent.weight;
      weight += pegging.weight * opponent.weight;
      if (jointHist && pegging.hist) {
        for (const [key, count] of pegging.hist) addHist(jointHist, key, count * opponent.weight);
      }
    }
    const myPeggingEv = weight ? myTotal / weight : 0;
    const opponentPeggingEv = weight ? opponentTotal / weight : 0;
    const option = {
      rank: lead,
      myPeggingEv,
      opponentPeggingEv,
      netPeggingEv: myPeggingEv - opponentPeggingEv,
    };
    if (jointHist) {
      option.pegJointHist = compactJointHist(jointHist);
      option.pegNetHist = compactNetHist(jointHist);
      option.pegStats = peggingStats(jointHist, weight);
    }
    options.push(option);
  }
  return options.sort((a, b) => compareLeadCandidate(b, a));
}

function bestLeadFromOptions(options) {
  return options[0] ?? null;
}

function compareLeadCandidate(a, b) {
  if (a.netPeggingEv !== b.netPeggingEv) return a.netPeggingEv - b.netPeggingEv;
  if (a.myPeggingEv !== b.myPeggingEv) return a.myPeggingEv - b.myPeggingEv;
  return VALUES[b.rank] - VALUES[a.rank];
}

function chooseBestDiscard(hand, role, caches) {
  const key = `${hand.join("")}:${role}`;
  const policyDiscard = caches.priorPolicy?.get(key);
  if (policyDiscard) return policyDiscard;
  const cached = caches.discardMemo.get(key);
  if (cached) return cached;
  let best = null;
  for (const discard of discardsFromHand(hand)) {
    const keep = subtractRanks(hand, discard);
    const handEv = expectedRankHandScore(keep, hand, caches.handScoreMemo);
    const cribEv = cribTableValue(discard, role === "dealer");
    const total = role === "dealer" ? handEv + cribEv : handEv - cribEv;
    const candidate = { discard, keep, total };
    if (!best || compareDiscardCandidate(candidate, best) > 0) best = candidate;
  }
  caches.discardMemo.set(key, best);
  return best;
}

function derivePolicy(rowsPath, priorPolicy = null) {
  const bestDiscards = {};
  const lines = fs.readFileSync(rowsPath, "utf8").split(/\n/).filter(Boolean);
  for (const line of lines) {
    const row = JSON.parse(line);
    const hand = parseRanks(row.hand);
    const discard = parseRanks(row.discard);
    const keep = parseRanks(row.keep);
    const role = row.role;
    const handEv = expectedRankHandScore(keep, hand, new Map());
    const cribEv = cribTableValue(discard, role === "dealer");
    const netPeggingEv = row.netPeggingEv ?? ((row.myPeggingEv ?? row.peggingEv ?? 0) - (row.opponentPeggingEv ?? 0));
    const total = (role === "dealer" ? handEv + cribEv : handEv - cribEv) + netPeggingEv;
    const key = `${row.hand}:${role}`;
    const candidate = {
      hand: row.hand,
      role,
      discard: row.discard,
      keep: row.keep,
      handEv,
      cribEv,
      myPeggingEv: row.myPeggingEv ?? null,
      opponentPeggingEv: row.opponentPeggingEv ?? null,
      netPeggingEv,
      leadOptions: row.leadOptions ?? null,
      bestLead: row.bestLead ?? null,
      total,
    };
    const current = bestDiscards[key];
    if (!current || total > current.total) bestDiscards[key] = candidate;
  }
  const stats = policyStats(bestDiscards, priorPolicy);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRows: rowsPath,
    policy: "rank hand EV +/- Schell crib table + generated net pegging EV",
    stats,
    bestDiscards,
  };
}

function policyStats(bestDiscards, priorPolicy) {
  const entries = Object.keys(bestDiscards).length;
  if (!priorPolicy?.bestDiscards) return {
    entries,
    comparedEntries: 0,
    changedDiscards: null,
    changedPercent: null,
    averageTotalDelta: null,
    maxTotalDelta: null,
  };
  let comparedEntries = 0;
  let changedDiscards = 0;
  let totalDelta = 0;
  let maxTotalDelta = 0;
  for (const [key, value] of Object.entries(bestDiscards)) {
    const prior = priorPolicy.bestDiscards[key];
    if (!prior) continue;
    comparedEntries += 1;
    if (prior.discard !== value.discard) changedDiscards += 1;
    const delta = Math.abs((value.total ?? 0) - (prior.total ?? 0));
    totalDelta += delta;
    maxTotalDelta = Math.max(maxTotalDelta, delta);
  }
  return {
    entries,
    comparedEntries,
    changedDiscards,
    changedPercent: comparedEntries ? (changedDiscards / comparedEntries) * 100 : null,
    averageTotalDelta: comparedEntries ? totalDelta / comparedEntries : null,
    maxTotalDelta,
  };
}

function readPolicy(policyPath) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

function inflatePolicy(policy) {
  const map = new Map();
  for (const [key, value] of Object.entries(policy.bestDiscards || {})) {
    map.set(key, {
      discard: parseRanks(value.discard),
      keep: parseRanks(value.keep),
      total: value.total,
    });
  }
  return map;
}

function compareDiscardCandidate(a, b) {
  if (a.total !== b.total) return a.total - b.total;
  return compareTuple(discardTieBreak(a.discard), discardTieBreak(b.discard));
}

function discardTieBreak(discard) {
  const ranks = expandRanks(discard);
  return [-VALUES[ranks[0]], -VALUES[ranks[1]], -ranks[0], -ranks[1]];
}

function expectedRankHandScore(keep, sixHand, memo) {
  const key = `${keep.join("")}:${sixHand.join("")}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const available = Array.from({ length: 13 }, (_, rank) => 4 - sixHand[rank]);
  let total = 0;
  let weight = 0;
  for (let cut = 0; cut < 13; cut += 1) {
    if (available[cut] <= 0) continue;
    total += scoreRankHand(keep, cut) * available[cut];
    weight += available[cut];
  }
  const result = weight ? total / weight : 0;
  memo.set(key, result);
  return result;
}

function rankHandScoreHist(keep, sixHand) {
  const available = Array.from({ length: 13 }, (_, rank) => 4 - sixHand[rank]);
  const hist = new Map();
  for (let cut = 0; cut < 13; cut += 1) {
    if (available[cut] <= 0) continue;
    addHist(hist, String(scoreRankHand(keep, cut)), available[cut]);
  }
  return [...hist.entries()]
    .map(([score, count]) => [Number.parseInt(score, 10), count])
    .sort((a, b) => a[0] - b[0]);
}

function scoreRankHand(hand, cutRank) {
  const ranks = [...expandRanks(hand), cutRank];
  return scoreFifteens(ranks) + scoreSets(ranks) + scoreRuns(ranks);
}

function scoreFifteens(ranks) {
  let points = 0;
  const values = ranks.map((rank) => VALUES[rank]);
  for (let mask = 1; mask < (1 << values.length); mask += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      if (mask & (1 << index)) total += values[index];
    }
    if (total === 15) points += 2;
  }
  return points;
}

function scoreSets(ranks) {
  let points = 0;
  for (let i = 0; i < ranks.length; i += 1) {
    for (let j = i + 1; j < ranks.length; j += 1) {
      if (ranks[i] === ranks[j]) points += 2;
    }
  }
  return points;
}

function scoreRuns(ranks) {
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const runs = [];
  let run = [];
  for (const rank of [...counts.keys()].sort((a, b) => a - b)) {
    if (run.length === 0 || rank === run[run.length - 1] + 1) run.push(rank);
    else {
      if (run.length >= 3) runs.push(run);
      run = [rank];
    }
  }
  if (run.length >= 3) runs.push(run);
  if (!runs.length) return 0;
  const longest = runs.reduce((best, candidate) => candidate.length > best.length ? candidate : best);
  return longest.length * longest.reduce((product, rank) => product * (counts.get(rank) || 1), 1);
}

function cribTableValue(discard, myCrib) {
  const ranks = expandRanks(discard).sort((a, b) => a - b);
  return (myCrib ? SCHELL_OWN : SCHELL_OPPONENT)[ranks[0]][ranks[1]];
}

function simulatePegging(state, memo, collectHistograms = false) {
  const key = stateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);
  if (remaining === 0) {
    const points = [0, 0];
    if (state.lastPlayer !== -1 && state.count !== 0) points[state.lastPlayer] += 1;
    const terminal = collectHistograms
      ? { points, weight: 1, hist: new Map([[histKey(points[0], points[1]), 1]]) }
      : { points, weight: 1 };
    memo.set(key, terminal);
    return terminal;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (legal.length === 0) {
    if (state.goPlayer !== -1) {
      const future = simulatePegging({
        ...state,
        plays: [],
        count: 0,
        current: 1 - state.current,
        goPlayer: -1,
        lastPlayer: -1,
      }, memo, collectHistograms);
      const points = future.points.slice();
      let hist = future.hist;
      if (state.lastPlayer !== -1 && state.count !== 31) {
        points[state.lastPlayer] += future.weight;
        if (hist) hist = shiftHist(hist, state.lastPlayer, 1);
      }
      const result = hist ? { points, weight: future.weight, hist } : { points, weight: future.weight };
      memo.set(key, result);
      return result;
    }
    const result = simulatePegging({
      ...state,
      current: 1 - state.current,
      goPlayer: state.current,
    }, memo, collectHistograms);
    memo.set(key, result);
    return result;
  }

  const totals = [0, 0];
  let weight = 0;
  const hist = collectHistograms ? new Map() : null;
  for (const rank of legal) {
    const branchWeight = state.hands[state.current][rank];
    const hands = [state.hands[0].slice(), state.hands[1].slice()];
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const points = scoreCountRanks(plays);
    const nextCount = state.count + VALUES[rank];
    const future = simulatePegging(nextCount === 31
      ? {
          ...state,
          hands,
          plays: [],
          count: 0,
          current: 1 - state.current,
          goPlayer: -1,
          lastPlayer: -1,
        }
      : {
          ...state,
          hands,
          plays,
          count: nextCount,
          current: 1 - state.current,
          goPlayer: -1,
          lastPlayer: state.current,
        }, memo, collectHistograms);
    totals[0] += branchWeight * future.points[0];
    totals[1] += branchWeight * future.points[1];
    totals[state.current] += branchWeight * points * future.weight;
    weight += branchWeight * future.weight;
    if (hist && future.hist) {
      const shifted = points ? shiftHist(future.hist, state.current, points) : future.hist;
      addWeightedHist(hist, shifted, branchWeight);
    }
  }

  const result = hist ? { points: totals, weight, hist } : { points: totals, weight };
  memo.set(key, result);
  return result;
}

function histKey(leftPoints, rightPoints) {
  return `${leftPoints},${rightPoints}`;
}

function parseHistKey(key) {
  return key.split(",").map((value) => Number.parseInt(value, 10));
}

function addHist(hist, key, value) {
  hist.set(key, (hist.get(key) || 0) + value);
}

function addWeightedHist(target, source, weight) {
  for (const [key, count] of source) addHist(target, key, count * weight);
}

function shiftHist(source, player, points) {
  const result = new Map();
  for (const [key, count] of source) {
    const [left, right] = parseHistKey(key);
    addHist(result, histKey(player === 0 ? left + points : left, player === 1 ? right + points : right), count);
  }
  return result;
}

function compactJointHist(hist) {
  return [...hist.entries()]
    .map(([key, count]) => {
      const [my, opponent] = parseHistKey(key);
      return [my, opponent, count];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function compactNetHist(hist) {
  const net = new Map();
  for (const [key, count] of hist) {
    const [my, opponent] = parseHistKey(key);
    addHist(net, String(my - opponent), count);
  }
  return [...net.entries()]
    .map(([value, count]) => [Number.parseInt(value, 10), count])
    .sort((a, b) => a[0] - b[0]);
}

function peggingStats(hist, totalWeight) {
  let myMin = Number.POSITIVE_INFINITY;
  let myMax = Number.NEGATIVE_INFINITY;
  let opponentMin = Number.POSITIVE_INFINITY;
  let opponentMax = Number.NEGATIVE_INFINITY;
  let netMin = Number.POSITIVE_INFINITY;
  let netMax = Number.NEGATIVE_INFINITY;
  let netTotal = 0;
  let netSquareTotal = 0;
  for (const [key, count] of hist) {
    const [my, opponent] = parseHistKey(key);
    const net = my - opponent;
    myMin = Math.min(myMin, my);
    myMax = Math.max(myMax, my);
    opponentMin = Math.min(opponentMin, opponent);
    opponentMax = Math.max(opponentMax, opponent);
    netMin = Math.min(netMin, net);
    netMax = Math.max(netMax, net);
    netTotal += net * count;
    netSquareTotal += net * net * count;
  }
  const netMean = totalWeight ? netTotal / totalWeight : 0;
  return {
    myMin,
    myMax,
    opponentMin,
    opponentMax,
    netMin,
    netMax,
    netVariance: totalWeight ? (netSquareTotal / totalWeight) - netMean * netMean : 0,
  };
}

function scoreCountRanks(plays) {
  if (plays.length < 2) return 0;
  let score = 0;
  const count = plays.reduce((total, rank) => total + VALUES[rank], 0);
  if (count === 15 || count === 31) score += 2;

  let sameRankCount = 1;
  for (let i = plays.length - 2; i >= 0; i -= 1) {
    if (plays[i] !== plays[plays.length - 1]) break;
    sameRankCount += 1;
  }
  if (sameRankCount === 2) score += 2;
  else if (sameRankCount === 3) score += 6;
  else if (sameRankCount === 4) score += 12;

  for (let runLen = plays.length; runLen >= 3; runLen -= 1) {
    const vals = plays.slice(-runLen);
    const unique = new Set(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    if (unique.size === runLen && sorted[sorted.length - 1] - sorted[0] + 1 === runLen) {
      score += runLen;
      break;
    }
  }
  return score;
}

function enumerateTableRows() {
  const rows = [];
  const hand = emptyRanks();

  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) addRows(hand);
      return;
    }
    for (let used = 0; used <= Math.min(4, remaining); used += 1) {
      hand[rank] = used;
      visit(rank + 1, remaining - used);
    }
    hand[rank] = 0;
  }

  function addRows(sourceHand) {
    for (const discard of discardsFromHand(sourceHand)) {
      const keep = subtractRanks(sourceHand, discard);
      rows.push({ role: "pone", hand: sourceHand.slice(), keep, discard });
      rows.push({ role: "dealer", hand: sourceHand.slice(), keep, discard });
    }
  }

  visit(0, 6);
  return rows;
}

function discardsFromHand(hand) {
  const discards = [];
  for (let first = 0; first < 13; first += 1) {
    if (hand[first] === 0) continue;
    for (let second = first; second < 13; second += 1) {
      if (hand[second] === 0) continue;
      if (first === second && hand[first] < 2) continue;
      const discard = emptyRanks();
      discard[first] += 1;
      discard[second] += 1;
      discards.push(discard);
    }
  }
  return discards;
}

function enumerateRankHands(available, size, memo) {
  const key = `${available.join("")}:${size}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const hands = [];
  const ranks = emptyRanks();

  function visit(rank, remaining, weight) {
    if (rank === 13) {
      if (remaining === 0) hands.push({ ranks: ranks.slice(), weight });
      return;
    }
    for (let used = 0; used <= Math.min(available[rank], remaining); used += 1) {
      ranks[rank] = used;
      visit(rank + 1, remaining - used, weight * choose(available[rank], used));
    }
    ranks[rank] = 0;
  }

  visit(0, size, 1);
  memo.set(key, hands);
  return hands;
}

function splitRows(rows, count) {
  const chunkSize = Math.ceil(rows.length / count);
  return Array.from({ length: count }, (_, index) =>
    rows.slice(index * chunkSize, Math.min(rows.length, (index + 1) * chunkSize)),
  );
}

function sampleDeterministic(rows, count, step) {
  const sampled = [];
  const seen = new Set();
  let index = 0;
  const blockSize = Math.min(8, count);
  while (sampled.length < Math.min(count, rows.length)) {
    for (let offset = 0; offset < blockSize && sampled.length < count; offset += 1) {
      const rowIndex = (index + offset) % rows.length;
      if (!seen.has(rowIndex)) {
        sampled.push(rows[rowIndex]);
        seen.add(rowIndex);
      }
    }
    index = (index + step) % rows.length;
  }
  return sampled;
}

function rowKey(hand, discard, role) {
  return `${hand.join("")}:${discard.join("")}:${role}`;
}

function subtractRanks(a, b) {
  return a.map((count, rank) => count - b[rank]);
}

function expandRanks(ranks) {
  const expanded = [];
  for (let rank = 0; rank < ranks.length; rank += 1) {
    for (let count = 0; count < ranks[rank]; count += 1) expanded.push(rank);
  }
  return expanded;
}

function parseRanks(value) {
  if (Array.isArray(value)) return value.map(Number);
  return String(value).split("").map((digit) => Number.parseInt(digit, 10));
}

function stateKey(state) {
  return [
    state.hands[0].join(""),
    state.hands[1].join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
  ].join("|");
}

function legalRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function rankTotal(ranks) {
  return ranks.reduce((total, count) => total + count, 0);
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function compareTuple(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function numberArg(index, fallback) {
  const raw = process.argv[index];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Argument ${index} must be a nonnegative integer.`);
  return value;
}

function exactCommand() {
  return [process.execPath, ...process.argv.slice(1)].join(" ");
}

function gitCommitHash() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitStatusShort() {
  try {
    return execFileSync("git", ["status", "--short"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function writeStatus(statusPath, status) {
  if (!statusPath) return;
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const tmpPath = `${statusPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(status, null, 2)}\n`);
  fs.renameSync(tmpPath, statusPath);
}

function shouldCollectHistograms(offset, iterationCount) {
  if (process.env.PEG_TABLE_COLLECT_HISTOGRAMS === "0") return false;
  if (process.env.PEG_TABLE_COLLECT_HISTOGRAMS === "1") return true;
  return offset === iterationCount - 1;
}

function validateOutputTarget(outputPath, appendOutput, expectedExistingRows) {
  if (appendOutput) {
    const existingRows = countJsonlRows(outputPath);
    if (existingRows !== expectedExistingRows) {
      throw new Error(
        `Refusing unsafe resume for ${outputPath}: expected ${expectedExistingRows} existing rows, found ${existingRows}.`,
      );
    }
    return;
  }
  if (fs.existsSync(outputPath) && process.env.PEG_TABLE_OVERWRITE !== "1") {
    throw new Error(`Refusing to overwrite existing rows file: ${outputPath}. Set PEG_TABLE_OVERWRITE=1 if intentional.`);
  }
}

function validateRowsFile(rowsPath, expectedRows, expectedSourceRows) {
  const rowKeys = new Set();
  const handRoleKeys = new Set();
  let rows = 0;
  for (const line of fs.readFileSync(rowsPath, "utf8").split(/\n/)) {
    if (!line) continue;
    rows += 1;
    const row = JSON.parse(line);
    if (!row.key || !row.hand || !row.discard || !row.role) throw new Error(`Invalid row ${rows} in ${rowsPath}`);
    if (rowKeys.has(row.key)) throw new Error(`Duplicate row key in ${rowsPath}: ${row.key}`);
    rowKeys.add(row.key);
    handRoleKeys.add(`${row.hand}:${row.role}`);
  }
  const expectedCoverage = coverageForRows(expectedSourceRows);
  const validation = {
    rows,
    expectedRows,
    uniqueRowKeys: rowKeys.size,
    uniqueHandRoleKeys: handRoleKeys.size,
    expectedUniqueHandRoleKeys: expectedCoverage.uniqueHandRoleKeys,
  };
  if (rows !== expectedRows) throw new Error(`Expected ${expectedRows} rows in ${rowsPath}, found ${rows}`);
  if (rows === expectedSourceRows.length && handRoleKeys.size !== expectedCoverage.uniqueHandRoleKeys) {
    throw new Error(
      `Expected ${expectedCoverage.uniqueHandRoleKeys} unique hand/role keys in ${rowsPath}, found ${handRoleKeys.size}.`,
    );
  }
  return validation;
}

function coverageForRows(rows) {
  const handRoleKeys = new Set();
  for (const row of rows) handRoleKeys.add(`${row.hand.join("")}:${row.role}`);
  return { uniqueHandRoleKeys: handRoleKeys.size };
}

function countJsonlRows(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, "utf8").split(/\n/).filter(Boolean).length;
}

function expectedCompletionAt(updatedAt, estimatedRemainingSeconds) {
  if (!Number.isFinite(estimatedRemainingSeconds)) return null;
  return new Date(Date.parse(updatedAt) + estimatedRemainingSeconds * 1000).toISOString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
