const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const os = require("node:os");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const ts = require("typescript");
const { ensureCompactSchema, insertCompactGameRecords } = require("./compact-game-storage.cjs");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");
const holdTableDefaultPath = path.join(root, "benchmarks", "ai-inference", "pegging-hold-rank-probabilities.cumulative.json");
const gameDbDefaultPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const holdTableEnabled = process.env.AI_SMOKE_HOLD_TABLE !== "0";
const holdTablePath = path.resolve(root, process.env.AI_SMOKE_HOLD_TABLE_PATH || holdTableDefaultPath);
const gameDbEnabled = process.env.AI_SMOKE_GAME_DB !== "0";
const gameDbPath = path.resolve(root, process.env.AI_SMOKE_GAME_DB_PATH || gameDbDefaultPath);
const scoreComponentsEnabled = process.env.AI_SMOKE_SCORE_COMPONENTS === "1";
const model13TreeCacheLimit = Number.parseInt(process.env.AI_SMOKE_MODEL13_TREE_CACHE_LIMIT || "10000", 10);
const streamGamesEvery = Math.max(0, Number.parseInt(process.env.AI_SMOKE_STREAM_GAMES_EVERY || "0", 10) || 0);
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const rankIndex = new Map(ranks.map((rank, index) => [rank, index]));

