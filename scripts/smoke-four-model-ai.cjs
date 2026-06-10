const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const os = require("node:os");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");

const currentModels = [
  "schell_table-peg_table-4.0",
  "ras_table-peg_table-4.0",
  "schell_table-peg-3.0",
  "schell_table-2.0",
];

const legacyModels = [
  "schell-table-peg_table-1.2",
  "ras-table-peg_table-1.2",
  "schell-table-peg-1.1",
  "schell-table-1.0",
];

const labels = {
  "schell_table-peg_table-4.0": "Schell Table Peg Table 4.0",
  "ras_table-peg_table-4.0": "Ras Table Peg Table 4.0",
  "schell_table-peg-3.0": "Schell Table Peg 3.0",
  "schell_table-2.0": "Schell Table 2.0",
  "schell-table-peg_table-1.2": "Schell Table Peg Table 1.2",
  "ras-table-peg_table-1.2": "Ras Table Peg Table 1.2",
  "schell-table-peg-1.1": "Schell Table Peg 1.1",
  "schell-table-1.0": "Schell Table 1.0",
};

for (const model of currentModels) labels[model] ??= model;
for (const model of legacyModels) labels[model] ??= model;

function buildMatchups(models) {
  const matchups = [];
  for (let left = 0; left < models.length; left += 1) {
    for (let right = left + 1; right < models.length; right += 1) {
      matchups.push([models[left], models[right]]);
    }
  }
  return matchups;
}

function modelsForOutDir(outDir) {
  const requested = process.env.AI_SMOKE_MODELS || "";
  if (requested.trim()) {
    return requested.split(",").map((model) => model.trim()).filter(Boolean);
  }
  try {
    const statusPath = path.join(outDir, "status.json");
    if (fs.existsSync(statusPath) && fs.readFileSync(statusPath, "utf8").includes("schell-table")) {
      return legacyModels;
    }
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).some((file) => file.includes("schell-table"))) {
      return legacyModels;
    }
  } catch {
    return currentModels;
  }
  return currentModels;
}

function emptyStats() {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    skunks: 0,
    skunked: 0,
    doubleSkunks: 0,
    doubleSkunked: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    margin: 0,
    peggingDealer: 0,
    peggingPone: 0,
    handDealer: 0,
    handPone: 0,
    crib: 0,
    opportunities: {
      peggingDealer: 0,
      peggingPone: 0,
      handDealer: 0,
      handPone: 0,
      crib: 0,
    },
  };
}

function addStats(target, source) {
  for (const key of [
    "games",
    "wins",
    "losses",
    "skunks",
    "skunked",
    "doubleSkunks",
    "doubleSkunked",
    "scoreFor",
    "scoreAgainst",
    "margin",
    "peggingDealer",
    "peggingPone",
    "handDealer",
    "handPone",
    "crib",
  ]) {
    target[key] += source[key] || 0;
  }
  for (const key of Object.keys(target.opportunities)) {
    target.opportunities[key] += source.opportunities?.[key] || 0;
  }
}

function scoreKey(category, role) {
  if (category === "crib") return "crib";
  return `${category}${role === "dealer" ? "Dealer" : "Pone"}`;
}

function summarize(stats) {
  const average = (total, count) => count ? total / count : 0;
  return {
    games: stats.games,
    wins: stats.wins,
    losses: stats.losses,
    winPct: average(stats.wins, stats.games),
    skunks: stats.skunks,
    skunked: stats.skunked,
    doubleSkunks: stats.doubleSkunks,
    doubleSkunked: stats.doubleSkunked,
    avgScore: average(stats.scoreFor, stats.games),
    avgOpponentScore: average(stats.scoreAgainst, stats.games),
    avgMargin: average(stats.margin, stats.games),
    avgPeggingDealer: average(stats.peggingDealer, stats.opportunities.peggingDealer),
    avgPeggingPone: average(stats.peggingPone, stats.opportunities.peggingPone),
    avgHandDealer: average(stats.handDealer, stats.opportunities.handDealer),
    avgHandPone: average(stats.handPone, stats.opportunities.handPone),
    avgCrib: average(stats.crib, stats.opportunities.crib),
  };
}

