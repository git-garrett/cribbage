#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && String(warning.message).includes("SQLite")) return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");

function usage() {
  return [
    "Usage: node scripts/analyze-ai-run.cjs [run-id[,run-id...]] [additional-run-id...] [--db <path>] [--json]",
    "",
    "If run-id is omitted, the most recently started compact AI run is used.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    runIds: [],
    dbPath: process.env.AI_SMOKE_GAME_DB_PATH || defaultDbPath,
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else if (arg === "--db") {
      args.dbPath = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (!arg.startsWith("--")) {
      args.runIds.push(...arg.split(",").map((runId) => runId.trim()).filter(Boolean));
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  args.dbPath = path.resolve(root, args.dbPath);
  return args;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + (p * abs));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-(abs ** 2));
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function confidenceFromZ(z, leaderIsPositive = true) {
  if (!Number.isFinite(z)) return 0.5;
  const signed = leaderIsPositive ? z : -z;
  return normalCdf(signed);
}

function binomialConfidence(wins, games) {
  if (!games) return { z: 0, confidence: 0.5 };
  const p = wins / games;
  const se = Math.sqrt(0.25 / games);
  const z = se ? (p - 0.5) / se : 0;
  return { z, confidence: normalCdf(Math.abs(z)) };
}

function meanComparison(leftValues, rightValues) {
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  const leftVariance = variance(leftValues);
  const rightVariance = variance(rightValues);
  const se = Math.sqrt(
    (leftValues.length ? leftVariance / leftValues.length : 0) +
    (rightValues.length ? rightVariance / rightValues.length : 0),
  );
  const diff = rightMean - leftMean;
  const z = se ? diff / se : 0;
  return {
    leftMean,
    rightMean,
    diff,
    z,
    confidence: confidenceFromZ(Math.abs(z)),
  };
}

function fmt(value, digits = 3) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function signed(value, digits = 3) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function table(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(row[index]).length),
  ));
  const line = headers.map((header, index) => pad(header, widths[index])).join("  ");
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  return [line, rule, ...rows.map((row) => row.map((cell, index) => pad(cell, widths[index])).join("  "))].join("\n");
}

