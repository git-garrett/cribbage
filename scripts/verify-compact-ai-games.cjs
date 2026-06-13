#!/usr/bin/env node
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  compactHand,
  handsFromEvents,
  pegSequenceBlob,
  playerCode,
  resultCode,
} = require("./compact-game-storage.cjs");

const root = path.resolve(__dirname, "..");
const dbPath = path.resolve(root, process.argv[2] || process.env.AI_SMOKE_GAME_DB_PATH || "benchmarks/ai-db/cribbage-games.sqlite");
const batchSize = Number.parseInt(process.env.COMPACT_VERIFY_BATCH_SIZE || "100", 10);
const sampleMismatchLimit = Number.parseInt(process.env.COMPACT_VERIFY_MISMATCH_LIMIT || "10", 10);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 30000;");

const countRow = db.prepare("SELECT count(*) AS count FROM ai_games").get();
const total = countRow.count;
const selectGames = db.prepare(`
  SELECT *
  FROM ai_games
  ORDER BY run_id, matchup_id, game_index
  LIMIT ? OFFSET ?
`);
const selectCompactGame = db.prepare("SELECT * FROM compact_games WHERE game_id = ?");
const selectCompactHands = db.prepare(`
  SELECT *
  FROM compact_hands
  WHERE game_id = ?
  ORDER BY hand_number
`);

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function sameBlob(actual, expected) {
  const actualBuffer = Buffer.isBuffer(actual) ? actual : Buffer.from(actual || []);
  const expectedBuffer = Buffer.isBuffer(expected) ? expected : Buffer.from(expected || []);
  return actualBuffer.equals(expectedBuffer);
}

function compactGameExpected(row, record) {
  return {
    run_id: row.run_id,
    matchup_id: row.matchup_id,
    game_index: row.game_index,
    random_seed: row.random_seed || "",
    left_engine: row.left_engine,
    right_engine: row.right_engine,
    winner: playerCode(record.winner || row.winner),
    result: resultCode(record.result || row.result),
    final_left_score: record.finalScores?.left ?? row.final_left_score ?? null,
    final_right_score: record.finalScores?.right ?? row.final_right_score ?? null,
    started_at: record.startedAt ?? row.started_at ?? null,
    ended_at: record.endedAt ?? row.ended_at ?? null,
    reproducible: row.reproducible ? 1 : 0,
    included_in_tables: row.included_in_tables ? 1 : 0,
    source_log_path: row.source_log_path ?? null,
  };
}

function compareScalar(mismatches, label, actual, expected) {
  if ((actual ?? null) !== (expected ?? null)) {
    mismatches.push(`${label}: expected ${expected ?? "null"}, got ${actual ?? "null"}`);
  }
}

let checkedGames = 0;
let checkedHands = 0;
let mismatchedGames = 0;
const samples = [];

for (let offset = 0; offset < total; offset += batchSize) {
  const rows = selectGames.all(batchSize, offset);
  for (const row of rows) {
    const record = parseJson(row.record_json, {});
    record.gameId = row.game_id;
    record.gameIndex = row.game_index;
    record.randomSeed = row.random_seed;
    record.leftEngine = row.left_engine;
    record.rightEngine = row.right_engine;
    if (!record.hands) record.hands = parseJson(row.hands_json, undefined);
    if (!record.events) record.events = parseJson(row.events_json, undefined);

    const mismatches = [];
    const compactGame = selectCompactGame.get(row.game_id);
    if (!compactGame) {
      mismatches.push("missing compact_games row");
    } else {
      const expectedGame = compactGameExpected(row, record);
      for (const [key, expected] of Object.entries(expectedGame)) {
        compareScalar(mismatches, `compact_games.${key}`, compactGame[key], expected);
      }
    }

    const expectedHands = handsFromEvents(record);
    const compactHands = selectCompactHands.all(row.game_id);
    compareScalar(mismatches, "compact_hands.count", compactHands.length, expectedHands.length);
    for (let i = 0; i < Math.min(compactHands.length, expectedHands.length); i += 1) {
      const hand = expectedHands[i];
      const actual = compactHands[i];
      const expected = compactHand(record, hand);
      const pegSequence = pegSequenceBlob(record.events, expected.handNumber);
      compareScalar(mismatches, `hand ${expected.handNumber} hand_number`, actual.hand_number, expected.handNumber);
      compareScalar(mismatches, `hand ${expected.handNumber} dealer`, actual.dealer, expected.dealer);
      compareScalar(mismatches, `hand ${expected.handNumber} pone`, actual.pone, expected.pone);
      compareScalar(mismatches, `hand ${expected.handNumber} start_left_score`, actual.start_left_score, expected.startLeft);
      compareScalar(mismatches, `hand ${expected.handNumber} start_right_score`, actual.start_right_score, expected.startRight);
      compareScalar(mismatches, `hand ${expected.handNumber} end_left_score`, actual.end_left_score, expected.endLeft);
      compareScalar(mismatches, `hand ${expected.handNumber} end_right_score`, actual.end_right_score, expected.endRight);
      compareScalar(mismatches, `hand ${expected.handNumber} cut_card`, actual.cut_card, expected.cut);
      compareScalar(mismatches, `hand ${expected.handNumber} left_pegging_points`, actual.left_pegging_points, expected.leftPegging);
      compareScalar(mismatches, `hand ${expected.handNumber} right_pegging_points`, actual.right_pegging_points, expected.rightPegging);
      compareScalar(mismatches, `hand ${expected.handNumber} left_hand_points`, actual.left_hand_points, expected.leftHand);
      compareScalar(mismatches, `hand ${expected.handNumber} right_hand_points`, actual.right_hand_points, expected.rightHand);
      compareScalar(mismatches, `hand ${expected.handNumber} crib_points`, actual.crib_points, expected.crib);
      for (const [label, actualBlob, expectedBlob] of [
        ["left_dealt", actual.left_dealt, expected.leftDealt],
        ["right_dealt", actual.right_dealt, expected.rightDealt],
        ["left_keep", actual.left_keep, expected.leftKeep],
        ["right_keep", actual.right_keep, expected.rightKeep],
        ["crib", actual.crib, expected.cribCards],
        ["peg_sequence", actual.peg_sequence, pegSequence],
      ]) {
        if (!sameBlob(actualBlob, expectedBlob)) {
          mismatches.push(`hand ${expected.handNumber} ${label}: blob mismatch`);
        }
      }
    }
    checkedGames += 1;
    checkedHands += expectedHands.length;
    if (mismatches.length) {
      mismatchedGames += 1;
      if (samples.length < sampleMismatchLimit) {
        samples.push({ gameId: row.game_id, mismatches: mismatches.slice(0, 20) });
      }
    }
  }
  process.stdout.write(`verified ${Math.min(offset + rows.length, total)}/${total} games\r`);
}
process.stdout.write("\n");
db.close();

const result = {
  dbPath: path.relative(root, dbPath),
  checkedGames,
  checkedHands,
  mismatchedGames,
  ok: mismatchedGames === 0,
  samples,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
