const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const gamesPerMatchup = Number.parseInt(process.argv[2] || "300", 10);
const mode = process.argv[3] || "three-way";
const outputPath = process.argv[4] || "";
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");

if (!Number.isInteger(gamesPerMatchup) || gamesPerMatchup <= 0) {
  throw new Error("Game count must be a positive integer.");
}
if (!["three-way", "three-way-expert-1.1", "ras-v-schell", "peg-variants"].includes(mode)) {
  throw new Error("Mode must be three-way, three-way-expert-1.1, ras-v-schell, or peg-variants.");
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
  expert: "expert-peg_table-2.3",
  expert20: "expert-2.0-ras-tables",
  expertPegTable23: "expert-peg_table-2.3",
  expertPegTable22: "expert-peg_table-2.2",
  expertPeg21: "expert-peg-2.1",
  expertPegTable13: "expert-peg_table-1.3",
  expert11: "expert-1.1",
  expertPeg12: "expert-peg-1.2",
  ras: "ras-table-1.0",
  rasPeg: "ras-table-peg-1.1",
  rasPegTable: "ras-table-peg_table-1.2",
  schell: "schell-table-1.0",
  schellPeg: "schell-table-peg-1.1",
  schellPegTable: "schell-table-peg_table-1.2",
};

const labels = {
  [engines.expertPegTable23]: "Expert Peg Table 2.3",
  [engines.expertPegTable22]: "Expert Peg Table 2.2",
  [engines.expert20]: "Expert 2.0 Ras Tables",
  [engines.expertPeg21]: "Expert Peg 2.1",
  [engines.expertPegTable13]: "Expert Peg Table 1.3",
  [engines.expert11]: "Expert 1.1",
  [engines.expertPeg12]: "Expert Peg 1.2",
  [engines.ras]: "Ras Table 1.0",
  [engines.rasPeg]: "Ras Table Peg 1.1",
  [engines.rasPegTable]: "Ras Table Peg Table 1.2",
  [engines.schell]: "Schell Table 1.0",
  [engines.schellPeg]: "Schell Table Peg 1.1",
  [engines.schellPegTable]: "Schell Table Peg Table 1.2",
};

const threeWayMatchups = [
  [engines.ras, engines.expert],
  [engines.ras, engines.schell],
  [engines.schell, engines.expert],
];
const threeWayExpert11Matchups = [
  [engines.ras, engines.expert11],
  [engines.ras, engines.schell],
  [engines.schell, engines.expert11],
];
const rasVsSchellMatchups = [[engines.ras, engines.schell]];
const pegVariantMatchups = [
  [engines.expertPeg21, engines.expert],
  [engines.expert20, engines.expertPeg21],
  [engines.expert11, engines.expertPeg12],
  [engines.ras, engines.rasPeg],
  [engines.schell, engines.schellPeg],
];
const matchups =
  mode === "ras-v-schell"
    ? rasVsSchellMatchups
    : mode === "peg-variants"
      ? pegVariantMatchups
    : mode === "three-way-expert-1.1"
      ? threeWayExpert11Matchups
      : threeWayMatchups;

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
  version: 1,
  generatedAt: new Date().toISOString(),
  source: mode,
  physicalGames: gamesPerMatchup * matchups.length,
  gamesPerMatchup,
  matchups: matchupResults,
  totals: Object.fromEntries(Object.entries(totals).map(([engine, stats]) => [
    engine,
    { label: labels[engine], ...summarize(stats) },
  ])),
  models: Object.fromEntries(Object.entries(totals)
    .filter(([, stats]) => stats.games > 0)
    .map(([engine, stats]) => [engine, baselineModel(stats)])),
};

if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${outputPath}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
