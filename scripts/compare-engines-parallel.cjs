const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const os = require("node:os");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");

const engines = {
  expert: "schell_table-peg_table-4.0",
  original: "original-1.1",
  originalPeg: "original_exhaustive_peg-1.2",
  ras: "ras_table-2.0",
  rasPeg: "ras_table-peg-3.0",
  rasPegTable: "ras_table-peg_table-4.0",
  schell: "schell_table-2.0",
  schellPeg: "schell_table-peg-3.0",
  schellPegTable: "schell_table-peg_table-4.0",
};

const labels = {
  [engines.original]: "Original 1.1",
  [engines.originalPeg]: "Original Exhaustive Peg 1.2",
  [engines.ras]: "Ras Table 2.0",
  [engines.rasPeg]: "Ras Table Peg 3.0",
  [engines.rasPegTable]: "Ras Table Peg Table 4.0",
  [engines.schell]: "Schell Table 2.0",
  [engines.schellPeg]: "Schell Table Peg 3.0",
  [engines.schellPegTable]: "Schell Table Peg Table 4.0",
};

const matchupModes = {
  "three-way": [
    [engines.ras, engines.expert],
    [engines.ras, engines.schell],
    [engines.schell, engines.expert],
  ],
  "three-way-expert-1.1": [
    [engines.ras, engines.original],
    [engines.ras, engines.schell],
    [engines.schell, engines.original],
  ],
  "peg-variants": [
    [engines.schellPeg, engines.expert],
    [engines.ras, engines.rasPeg],
    [engines.original, engines.originalPeg],
    [engines.schell, engines.schellPeg],
  ],
  "ras-v-expert-1.1": [[engines.ras, engines.original]],
  "schell-v-expert-1.1": [[engines.schell, engines.original]],
  "ras-v-schell": [[engines.ras, engines.schell]],
};

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
    target[key] += source[key];
  }
  for (const key of Object.keys(target.opportunities)) {
    target.opportunities[key] += source.opportunities[key];
  }
}

function scoreKey(category, role) {
  if (category === "crib") return "crib";
  return `${category}${role === "dealer" ? "Dealer" : "Pone"}`;
}

function resultFromScores(winner, loserScore) {
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

function recordScores(stats, key, events) {
  const hands = {
    peggingDealer: new Set(),
    peggingPone: new Set(),
    handDealer: new Set(),
    handPone: new Set(),
    crib: new Set(),
  };
  for (const event of events) {
    if (event.type !== "score" || event.player !== key) continue;
    const categoryKey = scoreKey(event.category, event.role);
    stats[categoryKey] += event.points;
    hands[categoryKey].add(`${event.gameId}:${event.handNumber}`);
  }
  for (const categoryKey of Object.keys(hands)) {
    stats.opportunities[categoryKey] += hands[categoryKey].size;
  }
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
  };
}

function loadEngine() {
  const source = fs.readFileSync(enginePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const engineModule = new Module(enginePath, module);
  engineModule.filename = enginePath;
  engineModule.paths = Module._nodeModulePaths(path.dirname(enginePath));
  engineModule._compile(compiled, enginePath);
  return engineModule.exports;
}

function simulateChunk(leftEngine, rightEngine, gameCount, progressEvery) {
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
        workerIndex: workerData.workerIndex,
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
  return { leftStats, rightStats };
}

function chunkSizes(total, chunks) {
  const result = [];
  const chunkCount = Math.min(total, Math.max(1, chunks));
  const base = Math.floor(total / chunkCount);
  let extra = total % chunkCount;
  for (let i = 0; i < chunkCount; i += 1) {
    result.push(base + (extra > 0 ? 1 : 0));
    extra -= 1;
  }
  return result;
}

if (!isMainThread) {
  try {
    const startedAt = Date.now();
    const result = simulateChunk(
      workerData.leftEngine,
      workerData.rightEngine,
      workerData.gameCount,
      workerData.progressEvery,
    );
    parentPort.postMessage({
      type: "done",
      ...result,
      gameCount: workerData.gameCount,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  }
  return;
}

async function runWorker(leftEngine, rightEngine, gameCount, workerIndex, progressEvery, onProgress) {
  return new Promise((resolve, reject) => {
    const maxOldGenerationSizeMb = Number.parseInt(process.env.BENCH_WORKER_OLD_MB || "0", 10);
    const maxYoungGenerationSizeMb = Number.parseInt(process.env.BENCH_WORKER_YOUNG_MB || "0", 10);
    const resourceLimits = {};
    if (maxOldGenerationSizeMb > 0) resourceLimits.maxOldGenerationSizeMb = maxOldGenerationSizeMb;
    if (maxYoungGenerationSizeMb > 0) resourceLimits.maxYoungGenerationSizeMb = maxYoungGenerationSizeMb;
    const worker = new Worker(__filename, {
      workerData: { leftEngine, rightEngine, gameCount, workerIndex, progressEvery },
      resourceLimits,
    });
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "progress") {
        onProgress(message);
        return;
      }
      if (message.error) {
        settled = true;
        reject(new Error(message.error));
      } else if (message.type === "done") {
        settled = true;
        resolve(message);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) reject(new Error(`Worker exited with code ${code}.`));
    });
  });
}

