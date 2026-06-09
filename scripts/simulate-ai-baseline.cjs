const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const gameCount = Number.parseInt(process.argv[2] || "1000", 10);
const defaultOpponent = "expert-peg-2.2";
const validOpponents = new Set([
  "expert-1.1",
  "expert-peg-1.2",
  "expert-2.0-ras-tables",
  "expert-peg-2.1",
  "expert-peg-2.2",
  "ras-table-1.0",
  "ras-table-peg-1.1",
  "schell-table-1.0",
  "schell-table-peg-1.1",
]);
const opponent = process.argv[3] || defaultOpponent;
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web/src/engine.ts");
const outputPath = path.join(root, "web/src/ai-baseline.json");

if (!Number.isInteger(gameCount) || gameCount <= 0) {
  throw new Error("Game count must be a positive integer.");
}
if (!validOpponents.has(opponent)) {
  throw new Error(`Opponent must be one of: ${[...validOpponents].join(", ")}.`);
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

const totals = {
  wins: 0,
  losses: 0,
  skunks: 0,
  skunked: 0,
  doubleSkunks: 0,
  doubleSkunked: 0,
  peggingDealer: 0,
  peggingPone: 0,
  handDealer: 0,
  handPone: 0,
  crib: 0,
};

const opportunities = {
  peggingDealer: 0,
  peggingPone: 0,
  handDealer: 0,
  handPone: 0,
  crib: 0,
};

function scoreKey(category, role) {
  if (category === "crib") return "crib";
  return `${category}${role === "dealer" ? "Dealer" : "Pone"}`;
}

function resultFromScores(winner, scores) {
  const loser = winner === "human" ? "ai" : "human";
  const loserScore = scores?.[loser] ?? 121;
  if (loserScore <= 60) return "double-skunk";
  if (loserScore <= 90) return "skunk";
  return "regular";
}

for (let index = 0; index < gameCount; index += 1) {
  const game = new CribbageGame(opponent);
  game.autoPlayToEnd();
  const events = game.state().analyticsEvents;
  const hands = new Map();
  const ensureHand = (handNumber) => {
    if (!hands.has(handNumber)) {
      hands.set(handNumber, {
        roles: {},
      });
    }
    return hands.get(handNumber);
  };

  for (const event of events) {
    if (event.handNumber && event.type === "hand" && event.action === "start") {
      const hand = ensureHand(event.handNumber);
      hand.roles[event.dealer] = "dealer";
      hand.roles[event.pone] = "pone";
    }
    if (event.type === "score") {
      totals[scoreKey(event.category, event.role)] += event.points;
    } else if (event.type === "game" && event.action === "end" && event.winner) {
      const result = event.result || resultFromScores(event.winner, event.finalScores);
      totals.wins += 1;
      totals.losses += 1;
      if (result === "skunk" || result === "double-skunk") {
        totals.skunks += 1;
        totals.skunked += 1;
      }
      if (result === "double-skunk") {
        totals.doubleSkunks += 1;
        totals.doubleSkunked += 1;
      }
    }
  }
  for (const hand of hands.values()) {
    for (const player of ["human", "ai"]) {
      const role = hand.roles[player];
      if (!role) continue;
      opportunities[role === "dealer" ? "peggingDealer" : "peggingPone"] += 1;
      opportunities[role === "dealer" ? "handDealer" : "handPone"] += 1;
      if (role === "dealer") opportunities.crib += 1;
    }
  }
  if ((index + 1) % 100 === 0) {
    process.stdout.write(`Simulated ${index + 1}/${gameCount} games\n`);
  }
}

const averages = Object.fromEntries(
  Object.keys(opportunities).map((key) => [
    key,
    opportunities[key] ? totals[key] / opportunities[key] : 0,
  ]),
);

const baseline = {
  version: 1,
  generatedAt: new Date().toISOString(),
  games: gameCount,
  opponent,
  source: "ai-vs-ai-baseline",
  aiTotals: totals,
  opportunities,
  averages,
};

fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
process.stdout.write(`Wrote ${outputPath}\n`);