function loadEngine() {
  const source = fs.readFileSync(enginePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      resolveJsonModule: true,
      esModuleInterop: true,
    },
  }).outputText;
  const engineModule = new Module(enginePath, module);
  engineModule.filename = enginePath;
  engineModule.paths = Module._nodeModulePaths(path.dirname(enginePath));
  engineModule._compile(compiled, enginePath);
  return engineModule.exports;
}

function resultFromScores(_winner, loserScore) {
  if (loserScore <= 60) return "double-skunk";
  if (loserScore <= 90) return "skunk";
  return "regular";
}

function recordOutcome(stats, won, ownScore, opponentScore, result) {
  stats.games += 1;
  stats.scoreFor += ownScore;
  stats.scoreAgainst += opponentScore;
  stats.margin += ownScore - opponentScore;
  if (won) {
    stats.wins += 1;
    if (result === "skunk" || result === "double-skunk") stats.skunks += 1;
    if (result === "double-skunk") stats.doubleSkunks += 1;
  } else {
    stats.losses += 1;
    if (result === "skunk" || result === "double-skunk") stats.skunked += 1;
    if (result === "double-skunk") stats.doubleSkunked += 1;
  }
}

function recordScores(stats, playerKey, events) {
  const hands = {
    peggingDealer: new Set(),
    peggingPone: new Set(),
    handDealer: new Set(),
    handPone: new Set(),
    crib: new Set(),
  };
  for (const event of events) {
    if (event.type !== "score" || event.player !== playerKey) continue;
    const categoryKey = scoreKey(event.category, event.role);
    stats[categoryKey] += event.points;
    hands[categoryKey].add(`${event.gameId}:${event.handNumber}`);
  }
  for (const categoryKey of Object.keys(hands)) {
    stats.opportunities[categoryKey] += hands[categoryKey].size;
  }
}

function baselineModel(stats) {
  return {
    games: stats.games,
    aiTotals: {
      wins: stats.wins,
      losses: stats.losses,
      skunks: stats.skunks,
      skunked: stats.skunked,
      doubleSkunks: stats.doubleSkunks,
      doubleSkunked: stats.doubleSkunked,
      peggingDealer: stats.peggingDealer,
      peggingPone: stats.peggingPone,
      handDealer: stats.handDealer,
      handPone: stats.handPone,
      crib: stats.crib,
    },
    opportunities: stats.opportunities,
    averages: {
      peggingDealer: stats.opportunities.peggingDealer ? stats.peggingDealer / stats.opportunities.peggingDealer : 0,
      peggingPone: stats.opportunities.peggingPone ? stats.peggingPone / stats.opportunities.peggingPone : 0,
      handDealer: stats.opportunities.handDealer ? stats.handDealer / stats.opportunities.handDealer : 0,
      handPone: stats.opportunities.handPone ? stats.handPone / stats.opportunities.handPone : 0,
      crib: stats.opportunities.crib ? stats.crib / stats.opportunities.crib : 0,
    },
    scoreAverages: {
      avgScore: stats.games ? stats.scoreFor / stats.games : 0,
      avgOpponentScore: stats.games ? stats.scoreAgainst / stats.games : 0,
      avgMargin: stats.games ? stats.margin / stats.games : 0,
    },
  };
}

