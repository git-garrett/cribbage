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
    scoreFor: 0,
    scoreAgainst: 0,
    margin: 0,
  };
}

function addStats(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key];
}

function summarize(stats) {
  return {
    games: stats.games,
    wins: stats.wins,
    losses: stats.losses,
    winPct: stats.games ? stats.wins / stats.games : 0,
    avgScore: stats.games ? stats.scoreFor / stats.games : 0,
    avgOpponentScore: stats.games ? stats.scoreAgainst / stats.games : 0,
    avgMargin: stats.games ? stats.margin / stats.games : 0,
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

function resultFromScores(winner, loserScore) {
  if (loserScore <= 60) return "double-skunk";
  if (loserScore <= 90) return "skunk";
  return "regular";
}

function record(stats, won, ownScore, opponentScore) {
  stats.games += 1;
  stats.scoreFor += ownScore;
  stats.scoreAgainst += opponentScore;
  stats.margin += ownScore - opponentScore;
  if (won) stats.wins += 1;
  else stats.losses += 1;
}

function simulate(leftEngine, rightEngine, gameCount) {
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
    resultFromScores(winner, finalScores[loser]);
    record(leftStats, winner === "human", finalScores.human, finalScores.ai);
    record(rightStats, winner === "ai", finalScores.ai, finalScores.human);
  }
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
    const result = simulate(workerData.leftEngine, workerData.rightEngine, workerData.gameCount);
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

function runWorker(leftEngine, rightEngine, gameCount, workerIndex, oldMb) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { leftEngine, rightEngine, gameCount, workerIndex },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "error") {
        settled = true;
        reject(new Error(message.error));
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

  const writeStatus = () => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const gamesPerSecond = elapsedSeconds > 0 ? Math.max(0, currentCompletedGames) / elapsedSeconds : 0;
    const remainingGames = Math.max(0, job.games - currentCompletedGames);
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
      completedGames: currentCompletedGames,
      totalGames: job.games,
      progressPercent: job.games ? (currentCompletedGames / job.games) * 100 : 100,
      gamesPerSecond,
      estimatedRemainingSeconds: gamesPerSecond > 0 ? remainingGames / gamesPerSecond : null,
    });
  };

  writeStatus();
  await new Promise((resolve, reject) => {
    const launch = () => {
      while (active < job.workers && next < pending.length) {
        const batch = pending[next];
        next += 1;
        active += 1;
        runWorker(job.leftEngine, job.rightEngine, batch.gameCount, batch.index, job.oldMb)
          .then((result) => {
            const batchResult = {
              batchIndex: batch.index,
              ...result,
              completedAt: new Date().toISOString(),
            };
            writeJson(batch.batchPath, batchResult);
            completed.push(batchResult);
            currentCompletedGames += batch.gameCount;
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