const currentModels = [
  "schell_table-peg_table-14.6",
  "schell_table-peg_table-14.5",
  "schell_table-peg_table-14.4.1",
  "schell_table-peg_table-14.4",
  "schell_table-peg_table-14.3",
  "schell_table-peg_table-14.2",
  "schell_table-peg_table-14.1",
  "schell_table-peg_table-14.0",
  "schell_table-peg_table-13.0",
  "schell_table-peg_table-12.0",
  "schell_table-peg_table-11.1",
  "schell_table-peg_table-11.0",
  "schell_table-peg_table-10.0",
  "schell_table-peg_table-9.0",
  "schell_table-peg_table-8.0",
  "schell_table-peg_table-7.0",
  "schell_table-peg_table-6.0",
  "schell_table-peg_table-5.0",
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
  "schell_table-peg_table-4.0": "Schell Table + Peg Table 4.0",
  "schell_table-peg_table-5.0": "Schell Table + Peg Table 5.0",
  "schell_table-peg_table-7.0": "Schell Table + Peg Table 7.0",
  "schell_table-peg_table-8.0": "Schell Table + Peg Table 8.0",
  "schell_table-peg_table-9.0": "Schell Table + Peg Table 9.0",
  "schell_table-peg_table-10.0": "Schell Table + Peg Table 10.0",
  "schell_table-peg_table-11.0": "Schell Table + Peg Table 11.0",
  "schell_table-peg_table-11.1": "Schell Table + Peg Table 11.1",
  "schell_table-peg_table-12.0": "Schell Table + Peg Table 12.0",
  "schell_table-peg_table-13.0": "Schell Table + Peg Table 13.0",
  "schell_table-peg_table-14.0": "Schell Table + Peg Table 14.0",
  "schell_table-peg_table-14.1": "Schell Table + Peg Table 14.1",
  "schell_table-peg_table-14.2": "Schell Table + Peg Table 14.2",
  "schell_table-peg_table-14.3": "Schell Table + Peg Table 14.3",
  "schell_table-peg_table-14.4": "Schell Table + Peg Table 14.4",
  "schell_table-peg_table-14.4.1": "Schell Table + Peg Table 14.4.1",
  "schell_table-peg_table-14.5": "Schell Table + Peg Table 14.5",
  "schell_table-peg_table-14.6": "Schell Table + Peg Table 14.6",
  "schell_table-peg_table-6.0": "Schell Table + Peg Table 6.0",
  "ras_table-peg_table-4.0": "Ras Table + Peg Table 4.0",
  "schell_table-peg-3.0": "Schell Table + Peg 3.0",
  "schell_table-2.0": "Schell Table 2.0",
  "schell-table-peg_table-1.2": "Schell Table + Peg Table 1.2",
  "ras-table-peg_table-1.2": "Ras Table + Peg Table 1.2",
  "schell-table-peg-1.1": "Schell Table + Peg 1.1",
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
  globalThis.__CRIBBAGE_LOG_SCORE_COMPONENTS = scoreComponentsEnabled;
  globalThis.__CRIBBAGE_MODEL13_TREE_CACHE_LIMIT = Number.isFinite(model13TreeCacheLimit)
    ? model13TreeCacheLimit
    : 10000;
  installLocalAssetFetch();
  const source = patchEngineAssetImports(fs.readFileSync(enginePath, "utf8"));
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

function patchEngineAssetImports(source) {
  return source.replace(
    /import\s+peggingPairwise12Url\s+from\s+"\.\/models\/schell_table-peg_table-12\.0\/pegging-outcome-pairwise\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");
      return `const peggingPairwise12Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+model13HoldUrl\s+from\s+"\.\/models\/schell_table-peg_table-13\.0\/pegging-remaining-hand-distribution\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-13.0", "pegging-remaining-hand-distribution.bin");
      return `const model13HoldUrl = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+model13LeadUrl\s+from\s+"\.\/models\/schell_table-peg_table-13\.0\/pone-lead-frequency\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-13.0", "pone-lead-frequency.bin");
      return `const model13LeadUrl = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+peggingPairwise14Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.0\/pegging-outcome-tripolicy-aligned\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.0", "pegging-outcome-tripolicy-aligned.bin");
      return `const peggingPairwise14Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+cribTripolicy14Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.0\/crib-score-histogram-tripolicy-by-discard-cut\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.0", "crib-score-histogram-tripolicy-by-discard-cut.bin");
      return `const cribTripolicy14Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+peggingBounded144Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.4\/pegging-outcome-bounded-overrides\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.4", "pegging-outcome-bounded-overrides.bin");
      return `const peggingBounded144Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+cribBounded144Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.4\/crib-score-histogram-bounded-tripolicy-by-discard-cut\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.4", "crib-score-histogram-bounded-tripolicy-by-discard-cut.bin");
      return `const cribBounded144Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+peggingFrontier145Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.5\/pegging-outcome-frontier-overrides\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.5", "pegging-outcome-frontier-overrides.bin");
      return `const peggingFrontier145Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+cribFrontier145Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.5\/crib-score-histogram-frontier-by-discard-cut\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.5", "crib-score-histogram-frontier-by-discard-cut.bin");
      return `const cribFrontier145Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  ).replace(
    /import\s+cribFullFrontier146Url\s+from\s+"\.\/models\/schell_table-peg_table-14\.6\/crib-score-histogram-full-frontier-by-discard-cut\.bin\?url";/,
    () => {
      const assetPath = path.join(path.dirname(enginePath), "models", "schell_table-peg_table-14.6", "crib-score-histogram-full-frontier-by-discard-cut.bin");
      return `const cribFullFrontier146Url = ${JSON.stringify(pathToFileURL(assetPath).href)};`;
    },
  );
}

function installLocalAssetFetch() {
  if (globalThis.__CRIBBAGE_LOCAL_ASSET_FETCH_INSTALLED) return;
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = async (resource, init) => {
    const url = typeof resource === "string" ? resource : resource?.url;
    if (typeof url === "string" && (url.startsWith("file:") || path.isAbsolute(url))) {
      const filePath = url.startsWith("file:") ? fileURLToPath(url) : url;
      const bytes = fs.readFileSync(filePath);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        json: async () => JSON.parse(bytes.toString("utf8")),
        text: async () => bytes.toString("utf8"),
      };
    }
    if (!nativeFetch) throw new Error(`No fetch implementation available for ${url}`);
    return nativeFetch(resource, init);
  };
  globalThis.__CRIBBAGE_LOCAL_ASSET_FETCH_INSTALLED = true;
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

function emptyHoldTable() {
  return {
    schemaVersion: 1,
    description: "Probability a player still holds at least one rank after playing a 1-, 2-, or 3-card ordered pegging prefix.",
    ranks,
    prefixLengths: [1, 2, 3],
    contexts: {},
  };
}

function normalizeRank(cardLabel) {
  return String(cardLabel || "").replace(/[dchs]$/, "");
}

function removeOneCard(labels, card) {
  const index = labels.indexOf(card);
  if (index === -1) return labels.slice();
  return labels.slice(0, index).concat(labels.slice(index + 1));
}

function addHoldObservation(table, prefix, remainingCards) {
  const key = prefix.join(",");
  const context = table.contexts[key] || {
    samples: 0,
    holds: Array(ranks.length).fill(0),
  };
  const remainingRanks = new Set(remainingCards.map(normalizeRank));
  context.samples += 1;
  for (const rank of remainingRanks) {
    const index = rankIndex.get(rank);
    if (index !== undefined) context.holds[index] += 1;
  }
  table.contexts[key] = context;
}

function recordHoldTable(table, events) {
  if (!table) return;
  const playedByHand = new Map();
  for (const event of events) {
    if (event.type !== "hand" || event.action !== "start") continue;
    playedByHand.set(`${event.handNumber}:human`, []);
    playedByHand.set(`${event.handNumber}:ai`, []);
  }
  for (const event of events) {
    if (event.type !== "pegging" || event.action !== "play" || !event.player || !event.card || !event.hand) continue;
    const playerKey = `${event.handNumber}:${event.player}`;
    const prefix = playedByHand.get(playerKey) || [];
    prefix.push(normalizeRank(event.card));
    playedByHand.set(playerKey, prefix);
    if (prefix.length > 3) continue;
    const remainingCards = removeOneCard(event.hand, event.card);
    addHoldObservation(table, prefix, remainingCards);
  }
}

function mergeHoldTables(target, source) {
  if (!source) return target;
  for (const [key, incoming] of Object.entries(source.contexts || {})) {
    const context = target.contexts[key] || {
      samples: 0,
      holds: Array(ranks.length).fill(0),
    };
    context.samples += incoming.samples || 0;
    for (let index = 0; index < ranks.length; index += 1) {
      context.holds[index] += incoming.holds?.[index] || 0;
    }
    target.contexts[key] = context;
  }
  return target;
}

function finalizeHoldTable(table, metadata = {}) {
  const contexts = {};
  for (const key of Object.keys(table.contexts).sort()) {
    const context = table.contexts[key];
    contexts[key] = {
      samples: context.samples,
      holds: context.holds,
      probabilities: context.holds.map((count) => context.samples ? count / context.samples : 0),
    };
  }
  return {
    schemaVersion: table.schemaVersion,
    generatedAt: new Date().toISOString(),
    description: table.description,
    ranks: table.ranks,
    prefixLengths: table.prefixLengths,
    ...metadata,
    contexts,
  };
}

function readHoldTable(filePath) {
  if (!fs.existsSync(filePath)) return emptyHoldTable();
  const parsed = readJson(filePath);
  const table = emptyHoldTable();
  for (const [key, context] of Object.entries(parsed.contexts || {})) {
    table.contexts[key] = {
      samples: context.samples || 0,
      holds: context.holds || Array(ranks.length).fill(0),
    };
  }
  return table;
}

function writeHoldTable(filePath, table, metadata = {}) {
  writeJson(filePath, finalizeHoldTable(table, metadata));
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

function handSummaries(events) {
  const hands = new Map();
  for (const event of events) {
    if (event.type === "hand" && event.action === "start") {
      hands.set(event.handNumber, {
        handNumber: event.handNumber,
        dealer: event.dealer,
        pone: event.pone,
        startScores: event.scores,
        turnCard: event.turnCard,
        scoring: [],
      });
    }
    if (event.type === "score") {
      const hand = hands.get(event.handNumber) || {
        handNumber: event.handNumber,
        scoring: [],
      };
      hand.scoring.push({
        player: event.player,
        role: event.role,
        category: event.category,
        points: event.points,
        totalScore: event.totalScore,
        scores: event.scores,
      });
      hand.endScores = event.scores;
      hands.set(event.handNumber, hand);
    }
    if (event.type === "hand" && event.action === "end") {
      const hand = hands.get(event.handNumber) || {
        handNumber: event.handNumber,
        scoring: [],
      };
      hand.endScores = event.scores;
      hand.crib = event.crib;
      hand.tables = event.tables;
      hands.set(event.handNumber, hand);
    }
  }
  return [...hands.values()].sort((a, b) => a.handNumber - b.handNumber);
}

function gameLogRecord({ events, end, finalScores, winner, result, leftEngine, rightEngine, gameIndex, randomSeed }) {
  const start = events.find((event) => event.type === "game" && event.action === "start");
  const record = {
    schemaVersion: 1,
    gameIndex,
    randomSeed,
    gameId: start?.gameId || end?.gameId || null,
    leftEngine,
    rightEngine,
    startedAt: start?.at || null,
    endedAt: end?.at || null,
    winner: winner === "human" ? "left" : "right",
    result,
    finalScores: {
      left: finalScores.human,
      right: finalScores.ai,
    },
  };
  record.hands = handSummaries(events);
  record.events = events;
  return record;
}

async function simulate(leftEngine, rightEngine, gameCount, progressEvery = 0, gameOffset = 0, runSeed = "ai-smoke") {
  const { CribbageGame, loadOpponentResources } = loadEngine();
  if (typeof loadOpponentResources === "function") {
    await Promise.all([
      loadOpponentResources(leftEngine),
      loadOpponentResources(rightEngine),
    ]);
  }
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  const holdTable = holdTableEnabled ? emptyHoldTable() : null;
  const gameLogs = [];
  const streamEvery = streamGamesEvery;
  let streamedGames = 0;
  const flushGameLogs = (force = false) => {
    if (!parentPort || !streamEvery || (!force && gameLogs.length < streamEvery) || !gameLogs.length) return;
    parentPort.postMessage({
      type: "gameLogs",
      workerIndex: workerData?.workerIndex,
      records: gameLogs.splice(0),
    });
    streamedGames += 1;
  };
  for (let index = 0; index < gameCount; index += 1) {
    const gameIndex = gameOffset + index;
    const randomSeed = gameSeedFor(runSeed, leftEngine, rightEngine, gameIndex);
    const game = withSeededMathRandom(randomSeed, () => {
      const seededGame = new CribbageGame(rightEngine, leftEngine);
      seededGame.autoPlayToEnd();
      return seededGame;
    });
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
    recordHoldTable(holdTable, events);
    gameLogs.push(gameLogRecord({
      events,
      end,
      finalScores,
      winner,
      result,
      leftEngine,
      rightEngine,
      gameIndex,
      randomSeed,
    }));
    flushGameLogs(false);
    if (progressEvery > 0 && (index + 1) % progressEvery === 0) {
      parentPort?.postMessage({
        type: "progress",
        workerIndex: workerData?.workerIndex,
        completed: index + 1,
        total: gameCount,
      });
    }
  }
  flushGameLogs(true);
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
    holdTable,
    gameLogs,
    streamedGames,
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
  (async () => {
    const startedAt = Date.now();
    const result = await simulate(
      workerData.leftEngine,
      workerData.rightEngine,
      workerData.gameCount,
      workerData.progressEvery,
      workerData.gameOffset,
      workerData.runSeed,
    );
    parentPort.postMessage({
      type: "done",
      ...result,
      elapsedMs: Date.now() - startedAt,
      gameCount: workerData.gameCount,
    });
  })().catch((error) => {
    parentPort.postMessage({
      type: "error",
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  });
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

function cyrb128(value) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < value.length; index += 1) {
    const k = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

function sfc32(a, b, c, d) {
  return function random() {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const result = (t + d) | 0;
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };
}

function withSeededMathRandom(seed, callback) {
  const previousRandom = Math.random;
  Math.random = sfc32(...cyrb128(seed));
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

function makeRunSeed(outDir) {
  if (process.env.AI_SMOKE_RUN_SEED) return process.env.AI_SMOKE_RUN_SEED;
  return `ai-smoke:${path.basename(outDir)}:${Date.now().toString(36)}`;
}

function gameSeedFor(runSeed, leftEngine, rightEngine, gameIndex) {
  return `${runSeed}:${leftEngine}:${rightEngine}:${gameIndex}`;
}

function openGameDatabase(filePath) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS ai_runs (
      run_id TEXT PRIMARY KEY,
      out_dir TEXT NOT NULL,
      command TEXT,
      git_commit TEXT,
      run_seed TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      included_in_tables INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ai_run_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES ai_runs(run_id)
    );
  `);
  ensureCompactSchema(db);
  return db;
}

