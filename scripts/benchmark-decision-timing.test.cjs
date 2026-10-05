const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { decisionTiming } = require('./analyze-ai-run.cjs');
const { combineRows } = require('./report-paired-live-benchmark.cjs');

test('whole-hand pegging openings and totals retain forced plays and reset boundaries', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE compact_games (game_id TEXT, run_id TEXT);
      INSERT INTO compact_games VALUES ('g', 'r'), ('other', 'other-run');
      CREATE TABLE compact_discards (game_id TEXT, role INTEGER, model TEXT, decision_elapsed_us INTEGER);
      CREATE TABLE compact_peg_plays (game_id TEXT, hand_number INTEGER, sequence INTEGER,
        player INTEGER, role INTEGER, model TEXT, action INTEGER, count_before INTEGER,
        legal_count INTEGER, decision_elapsed_us INTEGER);`);
    const insert = db.prepare('INSERT INTO compact_peg_plays VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const play = (hand, seq, player, count, us, legal = 2) => insert.run('g', hand, seq, player, player, player ? 'B' : 'A', 0, count, legal, us);
    play(1, 0, 0, 0, 1000);
    play(1, 1, 1, 10, 2000);
    play(1, 2, 0, 20, 3000);
    insert.run('g', 1, 3, null, null, null, 2, 30, null, null);
    play(1, 4, 1, 0, 4000);
    play(1, 5, 0, 10, null, 1);
    play(1, 6, 1, 20, null, 1);
    // A forced opening must not promote the next timed card to an opening.
    play(2, 0, 0, 0, null, 1);
    play(2, 1, 1, 5, 6000);
    play(2, 2, 0, 10, 7000);
    // Unknown non-forced telemetry must not produce an understated total.
    play(3, 0, 0, 0, null, 2);
    play(3, 1, 0, 10, 9000);
    // An entirely forced series has zero model computation, not missing timing.
    play(4, 0, 0, 0, null, 1);
    insert.run('other', 1, 0, 0, 0, 'A', 0, 0, 2, 999999);
    const rows = decisionTiming(db, ['r']).rows;
    const row = (kind, model) => rows.find(r => r.kind === kind && r.model === model);
    assert.equal(row('peg_opening', 'A').rows, 1);
    assert.equal(row('peg_opening', 'A').avgMs, 1);
    assert.equal(row('peg_opening', 'B').avgMs, 4);
    assert.equal(row('peg_hand', 'A').rows, 3);
    assert.equal(row('peg_hand', 'A').totalSeconds, 0.011);
    assert.equal(row('peg_hand', 'B').avgMs, 6);
  } finally { db.close(); }
});

test('legacy databases without timing remain unavailable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE compact_discards (game_id TEXT); CREATE TABLE compact_peg_plays (game_id TEXT)');
    assert.deepEqual(decisionTiming(db, ['r']).rows, []);
  } finally { db.close(); }
});

test('paired timing weights means by sample count but sums elapsed totals', () => {
  const analyses = [
    { rows: [{kind:'peg_hand', role:'pone', model:'A', rows:2, avgMs:1000, totalSeconds:2}] },
    { rows: [{kind:'peg_hand', role:'pone', model:'A', rows:1, avgMs:4000, totalSeconds:4}] },
  ];
  const [row] = combineRows(analyses, a => a.rows, ['avgMs'], ['totalSeconds']);
  assert.equal(row.rows, 3);
  assert.equal(row.avgMs, 2000);
  assert.equal(row.totalSeconds, 6);
});
