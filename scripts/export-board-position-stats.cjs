#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const defaultOutPath = path.join(root, "web", "src", "models", "flush-aware-board-position-stats.json");
const dbPath = path.resolve(root, process.argv[2] || process.env.AI_SMOKE_GAME_DB_PATH || defaultDbPath);
const outPath = path.resolve(root, process.argv[3] || defaultOutPath);
const modelCsv = process.argv[4] || "schell_table-peg_table-7.0,schell_table-peg_table-8.0,schell_table-peg_table-9.0";
const includedModels = new Set(modelCsv.split(",").map((value) => value.trim()).filter(Boolean));

const phases = [
  "peggingDealer",
  "peggingPone",
  "handDealer",
  "handPone",
  "crib",
  "dealerCycle",
  "poneCycle",
  "peggingTotal",
  "handShowTotal",
];

function newAccumulator() {
  return { count: 0, mean: 0, m2: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, total: 0 };
}

function add(acc, value) {
  acc.count += 1;
  acc.total += value;
  acc.min = Math.min(acc.min, value);
  acc.max = Math.max(acc.max, value);
  const delta = value - acc.mean;
  acc.mean += delta / acc.count;
  acc.m2 += delta * (value - acc.mean);
}

function finalize(acc) {
  return {
    count: acc.count,
    average: acc.count ? acc.mean : 0,
    variance: acc.count > 1 ? acc.m2 / (acc.count - 1) : 0,
    standardDeviation: acc.count > 1 ? Math.sqrt(acc.m2 / (acc.count - 1)) : 0,
    min: acc.count ? acc.min : 0,
    max: acc.count ? acc.max : 0,
    total: acc.total,
  };
}

function phaseAccumulatorSet() {
  return Object.fromEntries(phases.map((phase) => [phase, newAccumulator()]));
}

function getModel(map, model) {
  if (!map[model]) map[model] = phaseAccumulatorSet();
  return map[model];
}

function addPlayerHandStats(target, role, peggingPoints, handPoints, cribPoints = 0) {
  if (role === "dealer") {
    add(target.peggingDealer, peggingPoints);
    add(target.handDealer, handPoints);
    add(target.crib, cribPoints);
    add(target.dealerCycle, peggingPoints + handPoints + cribPoints);
  } else {
    add(target.peggingPone, peggingPoints);
    add(target.handPone, handPoints);
    add(target.poneCycle, peggingPoints + handPoints);
  }
}

function finalizeSet(set) {
  return Object.fromEntries(phases.map((phase) => [phase, finalize(set[phase])]));
}

function main() {
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const models = [...includedModels];
  const placeholders = models.map(() => "?").join(",");
  const params = [...models, ...models];
  const rows = db.prepare(`
    SELECT
      g.run_id,
      g.left_engine,
      g.right_engine,
      h.dealer,
      h.left_pegging_points,
      h.right_pegging_points,
      h.left_hand_points,
      h.right_hand_points,
      h.crib_points
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    LEFT JOIN ai_runs r ON r.run_id = g.run_id
    WHERE g.left_engine IN (${placeholders})
      AND g.right_engine IN (${placeholders})
      AND g.included_in_tables = 1
      AND COALESCE(r.included_in_tables, 1) = 1
  `).all(...params);

  const global = phaseAccumulatorSet();
  const byModel = {};
  const runCounts = new Map();
  const matchupCounts = new Map();

  for (const row of rows) {
    runCounts.set(row.run_id, (runCounts.get(row.run_id) || 0) + 1);
    const matchup = `${row.left_engine}__vs__${row.right_engine}`;
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1);
    const left = getModel(byModel, row.left_engine);
    const right = getModel(byModel, row.right_engine);

    add(global.peggingTotal, row.left_pegging_points + row.right_pegging_points);
    add(global.handShowTotal, row.left_hand_points + row.right_hand_points + row.crib_points);
    add(left.peggingTotal, row.left_pegging_points + row.right_pegging_points);
    add(right.peggingTotal, row.left_pegging_points + row.right_pegging_points);
    add(left.handShowTotal, row.left_hand_points + row.right_hand_points + row.crib_points);
    add(right.handShowTotal, row.left_hand_points + row.right_hand_points + row.crib_points);

    if (row.dealer === 0) {
      addPlayerHandStats(global, "dealer", row.left_pegging_points, row.left_hand_points, row.crib_points);
      addPlayerHandStats(global, "pone", row.right_pegging_points, row.right_hand_points);
      addPlayerHandStats(left, "dealer", row.left_pegging_points, row.left_hand_points, row.crib_points);
      addPlayerHandStats(right, "pone", row.right_pegging_points, row.right_hand_points);
    } else {
      addPlayerHandStats(global, "pone", row.left_pegging_points, row.left_hand_points);
      addPlayerHandStats(global, "dealer", row.right_pegging_points, row.right_hand_points, row.crib_points);
      addPlayerHandStats(left, "pone", row.left_pegging_points, row.left_hand_points);
      addPlayerHandStats(right, "dealer", row.right_pegging_points, row.right_hand_points, row.crib_points);
    }
  }

  const gameCount = db.prepare(`
    SELECT count(*) AS count
    FROM compact_games g
    LEFT JOIN ai_runs r ON r.run_id = g.run_id
    WHERE g.left_engine IN (${placeholders})
      AND g.right_engine IN (${placeholders})
      AND g.included_in_tables = 1
      AND COALESCE(r.included_in_tables, 1) = 1
  `).get(...params).count;
  db.close();

  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "compact-sqlite-flush-aware-ai-games",
    dbPath: path.relative(root, dbPath),
    modelFilter: models,
    gameCount,
    handCount: rows.length,
    phaseOrderForFutureHands: [
      "peggingPone",
      "peggingDealer",
      "handPone",
      "handDealer",
      "crib",
    ],
    semantics: {
      average: "Mean points for the named scoring component.",
      variance: "Sample variance of points for the named scoring component.",
      dealerCycle: "Dealer pegging + dealer hand + crib for one hand.",
      poneCycle: "Pone pegging + pone hand for one hand.",
      peggingTotal: "Both players' pegging points in one hand.",
      handShowTotal: "Pone hand + dealer hand + crib in one hand.",
      modelFilter: "Only games where both engines are in this list are included.",
    },
    global: finalizeSet(global),
    byModel: Object.fromEntries(Object.entries(byModel)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, set]) => [model, finalizeSet(set)])),
    sourceRuns: [...runCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([runId, hands]) => ({ runId, hands })),
    sourceMatchups: [...matchupCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([matchup, hands]) => ({ matchup, hands })),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(root, outPath)} from ${artifact.handCount} hands in ${artifact.gameCount} games\n`);
}

main();