function latestRunId(db) {
  const row = db.prepare(`
    SELECT g.run_id AS run_id, max(coalesce(r.started_at, g.created_at)) AS started_at
    FROM compact_games g
    LEFT JOIN ai_runs r ON r.run_id = g.run_id
    GROUP BY g.run_id
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  return row?.run_id ?? null;
}

function statusForRun(run) {
  if (!run?.out_dir) return null;
  const statusPath = path.resolve(root, run.out_dir, "status.json");
  if (!fs.existsSync(statusPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return null;
  }
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function modelForSide(game, side) {
  return side === 0 ? game.left_engine : game.right_engine;
}

function sideScore(row, side, key) {
  return side === 0 ? row[`left_${key}`] : row[`right_${key}`];
}

function scoreSamplesByModel(games, hands) {
  const byModel = new Map();
  function bucket(model) {
    if (!byModel.has(model)) {
      byModel.set(model, {
        gameScore: [],
        margin: [],
        peggingDealer: [],
        peggingPone: [],
        handDealer: [],
        handPone: [],
        crib: [],
        availablePeggingDealer: [],
        availablePeggingPone: [],
        availableHandDealer: [],
        availableHandPone: [],
        availableCrib: [],
      });
    }
    return byModel.get(model);
  }

  for (const game of games) {
    bucket(game.left_engine).gameScore.push(game.final_left_score);
    bucket(game.left_engine).margin.push(game.final_left_score - game.final_right_score);
    bucket(game.right_engine).gameScore.push(game.final_right_score);
    bucket(game.right_engine).margin.push(game.final_right_score - game.final_left_score);
  }

  for (const hand of hands) {
    for (const side of [0, 1]) {
      const model = modelForSide(hand, side);
      const samples = bucket(model);
      const pegging = sideScore(hand, side, "pegging_points") ?? 0;
      const handPoints = sideScore(hand, side, "hand_points") ?? 0;
      const availablePegging = sideScore(hand, side, "available_pegging_points") ?? 0;
      const availableHandPoints = sideScore(hand, side, "available_hand_points") ?? 0;
      if (hand.dealer === side) {
        samples.peggingDealer.push(pegging);
        samples.handDealer.push(handPoints);
        samples.crib.push(hand.crib_points ?? 0);
        samples.availablePeggingDealer.push(availablePegging);
        samples.availableHandDealer.push(availableHandPoints);
        samples.availableCrib.push(hand.available_crib_points ?? 0);
      } else {
        samples.peggingPone.push(pegging);
        samples.handPone.push(handPoints);
        samples.availablePeggingPone.push(availablePegging);
        samples.availableHandPone.push(availableHandPoints);
      }
    }
  }
  return byModel;
}

function completedDecisionHands(games, hands) {
  const maxHandByGame = new Map();
  for (const hand of hands) {
    const current = maxHandByGame.get(hand.game_id) ?? -1;
    if (hand.hand_number > current) maxHandByGame.set(hand.game_id, hand.hand_number);
  }
  const included = new Set();
  for (const hand of hands) {
    if (hand.hand_number < maxHandByGame.get(hand.game_id)) {
      included.add(`${hand.game_id}:${hand.hand_number}`);
    }
  }
  return {
    included,
    excludedFinalHands: games.length,
  };
}

function evCalibration(db, runIds, completedHands) {
  const runPlaceholders = placeholders(runIds);
  const discards = db.prepare(`
    SELECT
      d.game_id,
      d.hand_number,
      d.player,
      d.role,
      d.model,
      d.selected_ev,
      h.left_pegging_points,
      h.right_pegging_points,
      h.left_hand_points,
      h.right_hand_points,
      h.crib_points
    FROM compact_discards d
    JOIN compact_hands h ON h.game_id = d.game_id AND h.hand_number = d.hand_number
    JOIN compact_games g ON g.game_id = d.game_id
    WHERE g.run_id IN (${runPlaceholders}) AND d.selected_ev IS NOT NULL
  `).all(...runIds);
  const pegRows = db.prepare(`
    SELECT
      p.game_id,
      p.hand_number,
      p.sequence,
      p.player,
      p.role,
      p.model,
      p.selected_ev,
      p.action,
      p.count_after,
      p.points
    FROM compact_peg_plays p
    JOIN compact_games g ON g.game_id = p.game_id
    WHERE g.run_id IN (${runPlaceholders}) AND p.selected_ev IS NOT NULL AND p.action = 0
    ORDER BY p.game_id, p.hand_number, p.sequence
  `).all(...runIds);
  const pegAllRows = db.prepare(`
    SELECT
      p.game_id,
      p.hand_number,
      p.sequence,
      p.player,
      p.action,
      p.count_after,
      p.points
    FROM compact_peg_plays p
    JOIN compact_games g ON g.game_id = p.game_id
    WHERE g.run_id IN (${runPlaceholders})
    ORDER BY p.game_id, p.hand_number, p.sequence
  `).all(...runIds);

  const pegRowsByHand = new Map();
  for (const row of pegAllRows) {
    const key = `${row.game_id}:${row.hand_number}`;
    if (!pegRowsByHand.has(key)) pegRowsByHand.set(key, []);
    pegRowsByHand.get(key).push(row);
  }
  const futureNetPegging = new Map();
  for (const rows of pegRowsByHand.values()) {
    const awards = peggingAwardsForHand(rows);
    for (const decision of rows) {
      if (decision.action !== 0 || decision.player === null || decision.player === undefined) continue;
      let realized = 0;
      for (const award of awards) {
        if (award.sequence < decision.sequence) continue;
        realized += award.player === decision.player ? award.points : -award.points;
      }
      futureNetPegging.set(`${decision.game_id}:${decision.hand_number}:${decision.sequence}:${decision.player}`, realized);
    }
  }

  const buckets = new Map();
  const skipped = {
    discardFinalHand: 0,
    pegFinalHand: 0,
  };
  function add(kind, model, role, ev, realized) {
    const key = `${kind}:${role}:${model}`;
    if (!buckets.has(key)) {
      buckets.set(key, { kind, model, role, rows: 0, ev: [], realized: [], error: [] });
    }
    const bucket = buckets.get(key);
    bucket.rows += 1;
    bucket.ev.push(ev);
    bucket.realized.push(realized);
    bucket.error.push(realized - ev);
  }

  for (const row of discards) {
    const key = `${row.game_id}:${row.hand_number}`;
    if (!completedHands.included.has(key)) {
      skipped.discardFinalHand += 1;
      continue;
    }
    const ownHand = row.player === 0 ? row.left_hand_points : row.right_hand_points;
    const netPegging = row.player === 0
      ? row.left_pegging_points - row.right_pegging_points
      : row.right_pegging_points - row.left_pegging_points;
    const cribEffect = row.role === 1 ? row.crib_points : -row.crib_points;
    add("discard_total", row.model, row.role === 1 ? "dealer" : "pone", row.selected_ev, ownHand + cribEffect + netPegging);
  }

  for (const row of pegRows) {
    const key = `${row.game_id}:${row.hand_number}`;
    if (!completedHands.included.has(key)) {
      skipped.pegFinalHand += 1;
      continue;
    }
    const realized = futureNetPegging.get(`${row.game_id}:${row.hand_number}:${row.sequence}:${row.player}`);
    if (realized === undefined) continue;
    add("peg_future", row.model, row.role === 1 ? "dealer" : "pone", row.selected_ev, realized);
  }

  return {
    buckets: [...buckets.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.role.localeCompare(b.role) || a.model.localeCompare(b.model)),
    skipped,
  };
}

function peggingAwardsForHand(rows) {
  const awards = [];
  let lastPlayer = null;
  let count = 0;
  let terminalSequence = 0;

  for (const row of rows) {
    terminalSequence = Math.max(terminalSequence, row.sequence + 1);
    if (row.action === 0) {
      if (row.player !== null && row.player !== undefined) {
        const points = row.points ?? 0;
        if (points) awards.push({ sequence: row.sequence, player: row.player, points });
        lastPlayer = row.player;
      }
      count = row.count_after ?? count;
    } else if (row.action === 1) {
      count = row.count_after ?? count;
    } else if (row.action === 2) {
      if (lastPlayer !== null && lastPlayer !== undefined && count > 0 && count !== 31) {
        awards.push({ sequence: row.sequence, player: lastPlayer, points: 1 });
      }
      lastPlayer = null;
      count = 0;
    }
  }

  if (lastPlayer !== null && lastPlayer !== undefined && count > 0 && count !== 31) {
    awards.push({ sequence: terminalSequence, player: lastPlayer, points: 1 });
  }
  return awards;
}

function summarizeEv(bucket) {
  const avgEv = mean(bucket.ev);
  const avgRealized = mean(bucket.realized);
  const avgError = mean(bucket.error);
  return {
    kind: bucket.kind,
    model: bucket.model,
    role: bucket.role,
    rows: bucket.rows,
    avgEv,
    avgRealized,
    avgError,
    meanAbsError: mean(bucket.error.map((value) => Math.abs(value))),
  };
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function decisionTiming(db, runIds) {
  const hasDiscardTiming = hasColumn(db, "compact_discards", "decision_elapsed_us");
  const hasPeggingTiming = hasColumn(db, "compact_peg_plays", "decision_elapsed_us");
  if (!hasDiscardTiming && !hasPeggingTiming) {
    return {
      note: "Compact decision rows do not have decision_elapsed_us yet.",
      rows: [],
    };
  }
  const runPlaceholders = placeholders(runIds);
  const rows = [];
  if (hasDiscardTiming) {
    for (const row of db.prepare(`
      SELECT
        'discard' AS kind,
        d.role,
        d.model,
        d.decision_elapsed_us
      FROM compact_discards d
      JOIN compact_games g ON g.game_id = d.game_id
      WHERE g.run_id IN (${runPlaceholders})
        AND d.decision_elapsed_us IS NOT NULL
    `).all(...runIds)) {
      rows.push(row);
    }
  }
  if (hasPeggingTiming) {
    for (const row of db.prepare(`
      SELECT
        'pegging' AS kind,
        p.role,
        p.model,
        p.decision_elapsed_us
      FROM compact_peg_plays p
      JOIN compact_games g ON g.game_id = p.game_id
      WHERE g.run_id IN (${runPlaceholders})
        AND p.decision_elapsed_us IS NOT NULL
        AND p.model IS NOT NULL
        AND p.role IS NOT NULL
    `).all(...runIds)) {
      rows.push(row);
    }
  }

  const buckets = new Map();
  for (const row of rows) {
    const role = row.role === 1 ? "dealer" : "pone";
    const key = `${row.kind}:${role}:${row.model}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        kind: row.kind,
        role,
        model: row.model,
        values: [],
      });
    }
    const value = Number(row.decision_elapsed_us);
    if (Number.isFinite(value)) buckets.get(key).values.push(value);
  }

  return {
    note: "Decision timing measures Rust model decision calls only; forced no-model rows are stored as NULL and excluded.",
    rows: [...buckets.values()]
      .map((bucket) => ({
        kind: bucket.kind,
        role: bucket.role,
        model: bucket.model,
        rows: bucket.values.length,
        avgMs: mean(bucket.values) / 1000,
        p50Ms: percentile(bucket.values, 0.5) / 1000,
        p90Ms: percentile(bucket.values, 0.9) / 1000,
        maxMs: bucket.values.reduce((maximum, value) => Math.max(maximum, value), 0) / 1000,
        totalSeconds: bucket.values.reduce((sum, value) => sum + value, 0) / 1_000_000,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.role.localeCompare(b.role) || a.model.localeCompare(b.model)),
  };
}

function summarizeWinProbabilityBucket(bucket) {
  const avgPredicted = mean(bucket.predicted);
  const actualWinRate = mean(bucket.actual);
  const errors = bucket.actual.map((actual, index) => actual - bucket.predicted[index]);
  return {
    kind: bucket.kind,
    model: bucket.model,
    role: bucket.role,
    bucket: bucket.bucket,
    rows: bucket.predicted.length,
    avgPredicted,
    actualWinRate,
    miss: actualWinRate - avgPredicted,
    brier: mean(errors.map((error) => error ** 2)),
    meanAbsError: mean(errors.map((error) => Math.abs(error))),
  };
}

function winProbabilityCalibration(db, runIds) {
  const hasDiscardWinProbability = hasColumn(db, "compact_discards", "selected_win_probability");
  const hasPeggingWinProbability = hasColumn(db, "compact_peg_plays", "selected_win_probability");
  if (!hasDiscardWinProbability && !hasPeggingWinProbability) {
    return {
      note: "Compact decision rows do not have selected_win_probability yet.",
      rows: [],
      buckets: [],
    };
  }
  const runPlaceholders = placeholders(runIds);
  const rows = [];
  if (hasDiscardWinProbability) {
    for (const row of db.prepare(`
      SELECT
        'discard' AS kind,
        d.game_id,
        d.player,
        d.role,
        d.model,
        d.selected_win_probability AS selected_win_probability,
        g.winner
      FROM compact_discards d
      JOIN compact_games g ON g.game_id = d.game_id
      WHERE g.run_id IN (${runPlaceholders})
        AND d.selected_win_probability IS NOT NULL
        AND g.winner IS NOT NULL
    `).all(...runIds)) {
      rows.push(row);
    }
  }
  if (hasPeggingWinProbability) {
    for (const row of db.prepare(`
      SELECT
        'pegging' AS kind,
        p.game_id,
        p.player,
        p.role,
        p.model,
        p.selected_win_probability AS selected_win_probability,
        g.winner
      FROM compact_peg_plays p
      JOIN compact_games g ON g.game_id = p.game_id
      WHERE g.run_id IN (${runPlaceholders})
        AND p.action = 0
        AND COALESCE(p.legal_count, 0) > 1
        AND p.selected_win_probability IS NOT NULL
        AND p.player IS NOT NULL
        AND g.winner IS NOT NULL
    `).all(...runIds)) {
      rows.push(row);
    }
  }

  const summaries = new Map();
  const buckets = new Map();
  function add(target, key, row, bucketLabel = null) {
    if (!target.has(key)) {
      target.set(key, {
        kind: row.kind,
        model: row.model,
        role: row.role === 1 ? "dealer" : "pone",
        bucket: bucketLabel,
        predicted: [],
        actual: [],
      });
    }
    const item = target.get(key);
    const predicted = Math.max(0, Math.min(1, row.selected_win_probability));
    item.predicted.push(predicted);
    item.actual.push(row.winner === row.player ? 1 : 0);
  }

  for (const row of rows) {
    const role = row.role === 1 ? "dealer" : "pone";
    add(summaries, `${row.kind}:${row.model}:${role}`, row);
    const predicted = Math.max(0, Math.min(1, row.selected_win_probability));
    const bucketIndex = Math.min(9, Math.floor(predicted * 10));
    const bucketLabel = `${(bucketIndex / 10).toFixed(1)}-${((bucketIndex + 1) / 10).toFixed(1)}`;
    add(buckets, `${row.kind}:${row.model}:${role}:${bucketLabel}`, row, bucketLabel);
  }

  return {
    note: "Win-probability calibration compares each model decision's selected predicted win probability to the eventual game result from that player's perspective.",
    rows: [...summaries.values()]
      .map(summarizeWinProbabilityBucket)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.role.localeCompare(b.role) || a.model.localeCompare(b.model)),
    buckets: [...buckets.values()]
      .map(summarizeWinProbabilityBucket)
      .sort((a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.model.localeCompare(b.model) ||
        a.role.localeCompare(b.role) ||
        a.bucket.localeCompare(b.bucket)),
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.dbPath)) throw new Error(`SQLite database not found: ${args.dbPath}`);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(args.dbPath, { readOnly: true });
  const runIds = args.runIds.length ? args.runIds : [latestRunId(db)].filter(Boolean);
  if (!runIds.length) throw new Error("No compact AI runs found.");
  const runPlaceholders = placeholders(runIds);

  const runs = db.prepare(`SELECT * FROM ai_runs WHERE run_id IN (${runPlaceholders})`).all(...runIds);
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  const games = db.prepare(`SELECT * FROM compact_games WHERE run_id IN (${runPlaceholders}) ORDER BY run_id, game_index`).all(...runIds);
  if (!games.length) throw new Error(`No compact games found for run(s): ${runIds.join(", ")}`);
  const hands = db.prepare(`
    SELECT h.*, g.left_engine, g.right_engine
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    WHERE g.run_id IN (${runPlaceholders})
    ORDER BY g.run_id, h.game_id, h.hand_number
  `).all(...runIds);

  const models = [...new Set(games.flatMap((game) => [game.left_engine, game.right_engine]))];
  if (models.length !== 2) {
    throw new Error(`Expected a two-model run; found ${models.length}: ${models.join(", ")}`);
  }
  const [leftModel, rightModel] = [games[0].left_engine, games[0].right_engine];
  const runStatuses = runIds.map((runId) => ({
    runId,
    status: statusForRun(runsById.get(runId) ?? { run_id: runId }),
  }));
  const status = runIds.length === 1 ? runStatuses[0]?.status ?? null : null;
  const scores = scoreSamplesByModel(games, hands);
  const completedHands = completedDecisionHands(games, hands);
  const ev = evCalibration(db, runIds, completedHands);
  const winProbability = winProbabilityCalibration(db, runIds);
  const timing = decisionTiming(db, runIds);
  db.close();

  const rightWins = games.filter((game) => game.winner === 1).length;
  const leftWins = games.filter((game) => game.winner === 0).length;
  const winConfidence = binomialConfidence(rightWins, games.length);
  const scoreMetrics = [
    ["Final score", "gameScore"],
    ["Margin", "margin"],
    ["Peg dealer", "peggingDealer"],
    ["Peg pone", "peggingPone"],
    ["Hand dealer", "handDealer"],
    ["Hand pone", "handPone"],
    ["Crib", "crib"],
  ];
  const availableScoreMetrics = [
    ["Available peg dealer", "availablePeggingDealer"],
    ["Available peg pone", "availablePeggingPone"],
    ["Available hand dealer", "availableHandDealer"],
    ["Available hand pone", "availableHandPone"],
    ["Available crib", "availableCrib"],
  ];
  const scoring = scoreMetrics.map(([label, key]) => {
    const leftValues = scores.get(leftModel)?.[key] ?? [];
    const rightValues = scores.get(rightModel)?.[key] ?? [];
    return { label, key, leftN: leftValues.length, rightN: rightValues.length, ...meanComparison(leftValues, rightValues) };
  });
  const availableEventScoring = availableScoreMetrics.map(([label, key]) => {
    const leftValues = scores.get(leftModel)?.[key] ?? [];
    const rightValues = scores.get(rightModel)?.[key] ?? [];
    return { label, key, leftN: leftValues.length, rightN: rightValues.length, ...meanComparison(leftValues, rightValues) };
  });
  const hasAvailableEventScoring = availableEventScoring.some((row) => row.leftMean !== 0 || row.rightMean !== 0);
  const evRows = ev.buckets.map(summarizeEv);

  const report = {
    runId: runIds.join(","),
    runIds,
    dbPath: path.relative(root, args.dbPath),
    status,
    runStatuses,
    matchup: { leftModel, rightModel },
    games: games.length,
    wins: { [leftModel]: leftWins, [rightModel]: rightWins },
    winRate: { [leftModel]: leftWins / games.length, [rightModel]: rightWins / games.length },
    winConfidence,
    scoring,
    availableEventScoring: hasAvailableEventScoring ? {
      note: "Available-event scoring credits the full scoring event that ended the game, even if it overkills 121, while excluding later hypothetical scoring events.",
      rows: availableEventScoring,
    } : null,
    ev: {
      note: "EV calibration excludes all decisions from each game's final hand so end-of-game cutoffs do not count skipped future value as realized zero.",
      componentNote: "Compact rows store total discard EV and future net pegging-decision EV, not separate hand/crib/peg EV components.",
      excluded: ev.skipped,
      rows: evRows,
    },
    timing,
    winProbability,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push(`${runIds.length === 1 ? "Run" : "Runs"}: ${runIds.join(", ")}`);
  lines.push(`DB: ${report.dbPath}`);
  lines.push(`Matchup: ${leftModel} vs ${rightModel}`);
  if (status) {
    lines.push(`Status: ${status.status}; saved ${status.savedGames ?? games.length}/${status.totalGames ?? "?"}; completed ${status.completedGames ?? games.length}/${status.totalGames ?? "?"}`);
    if (status.gamesPerSecond) lines.push(`Speed: ${fmt(status.gamesPerSecond, 3)} games/sec`);
    if (status.expectedCompletionAt) lines.push(`Expected completion: ${new Date(status.expectedCompletionAt).toLocaleString()}`);
  }
  lines.push("");
  lines.push(table(
    ["Model", "Wins", "Win rate"],
    [
      [leftModel, leftWins, pct(leftWins / games.length)],
      [rightModel, rightWins, pct(rightWins / games.length)],
    ],
  ));
  const winLeader = rightWins >= leftWins ? rightModel : leftModel;
  lines.push(`Win confidence leader: ${winLeader} at ${pct(winConfidence.confidence)} (normal approximation to binomial).`);
  lines.push("");
  if (timing.rows.length) {
    lines.push("Decision timing note: Rust model decision calls only; forced no-model rows are excluded.");
    lines.push(table(
      ["Kind", "Role", "Model", "Rows", "Avg ms", "P50 ms", "P90 ms", "Max ms", "Total sec"],
      timing.rows.map((row) => [
        row.kind,
        row.role,
        row.model,
        row.rows,
        fmt(row.avgMs, 3),
        fmt(row.p50Ms, 3),
        fmt(row.p90Ms, 3),
        fmt(row.maxMs, 3),
        fmt(row.totalSeconds, 3),
      ]),
    ));
    lines.push("");
  }
  lines.push(table(
    ["Metric", `${leftModel} avg`, "N", `${rightModel} avg`, "N", `${rightModel} - ${leftModel}`, "Leader", "Leader confidence"],
    scoring.map((row) => [
      row.label,
      fmt(row.leftMean),
      row.leftN,
      fmt(row.rightMean),
      row.rightN,
      signed(row.diff),
      row.diff >= 0 ? rightModel : leftModel,
      pct(row.confidence),
    ]),
  ));
  lines.push("");
  if (hasAvailableEventScoring) {
    lines.push("Available-event scoring note: credits the full scoring event that ended the game, even if it overkills 121, while excluding later hypothetical scoring events.");
    lines.push(table(
      ["Metric", `${leftModel} avg`, "N", `${rightModel} avg`, "N", `${rightModel} - ${leftModel}`, "Leader", "Leader confidence"],
      availableEventScoring.map((row) => [
        row.label,
        fmt(row.leftMean),
        row.leftN,
        fmt(row.rightMean),
        row.rightN,
        signed(row.diff),
        row.diff >= 0 ? rightModel : leftModel,
        pct(row.confidence),
      ]),
    ));
    lines.push("");
  }
  lines.push("EV calibration note: excludes every decision from each game's final hand so end-of-game cutoffs do not count skipped future value as realized zero.");
  lines.push("EV component note: compact rows currently store total discard EV and future net pegging-decision EV, not separate hand/crib/peg EV components.");
  lines.push(`Excluded final-hand EV rows: discard ${ev.skipped.discardFinalHand}, peg ${ev.skipped.pegFinalHand}`);
  lines.push(table(
    ["Kind", "Role", "Model", "Rows", "Avg EV", "Avg realized", "Realized - EV", "Mean abs error"],
    evRows.map((row) => [
      row.kind,
      row.role,
      row.model,
      row.rows,
      fmt(row.avgEv),
      fmt(row.avgRealized),
      signed(row.avgError),
      fmt(row.meanAbsError),
    ]),
  ));
  lines.push("");
  lines.push("Win-probability calibration note: compares selected decision win probability to the eventual game result from that player's perspective.");
  if (!winProbability.rows.length) {
    lines.push("No decision win-probability rows found for these run(s). Rows recorded before this logging change are expected to be empty.");
  } else {
    lines.push(table(
      ["Kind", "Role", "Model", "Rows", "Avg predicted", "Actual win rate", "Actual - Pred", "Brier", "Mean abs error"],
      winProbability.rows.map((row) => [
        row.kind,
        row.role,
        row.model,
        row.rows,
        pct(row.avgPredicted),
        pct(row.actualWinRate),
        signed(row.miss, 4),
        fmt(row.brier, 4),
        fmt(row.meanAbsError, 4),
      ]),
    ));
    lines.push("");
    lines.push(table(
      ["Kind", "Role", "Model", "Pred bucket", "Rows", "Avg predicted", "Actual win rate", "Actual - Pred", "Brier"],
      winProbability.buckets.map((row) => [
        row.kind,
        row.role,
        row.model,
        row.bucket,
        row.rows,
        pct(row.avgPredicted),
        pct(row.actualWinRate),
        signed(row.miss, 4),
        fmt(row.brier, 4),
      ]),
    ));
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
