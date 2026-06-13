#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const defaultOutPath = path.join(root, "web", "src", "ai-benchmark-summary.json");
const dbPath = path.resolve(root, process.argv[2] || process.env.AI_SMOKE_GAME_DB_PATH || defaultDbPath);
const outPath = path.resolve(root, process.argv[3] || defaultOutPath);

const SCORE_KEYS = ["peggingDealer", "peggingPone", "handDealer", "handPone", "crib"];

function emptyModel() {
  return {
    games: 0,
    aiTotals: {
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
    },
    opportunities: {
      peggingDealer: 0,
      peggingPone: 0,
      handDealer: 0,
      handPone: 0,
      crib: 0,
    },
  };
}

function getModel(models, engine) {
  if (!models[engine]) models[engine] = emptyModel();
  return models[engine];
}

function recordOutcome(model, won, result) {
  model.games += 1;
  if (won) {
    model.aiTotals.wins += 1;
    if (result >= 1) model.aiTotals.skunks += 1;
    if (result === 2) model.aiTotals.doubleSkunks += 1;
  } else {
    model.aiTotals.losses += 1;
    if (result >= 1) model.aiTotals.skunked += 1;
    if (result === 2) model.aiTotals.doubleSkunked += 1;
  }
}

function addRoleScores(model, role, peggingPoints, handPoints, cribPoints = 0) {
  if (role === "dealer") {
    model.aiTotals.peggingDealer += peggingPoints;
    model.aiTotals.handDealer += handPoints;
    model.aiTotals.crib += cribPoints;
    model.opportunities.peggingDealer += 1;
    model.opportunities.handDealer += 1;
    model.opportunities.crib += 1;
  } else {
    model.aiTotals.peggingPone += peggingPoints;
    model.aiTotals.handPone += handPoints;
    model.opportunities.peggingPone += 1;
    model.opportunities.handPone += 1;
  }
}

function addAverages(model) {
  model.averages = Object.fromEntries(SCORE_KEYS.map((key) => [
    key,
    model.opportunities[key] ? model.aiTotals[key] / model.opportunities[key] : 0,
  ]));
  return model;
}

function main() {
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const models = {};
  const includedPredicate = `
    g.included_in_tables = 1
    AND COALESCE(r.included_in_tables, 1) = 1
  `;

  const gameRows = db.prepare(`
    SELECT g.left_engine, g.right_engine, g.winner, g.result
    FROM compact_games g
    LEFT JOIN ai_runs r ON r.run_id = g.run_id
    WHERE ${includedPredicate}
  `).all();
  for (const row of gameRows) {
    const left = getModel(models, row.left_engine);
    const right = getModel(models, row.right_engine);
    const result = Number(row.result ?? 0);
    recordOutcome(left, row.winner === 0, result);
    recordOutcome(right, row.winner === 1, result);
  }

  const handRows = db.prepare(`
    SELECT
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
    WHERE ${includedPredicate}
  `).all();
  for (const row of handRows) {
    const left = getModel(models, row.left_engine);
    const right = getModel(models, row.right_engine);
    if (row.dealer === 0) {
      addRoleScores(left, "dealer", row.left_pegging_points, row.left_hand_points, row.crib_points);
      addRoleScores(right, "pone", row.right_pegging_points, row.right_hand_points);
    } else {
      addRoleScores(left, "pone", row.left_pegging_points, row.left_hand_points);
      addRoleScores(right, "dealer", row.right_pegging_points, row.right_hand_points, row.crib_points);
    }
  }

  const runs = db.prepare(`
    SELECT g.run_id, count(*) AS games
    FROM compact_games g
    LEFT JOIN ai_runs r ON r.run_id = g.run_id
    WHERE ${includedPredicate}
    GROUP BY g.run_id
    ORDER BY g.run_id
  `).all();
  db.close();

  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "sqlite-ai-benchmark-summary",
    dbPath: path.relative(root, dbPath),
    physicalGames: gameRows.length,
    modelGames: Object.values(models).reduce((sum, model) => sum + model.games, 0),
    sourceRuns: runs.map((run) => ({ runId: run.run_id, games: run.games })),
    models: Object.fromEntries(Object.entries(models)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([engine, model]) => [engine, addAverages(model)])),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(root, outPath)} from ${path.relative(root, dbPath)}\n`);
}

main();