function upsertRun(db, { runId, outDir, runSeed, status = "running", metadata = {} }) {
  if (!db) return;
  db.prepare(`
    INSERT INTO ai_runs (
      run_id, out_dir, command, git_commit, run_seed, status, started_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      command = excluded.command,
      git_commit = excluded.git_commit,
      run_seed = excluded.run_seed,
      status = excluded.status,
      metadata_json = excluded.metadata_json
  `).run(
    runId,
    outDir,
    currentCommand(),
    gitCommit(),
    runSeed,
    status,
    new Date().toISOString(),
    JSON.stringify(metadata),
  );
}

function markRunComplete(db, runId, status = "complete") {
  if (!db) return;
  db.prepare("UPDATE ai_runs SET status = ?, completed_at = ? WHERE run_id = ?")
    .run(status, new Date().toISOString(), runId);
}

function insertGameRecords(db, { runId, matchupId, records }) {
  if (!db || !records?.length) return;
  insertCompactGameRecords(db, { runId, matchupId, records });
}

function expectedCompletionAt(updatedAt, estimatedRemainingSeconds) {
  if (!Number.isFinite(estimatedRemainingSeconds)) return null;
  return new Date(Date.parse(updatedAt) + estimatedRemainingSeconds * 1000).toISOString();
}