async function runMatchup(leftEngine, rightEngine, gamesPerMatchup, workerCount, onProgress) {
  const sizes = chunkSizes(gamesPerMatchup, workerCount);
  const startedAt = Date.now();
  const workerCompleted = sizes.map(() => 0);
  let nextProgress = 25;
  const results = await Promise.all(sizes.map((size, workerIndex) =>
    runWorker(leftEngine, rightEngine, size, workerIndex, 25, (message) => {
      workerCompleted[message.workerIndex] = message.completed;
      const completed = workerCompleted.reduce((sum, value) => sum + value, 0);
      while (completed >= nextProgress || completed === gamesPerMatchup) {
        onProgress({ completed, total: gamesPerMatchup });
        if (completed === gamesPerMatchup) break;
        nextProgress += 25;
      }
    })
  ));
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  for (const result of results) {
    addStats(leftStats, result.leftStats);
    addStats(rightStats, result.rightStats);
  }
  return {
    leftStats,
    rightStats,
    workerGames: results.map((result) => result.gameCount),
    workerElapsedMs: results.map((result) => result.elapsedMs),
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  const gamesPerMatchup = Number.parseInt(process.argv[2] || "300", 10);
  const mode = process.argv[3] || "three-way";
  const outputPath = process.argv[4] || "";
  const defaultWorkers = Math.min(6, os.availableParallelism?.() || os.cpus().length);
  const requestedWorkers = Number.parseInt(process.argv[5] || String(defaultWorkers), 10);
  const workerCount = Math.max(1, requestedWorkers);

  if (!Number.isInteger(gamesPerMatchup) || gamesPerMatchup <= 0) {
    throw new Error("Game count must be a positive integer.");
  }
  const matchups = matchupModes[mode];
  if (!matchups) {
    throw new Error(`Mode must be one of: ${Object.keys(matchupModes).join(", ")}.`);
  }

  const totalStartedAt = Date.now();
  const totals = Object.fromEntries(Object.values(engines).map((engine) => [engine, emptyStats()]));
  const matchupResults = [];
  const performance = [];

  for (const [leftEngine, rightEngine] of matchups) {
    const matchupLabel = `${labels[leftEngine]} vs ${labels[rightEngine]}`;
    const result = await runMatchup(leftEngine, rightEngine, gamesPerMatchup, workerCount, (progress) => {
      process.stdout.write(`PROGRESS ${JSON.stringify({
        matchup: matchupLabel,
        completed: progress.completed,
        total: progress.total,
        percent: progress.total ? progress.completed / progress.total : 0,
      })}\n`);
    });
    addStats(totals[leftEngine], result.leftStats);
    addStats(totals[rightEngine], result.rightStats);
    matchupResults.push({
      matchup: matchupLabel,
      [leftEngine]: summarize(result.leftStats),
      [rightEngine]: summarize(result.rightStats),
    });
    performance.push({
      matchup: matchupLabel,
      games: gamesPerMatchup,
      elapsedSeconds: result.elapsedMs / 1000,
      gamesPerSecond: gamesPerMatchup / (result.elapsedMs / 1000),
      workerGames: result.workerGames,
      workerElapsedSeconds: result.workerElapsedMs.map((ms) => ms / 1000),
    });
    process.stdout.write(
      `${labels[leftEngine]} vs ${labels[rightEngine]}: ${gamesPerMatchup} games in ${(result.elapsedMs / 1000).toFixed(2)}s\n`,
    );
  }

  const elapsedSeconds = (Date.now() - totalStartedAt) / 1000;
  const physicalGames = gamesPerMatchup * matchups.length;
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: `${mode}-parallel`,
    physicalGames,
    gamesPerMatchup,
    workerCount,
    elapsedSeconds,
    gamesPerSecond: physicalGames / elapsedSeconds,
    matchups: matchupResults,
    totals: Object.fromEntries(Object.entries(totals).map(([engine, stats]) => [
      engine,
      { label: labels[engine], ...summarize(stats) },
    ])),
    models: Object.fromEntries(Object.entries(totals)
      .filter(([, stats]) => stats.games > 0)
      .map(([engine, stats]) => [engine, baselineModel(stats)])),
    performance,
  };

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Wrote ${outputPath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
