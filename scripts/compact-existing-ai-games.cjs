#!/usr/bin/env node
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ensureCompactSchema, insertCompactGameRecords } = require("./compact-game-storage.cjs");

const root = path.resolve(__dirname, "..");
const dbPath = path.resolve(root, process.argv[2] || process.env.AI_SMOKE_GAME_DB_PATH || "benchmarks/ai-db/cribbage-games.sqlite");
const batchSize = Number.parseInt(process.env.COMPACT_CONVERT_BATCH_SIZE || "250", 10);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 30000;");
ensureCompactSchema(db);
if (process.env.COMPACT_REBUILD === "1") {
  db.exec(`
    DELETE FROM compact_peg_plays;
    DELETE FROM compact_hands;
    DELETE FROM compact_games;
  `);
}

const total = db.prepare(`
  SELECT count(*)
  FROM ai_games g
  LEFT JOIN compact_games c ON c.game_id = g.game_id
  WHERE c.game_id IS NULL
`).get()["count(*)"];

const select = db.prepare(`
  SELECT g.*
  FROM ai_games g
  LEFT JOIN compact_games c ON c.game_id = g.game_id
  WHERE c.game_id IS NULL
  ORDER BY g.run_id, g.game_index
  LIMIT ?
`);

let converted = 0;
let hands = 0;
let pegPlays = 0;
while (true) {
  const rows = select.all(batchSize);
  if (!rows.length) break;
  const byRunMatchup = new Map();
  for (const row of rows) {
    const record = JSON.parse(row.record_json);
    record.gameId = row.game_id;
    record.gameIndex = row.game_index;
    record.randomSeed = row.random_seed;
    record.leftEngine = row.left_engine;
    record.rightEngine = row.right_engine;
    record.winner = record.winner || (row.winner === "left" || row.winner === "right" ? row.winner : null);
    record.result = record.result || row.result;
    record.finalScores = record.finalScores || { left: row.final_left_score, right: row.final_right_score };
    record.startedAt = record.startedAt || row.started_at;
    record.endedAt = record.endedAt || row.ended_at;
    record.reproducible = Boolean(row.reproducible);
    record.sourceLogPath = row.source_log_path;
    record.notes = row.notes;
    if (!record.hands && row.hands_json) record.hands = JSON.parse(row.hands_json);
    if (!record.events && row.events_json) record.events = JSON.parse(row.events_json);
    const key = `${row.run_id}\0${row.matchup_id}`;
    if (!byRunMatchup.has(key)) {
      byRunMatchup.set(key, { runId: row.run_id, matchupId: row.matchup_id, records: [] });
    }
    byRunMatchup.get(key).records.push(record);
  }
  for (const group of byRunMatchup.values()) {
    const result = insertCompactGameRecords(db, group);
    converted += result.games;
    hands += result.hands;
    pegPlays += result.pegPlays;
  }
  process.stdout.write(`converted ${converted}/${total} games\n`);
}

db.close();
console.log(JSON.stringify({ dbPath: path.relative(root, dbPath), converted, hands, pegPlays }, null, 2));