function simulate(leftEngine, rightEngine, gameCount, progressEvery = 0) {
  const { CribbageGame } = loadEngine();
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  for (let index = 0; index < gameCount; index += 1) {
    const game = new CribbageGame(rightEngine, leftEngine);
    game.autoPlayToEnd();
    const events = game.state().analyticsEvents;
    const end = [...events].reverse().find((event) => event.type === "game" && event.action === "end");
    const finalScores = end?.finalScores || { human: game.human.score, ai: game.ai.score };
    const winner = end?.winner || (finalScores.human >= finalScores.ai ? "human" : "ai");
    const loser = winner === "human" ? "ai" : "human";
    const result = end?.result || resultFromScores(winner, finalScores[loser]);
    recordOutcome(leftStats, winner === "human", finalScores.human, finalScores.ai, result);
    recordOutcome(rightStats, winner === "ai", finalScores.ai, finalScores.human, result);
    recordScores(leftStats, "human", events);
    recordScores(rightStats, "ai", events);
    if (progressEvery > 0 && (index + 1) % progressEvery === 0) {
      parentPort?.postMessage({
        type: "progress",
        workerIndex: workerData?.workerIndex,
        completed: index + 1,
        total: gameCount,
      });
    }
  }
  parentPort?.postMessage({
    type: "progress",
    workerIndex: workerData?.workerIndex,
    completed: gameCount,
    total: gameCount,
  });
  return {
    leftStats,
    rightStats,
    memory: process.memoryUsage(),
  };
}

function chunkSizes(total, count) {
  const chunkCount = Math.min(total, Math.max(1, count));
  const base = Math.floor(total / chunkCount);
  let extra = total % chunkCount;
  return Array.from({ length: chunkCount }, () => {
    const size = base + (extra > 0 ? 1 : 0);
    extra -= 1;
    return size;
  });
}