function runWorker(
  leftEngine,
  rightEngine,
  gameCount,
  workerIndex,
  oldMb,
  progressEvery = 0,
  onProgress = () => {},
  gameOffset = 0,
  runSeed = "ai-smoke",
  onGameLogs = () => {},
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { leftEngine, rightEngine, gameCount, workerIndex, progressEvery, gameOffset, runSeed },
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
      if (message.type === "gameLogs") {
        onGameLogs(message);
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

async function runOne({ leftEngine, rightEngine, workers, games, oldMb, runSeed }) {
  const sizes = chunkSizes(games, workers);
  const startedAt = Date.now();
  const results = await Promise.all(sizes.map((size, index) =>
    runWorker(leftEngine, rightEngine, size, index, oldMb, 0, () => {}, 0, runSeed)
  ));
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  let maxHeapUsedMb = 0;
  let totalHeapUsedMb = 0;
  let maxRssMb = 0;
  const holdTable = holdTableEnabled ? emptyHoldTable() : null;
  for (const result of results) {
    addStats(leftStats, result.leftStats);
    addStats(rightStats, result.rightStats);
    const heapMb = result.memory.heapUsed / 1024 / 1024;
    const rssMb = result.memory.rss / 1024 / 1024;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapMb);
    totalHeapUsedMb += heapMb;
    maxRssMb = Math.max(maxRssMb, rssMb);
    mergeHoldTables(holdTable, result.holdTable);
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
    holdTable: holdTable ? finalizeHoldTable(holdTable, { leftEngine, rightEngine, games }) : null,
    workerElapsedSeconds: results.map((result) => result.elapsedMs / 1000),
    workerGames: results.map((result) => result.gameCount),
  };
}

function makeBatches(totalGames, batchGames) {
  const batches = [];
  let remaining = totalGames;
  let index = 0;
  let start = 0;
  while (remaining > 0) {
    const gameCount = Math.min(batchGames, remaining);
    batches.push({ index, gameCount, start });
    remaining -= gameCount;
    start += gameCount;
    index += 1;
  }
  return batches;
}

function compactBatchHasRows(db, runId, matchupId, batch) {
  if (!db) return true;
  ensureCompactSchema(db);
  const row = db.prepare(`
    SELECT count(*) AS count
    FROM compact_games
    WHERE run_id = ?
      AND matchup_id = ?
      AND game_index >= ?
      AND game_index < ?
  `).get(runId, matchupId, batch.start, batch.start + batch.gameCount);
  return (row?.count || 0) >= batch.gameCount;
}

function aggregateBatchResults({ leftEngine, rightEngine, workers, games, oldMb, startedAt, batchResults }) {
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  let maxHeapUsedMb = 0;
  let totalHeapUsedMb = 0;
  let maxRssMb = 0;
  const holdTable = holdTableEnabled ? emptyHoldTable() : null;
  for (const result of batchResults) {
    addStats(leftStats, result.leftStats);
    addStats(rightStats, result.rightStats);
    const heapMb = result.memory.heapUsed / 1024 / 1024;
    const rssMb = result.memory.rss / 1024 / 1024;
    maxHeapUsedMb = Math.max(maxHeapUsedMb, heapMb);
    totalHeapUsedMb += heapMb;
    maxRssMb = Math.max(maxRssMb, rssMb);
    mergeHoldTables(holdTable, result.holdTable);
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
    holdTable: holdTable ? finalizeHoldTable(holdTable, { leftEngine, rightEngine, games }) : null,
    maxWorkerHeapUsedMb: maxHeapUsedMb,
    totalWorkerHeapUsedMb: totalHeapUsedMb,
    maxWorkerRssMb: maxRssMb,
    workerElapsedSeconds: batchResults.map((result) => result.elapsedMs / 1000),
    workerGames: batchResults.map((result) => result.gameCount),
    batchesCompleted: batchResults.length,
  };
}

async function runOneCheckpointed({ job, id, outDir, resultPath, statusPath, jobIndex, jobCount, batchGames, runSeed, gameDb, runId }) {
  const startedAt = Date.now();
  const batches = makeBatches(job.games, batchGames);
  const batchDir = path.join(outDir, `${id}.batches`);
  const holdTableDir = holdTableEnabled ? path.join(outDir, `${id}.hold-tables`) : null;
  fs.mkdirSync(batchDir, { recursive: true });
  if (holdTableDir) fs.mkdirSync(holdTableDir, { recursive: true });

  const completed = [];
  const pending = [];
  for (const batch of batches) {
    const batchPath = path.join(batchDir, `${batchId(batch.index)}.json`);
    if (fs.existsSync(batchPath) && compactBatchHasRows(gameDb, runId, id, batch)) {
      completed.push(readJson(batchPath));
    } else {
      pending.push({ ...batch, batchPath });
    }
  }

  let next = 0;
  let active = 0;
  let currentCompletedGames = completed.reduce((sum, item) => sum + item.gameCount, 0);
  const activeBatchProgress = new Map();
  const streamedGameCounts = new Map();

  const writeStatus = () => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const activeCompletedGames = Array.from(activeBatchProgress.values()).reduce((sum, value) => sum + value, 0);
    const streamedActiveGames = Array.from(streamedGameCounts.values()).reduce((sum, value) => sum + value, 0);
    const visibleCompletedGames = Math.min(job.games, currentCompletedGames + activeCompletedGames);
    const gamesPerSecond = elapsedSeconds > 0 ? Math.max(0, visibleCompletedGames) / elapsedSeconds : 0;
    const remainingGames = Math.max(0, job.games - visibleCompletedGames);
    const updatedAt = new Date().toISOString();
    const estimatedRemainingSeconds = gamesPerSecond > 0 ? remainingGames / gamesPerSecond : null;
    writeJson(statusPath, {
      status: "running",
      updatedAt,
      command: currentCommand(),
      gitCommit: gitCommit(),
      outDir,
      jobIndex,
      jobCount,
      currentJob: job,
      batchGames,
      gameDbEnabled,
      gameDbPath: gameDbEnabled ? gameDbPath : null,
      runId,
      runSeed,
      totalBatches: batches.length,
      completedBatches: completed.length,
      activeBatches: active,
      savedGames: Math.min(job.games, currentCompletedGames + streamedActiveGames),
      activeCompletedGames,
      streamedActiveGames,
      completedGames: visibleCompletedGames,
      totalGames: job.games,
      progressPercent: job.games ? (visibleCompletedGames / job.games) * 100 : 100,
      gamesPerSecond,
      estimatedRemainingSeconds,
      expectedCompletionAt: expectedCompletionAt(updatedAt, estimatedRemainingSeconds),
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
          batch.start,
          runSeed,
          (message) => {
            const records = message.records || [];
            if (gameDb && records.length) {
              insertGameRecords(gameDb, {
                runId,
                matchupId: id,
                records,
              });
            }
            streamedGameCounts.set(batch.index, (streamedGameCounts.get(batch.index) || 0) + records.length);
            writeStatus();
          },
        )
          .then((result) => {
            const gameLogCount = result.gameLogs?.length || 0;
            if (gameDb && gameLogCount) {
              insertGameRecords(gameDb, {
                runId,
                matchupId: id,
                records: result.gameLogs,
              });
            }
            if (holdTableDir && result.holdTable) {
              writeHoldTable(path.join(holdTableDir, `${batchId(batch.index)}.hold-table.json`), result.holdTable, {
                leftEngine: job.leftEngine,
                rightEngine: job.rightEngine,
                batchIndex: batch.index,
                games: batch.gameCount,
              });
            }
            delete result.gameLogs;
            const batchResult = {
              batchIndex: batch.index,
              ...result,
              gameLogCount,
              completedAt: new Date().toISOString(),
            };
            writeJson(batch.batchPath, batchResult);
            completed.push(batchResult);
            currentCompletedGames += batch.gameCount;
            activeBatchProgress.delete(batch.index);
            streamedGameCounts.delete(batch.index);
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
  if (holdTableEnabled && result.holdTable) {
    const runHoldTablePath = path.join(outDir, `${id}.hold-table.json`);
    writeJson(runHoldTablePath, result.holdTable);
    const cumulative = readHoldTable(holdTablePath);
    mergeHoldTables(cumulative, result.holdTable);
    writeHoldTable(holdTablePath, cumulative, {
      source: "ai-smoke",
      cumulative: true,
      updatedBy: outDir,
      latestMatchup: id,
    });
  }
  return result;
}

async function main() {
  const outDir = process.argv[2] || path.join(root, "benchmarks", "ai-smoke", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const games = Number.parseInt(process.argv[3] || "12", 10);
  const workerCounts = parseList(process.argv[4], [1, 2]);
  const oldMbs = parseList(process.argv[5], [384, 768]);
  const batchGames = Number.parseInt(process.argv[6] || "25", 10);
  const runSeed = makeRunSeed(outDir);
  const runId = path.basename(outDir);
  const statusPath = path.join(outDir, "status.json");
  const summaryPath = path.join(outDir, "summary.json");
  fs.mkdirSync(outDir, { recursive: true });
  const models = modelsForOutDir(outDir);
  const matchups = buildMatchups(models);
  const gameDb = gameDbEnabled ? openGameDatabase(gameDbPath) : null;

  const jobs = [];
  for (const [leftEngine, rightEngine] of matchups) {
    for (const workers of workerCounts) {
      for (const oldMb of oldMbs) {
        jobs.push({ leftEngine, rightEngine, workers, oldMb, games });
      }
    }
  }

  upsertRun(gameDb, {
    runId,
    outDir,
    runSeed,
    metadata: {
      games,
      batchGames,
      holdTableEnabled,
      holdTablePath: holdTableEnabled ? holdTablePath : null,
      workerCounts,
      oldMbs,
      scoreComponentsEnabled,
      model13TreeCacheLimit,
      streamGamesEvery,
      models,
      matchups,
    },
  });

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
      runId,
      runSeed,
      gameDbEnabled,
      gameDbPath: gameDbEnabled ? gameDbPath : null,
      scoreComponentsEnabled,
      model13TreeCacheLimit,
      streamGamesEvery,
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
        runSeed,
        gameDb,
        runId,
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
    runId,
    runSeed,
    gamesPerJob: games,
    batchGames,
    holdTableEnabled,
    holdTablePath: holdTableEnabled ? holdTablePath : null,
    gameDbEnabled,
    gameDbPath: gameDbEnabled ? gameDbPath : null,
    model13TreeCacheLimit,
    streamGamesEvery,
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
    runId,
    runSeed,
    gameDbEnabled,
    gameDbPath: gameDbEnabled ? gameDbPath : null,
    summaryPath,
    completedJobs: completed.length,
    failedJobs: failed.length,
  });
  markRunComplete(gameDb, runId, failed.length ? "complete_with_failures" : "complete");
  gameDb?.close();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
