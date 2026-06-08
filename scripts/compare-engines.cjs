const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const gamesPerMatchup = Number.parseInt(process.argv[2] || "300", 10);
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");

if (!Number.isInteger(gamesPerMatchup) || gamesPerMatchup <= 0) {
  throw new Error("Game count must be a positive integer.");
}

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

const { CribbageGame } = engineModule.exports;

const engines = {
  expert: "expert-1.1",
  ras: "ras-table-1.0",
  schell: "schell-table-1.0",
};

const labels = {
  [engines.expert]: "Expert 1.1",
  [engines.ras]: "Ras Table 1.0",
  [engines.schell]: "Schell Table 1.0",
};

const matchups = [
  [engines.ras, engines.expert],
  [engines.ras, engines.schell],
  [engines.schell, engines.expert],
];

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

const totals = Object.fromEntries(Object.values(engines).map((engine) => [engine, emptyStats()]));
const matchupResults = [];

for (const [leftEngine, rightEngine] of matchups) {
  const leftStats = emptyStats();
  const rightStats = emptyStats();
  for (let index = 0; index < gamesPerMatchup; index += 1) {
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
    recordOutcome(totals[leftEngine], winner === "human", finalScores.human, finalScores.ai, result);
    recordOutcome(totals[rightEngine], winner === "ai", finalScores.ai, finalScores.human, result);
    recordScores(leftStats, "human", events);
    recordScores(rightStats, "ai", events);
    recordScores(totals[leftEngine], "human", events);
    recordScores(totals[rightEngine], "ai", events);
    if ((index + 1) % 50 === 0) {
      process.stdout.write(`${labels[leftEngine]} vs ${labels[rightEngine]}: ${index + 1}/${gamesPerMatchup}\n`);
    }
  }
  matchupResults.push({
    matchup: `${labels[leftEngine]} vs ${labels[rightEngine]}`,
    [leftEngine]: summarize(leftStats),
    [rightEngine]: summarize(rightStats),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  gamesPerMatchup,
  matchups: matchupResults,
  totals: Object.fromEntries(Object.entries(totals).map(([engine, stats]) => [
    engine,
    { label: labels[engine], ...summarize(stats) },
  ])),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