if (!isMainThread) {
  try {
    const startedAt = Date.now();
    const result = simulate(
      workerData.leftEngine,
      workerData.rightEngine,
      workerData.gameCount,
      workerData.progressEvery,
    );
    parentPort.postMessage({
      type: "done",
      ...result,
      elapsedMs: Date.now() - startedAt,
      gameCount: workerData.gameCount,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  }
  return;
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(",").map((item) => Number.parseInt(item, 10)).filter((item) => Number.isFinite(item) && item > 0);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function matchupId(left, right) {
  return `${safeName(left)}__vs__${safeName(right)}`;
}

function configId(workers, games, oldMb) {
  return `w${workers}-g${games}-old${oldMb}`;
}

function batchId(index) {
  return `batch-${String(index).padStart(6, "0")}`;
}

function currentCommand() {
  return [process.execPath, ...process.argv.slice(1)].join(" ");
}

function gitCommit() {
  try {
    return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function runWorker(leftEngine, rightEngine, gameCount, workerIndex, oldMb, progressEvery = 0, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { leftEngine, rightEngine, gameCount, workerIndex, progressEvery },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "error") {
        settled = true;
        reject(new Error(message.error));
        return;
      }
      if (message.type === "progress") {
        onProgress(message);
        return;
      }
      if (message.type === "done") {
        settled = true;
        resolve(message);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  });
}

async function runOne({ leftEngine, rightEngine, workers, games, oldMb }) {
  const sizes = chunkSizes(games, workers);
  const startedAt = Date.now();
  const results = await Promise.all(sizes.map((size, index) =>
    runWorker(leftEngine, rightEngine, size, index, oldMb)
  ));
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  let maxHeapUsedMb = 0;
  let totalHeapUsedMb = 0;
  let maxRssMb = 0;
  for (const result of results) {
    addStats(leftStats, result.leftStats);
    addStats(rightStats, result.rightStats);
    const heapMb = result.memory.heapUsed / 1024 / 1024;
    const rssMb = result.memory.rss / 1024 / 1024;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapMb);
    totalHeapUsedMb += heapMb;
    maxRssMb = Math.max(maxRssMb, rssMb);
  }
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return {
    leftEngine,
    rightEngine,
    matchup: `${labels[leftEngine]} vs ${labels[rightEngine]}`,
    workers,
    games,
    oldMb,
    elapsedSeconds,
    gamesPerSecond: games / elapsedSeconds,
    left: summarize(leftStats),
    right: summarize(rightStats),
    maxWorkerHeapUsedMb: maxHeapUsedMb,
    totalWorkerHeapUsedMb: totalHeapUsedMb,
    maxWorkerRssMb: maxRssMb,
    workerElapsedSeconds: results.map((result) => result.elapsedMs / 1000),
    workerGames: results.map((result) => result.gameCount),
  };
}

function makeBatches(totalGames, batchGames) {
  const batches = [];
  let remaining = totalGames;
  let index = 0;
  while (remaining > 0) {
    const gameCount = Math.min(batchGames, remaining);
    batches.push({ index, gameCount });
    remaining -= gameCount;
    index += 1;
  }
  return batches;
}

function aggregateBatchResults({ leftEngine, rightEngine, workers, games, oldMb, startedAt, batchResults }) {
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  let maxHeapUsedMb = 0;
  let totalHeapUsedMb = 0;
  let maxRssMb = 0;
  for (const result of batchResults) {
    addStats(leftStats, result.leftStats);
    addStats(rightStats, result.rightStats);
    const heapMb = result.memory.heapUsed / 1024 / 1024;
    const rssMb = result.memory.rss / 1024 / 1024;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapMb);
    totalHeapUsedMb += heapMb;
    maxRssMb = Math.max(maxRssMb, rssMb);
  }
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return {
    leftEngine,
    rightEngine,
    matchup: `${labels[leftEngine]} vs ${labels[rightEngine]}`,
    workers,
    games,
    oldMb,
    elapsedSeconds,
    gamesPerSecond: games / elapsedSeconds,
    left: summarize(leftStats),
    right: summarize(rightStats),
    leftModel: baselineModel(leftStats),
    rightModel: baselineModel(rightStats),
    maxWorkerHeapUsedMb: maxHeapUsedMb,
    totalWorkerHeapUsedMb: totalHeapUsedMb,
    maxWorkerRssMb: maxRssMb,
    workerElapsedSeconds: batchResults.map((result) => result.elapsedMs / 1000),
    workerGames: batchResults.map((result) => result.gameCount),
    batchesCompleted: batchResults.length,
  };
}

async function runOneCheckpointed({ job, id, outDir, resultPath, statusPath, jobIndex, jobCount, batchGames }) {
  const startedAt = Date.now();
  const batches = makeBatches(job.games, batchGames);
  const batchDir = path.join(outDir, `${id}.batches`);
  fs.mkdirSync(batchDir, { recursive: true });

  const completed = [];
  const pending = [];
  for (const batch of batches) {
    const batchPath = path.join(batchDir, `${batchId(batch.index)}.json`);
    if (fs.existsSync(batchPath)) {
      completed.push(readJson(batchPath));
    } else {
      pending.push({ ...batch, batchPath });
    }
  }

  let next = 0;
  let active = 0;
  let currentCompletedGames = completed.reduce((sum, item) => sum + item.gameCount, 0);
  const activeBatchProgress = new Map();

  const writeStatus = () => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const activeCompletedGames = Array.from(activeBatchProgress.values()).reduce((sum, value) => sum + value, 0);
    const visibleCompletedGames = Math.min(job.games, currentCompletedGames + activeCompletedGames);
    const gamesPerSecond = elapsedSeconds > 0 ? Math.max(0, visibleCompletedGames) / elapsedSeconds : 0;
    const remainingGames = Math.max(0, job.games - visibleCompletedGames);
    writeJson(statusPath, {
      status: "running",
      updatedAt: new Date().toISOString(),
      command: currentCommand(),
      gitCommit: gitCommit(),
      outDir,
      jobIndex,
      jobCount,
      currentJob: job,
      batchGames,
      totalBatches: batches.length,
      completedBatches: completed.length,
      activeBatches: active,
      savedGames: currentCompletedGames,
      activeCompletedGames,
      completedGames: visibleCompletedGames,
      totalGames: job.games,
      progressPercent: job.games ? (visibleCompletedGames / job.games) * 100 : 100,
      gamesPerSecond,
      estimatedRemainingSeconds: gamesPerSecond > 0 ? remainingGames / gamesPerSecond : null,
    });
  };

  writeStatus();
  const heartbeat = setInterval(writeStatus, 5000);
  await new Promise((resolve, reject) => {
    const launch = () => {
      while (active < job.workers && next < pending.length) {
        const batch = pending[next];
        next += 1;
        active += 1;
        const progressEvery = Math.max(1, Number.parseInt(process.env.AI_SMOKE_PROGRESS_EVERY || "10", 10));
        runWorker(
          job.leftEngine,
          job.rightEngine,
          batch.gameCount,
          batch.index,
          job.oldMb,
          progressEvery,
          (message) => {
            activeBatchProgress.set(batch.index, Math.min(batch.gameCount, message.completed));
            writeStatus();
          },
        )
          .then((result) => {
            const batchResult = {
              batchIndex: batch.index,
              ...result,
              completedAt: new Date().toISOString(),
            };
            writeJson(batch.batchPath, batchResult);
            completed.push(batchResult);
            currentCompletedGames += batch.gameCount;
            activeBatchProgress.delete(batch.index);
            process.stdout.write(`BATCH ${labels[job.leftEngine]} vs ${labels[job.rightEngine]} ${currentCompletedGames}/${job.games} workers=${job.workers} oldMb=${job.oldMb}\n`);
            active -= 1;
            writeStatus();
            launch();
          })
          .catch(reject);
      }
      if (active === 0 && next >= pending.length) resolve();
    };
    launch();
  });
  clearInterval(heartbeat);

  completed.sort((a, b) => a.batchIndex - b.batchIndex);
  const result = aggregateBatchResults({
    ...job,
    startedAt,
    batchResults: completed,
  });
  writeJson(resultPath, result);
  return result;
}

async function main() {
  const outDir = process.argv[2] || path.join(root, "benchmarks", "ai-smoke", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const games = Number.parseInt(process.argv[3] || "12", 10);
  const workerCounts = parseList(process.argv[4], [1, 2]);
  const oldMbs = parseList(process.argv[5], [384, 768]);
  const batchGames = Number.parseInt(process.argv[6] || "25", 10);
  const statusPath = path.join(outDir, "status.json");
  const summaryPath = path.join(outDir, "summary.json");
  fs.mkdirSync(outDir, { recursive: true });
  const models = modelsForOutDir(outDir);
  const matchups = buildMatchups(models);

  const jobs = [];
  for (const [leftEngine, rightEngine] of matchups) {
    for (const workers of workerCounts) {
      for (const oldMb of oldMbs) {
        jobs.push({ leftEngine, rightEngine, workers, oldMb, games });
      }
    }
  }

  const completed = [];
  const failed = [];
  for (const [index, job] of jobs.entries()) {
    const id = `${matchupId(job.leftEngine, job.rightEngine)}__${configId(job.workers, job.games, job.oldMb)}`;
    const resultPath = path.join(outDir, `${id}.json`);
    if (fs.existsSync(resultPath)) {
      completed.push(readJson(resultPath));
      continue;
    }
    writeJson(statusPath, {
      status: "running",
      updatedAt: new Date().toISOString(),
      command: currentCommand(),
      gitCommit: gitCommit(),
      outDir,
      jobIndex: index + 1,
      jobCount: jobs.length,
      currentJob: job,
      completedJobs: completed.length,
      failedJobs: failed.length,
    });
    try {
      const result = await runOneCheckpointed({
        job,
        id,
        outDir,
        resultPath,
        statusPath,
        jobIndex: index + 1,
        jobCount: jobs.length,
        batchGames,
      });
      writeJson(resultPath, result);
      completed.push(result);
      process.stdout.write(`DONE ${result.matchup} workers=${job.workers} oldMb=${job.oldMb} gps=${result.gamesPerSecond.toFixed(3)} heap=${result.totalWorkerHeapUsedMb.toFixed(0)}MB\n`);
    } catch (error) {
      const failure = {
        ...job,
        error: error instanceof Error ? error.stack || error.message : String(error),
        at: new Date().toISOString(),
      };
      failed.push(failure);
      writeJson(path.join(outDir, `${id}.failed.json`), failure);
      process.stdout.write(`FAILED ${labels[job.leftEngine]} vs ${labels[job.rightEngine]} workers=${job.workers} oldMb=${job.oldMb}\n`);
    }
  }

  const bestByMatchup = {};
  for (const result of completed) {
    const id = matchupId(result.leftEngine, result.rightEngine);
    const current = bestByMatchup[id];
    if (!current || result.gamesPerSecond > current.gamesPerSecond) bestByMatchup[id] = result;
  }
  const bestModels = {};
  for (const result of Object.values(bestByMatchup)) {
    bestModels[result.leftEngine] = bestModels[result.leftEngine] || emptyStats();
    bestModels[result.rightEngine] = bestModels[result.rightEngine] || emptyStats();
    const leftStats = {
      games: result.leftModel.games,
      wins: result.leftModel.aiTotals.wins,
      losses: result.leftModel.aiTotals.losses,
      skunks: result.leftModel.aiTotals.skunks,
      skunked: result.leftModel.aiTotals.skunked,
      doubleSkunks: result.leftModel.aiTotals.doubleSkunks,
      doubleSkunked: result.leftModel.aiTotals.doubleSkunked,
      scoreFor: result.leftModel.scoreAverages.avgScore * result.leftModel.games,
      scoreAgainst: result.leftModel.scoreAverages.avgOpponentScore * result.leftModel.games,
      margin: result.leftModel.scoreAverages.avgMargin * result.leftModel.games,
      peggingDealer: result.leftModel.aiTotals.peggingDealer,
      peggingPone: result.leftModel.aiTotals.peggingPone,
      handDealer: result.leftModel.aiTotals.handDealer,
      handPone: result.leftModel.aiTotals.handPone,
      crib: result.leftModel.aiTotals.crib,
      opportunities: result.leftModel.opportunities,
    };
    const rightStats = {
      games: result.rightModel.games,
      wins: result.rightModel.aiTotals.wins,
      losses: result.rightModel.aiTotals.losses,
      skunks: result.rightModel.aiTotals.skunks,
      skunked: result.rightModel.aiTotals.skunked,
      doubleSkunks: result.rightModel.aiTotals.doubleSkunks,
      doubleSkunked: result.rightModel.aiTotals.doubleSkunked,
      scoreFor: result.rightModel.scoreAverages.avgScore * result.rightModel.games,
      scoreAgainst: result.rightModel.scoreAverages.avgOpponentScore * result.rightModel.games,
      margin: result.rightModel.scoreAverages.avgMargin * result.rightModel.games,
      peggingDealer: result.rightModel.aiTotals.peggingDealer,
      peggingPone: result.rightModel.aiTotals.peggingPone,
      handDealer: result.rightModel.aiTotals.handDealer,
      handPone: result.rightModel.aiTotals.handPone,
      crib: result.rightModel.aiTotals.crib,
      opportunities: result.rightModel.opportunities,
    };
    addStats(bestModels[result.leftEngine], leftStats);
    addStats(bestModels[result.rightEngine], rightStats);
  }
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outDir,
    gamesPerJob: games,
    batchGames,
    workerCounts,
    oldMbs,
    completedJobs: completed.length,
    failedJobs: failed.length,
    bestByMatchup,
    bestModels: Object.fromEntries(Object.entries(bestModels).map(([engine, stats]) => [engine, baselineModel(stats)])),
    completed,
    failed,
  };
  writeJson(summaryPath, summary);
  writeJson(statusPath, {
    status: "complete",
    updatedAt: new Date().toISOString(),
    outDir,
    summaryPath,
    completedJobs: completed.length,
    failedJobs: failed.length,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
