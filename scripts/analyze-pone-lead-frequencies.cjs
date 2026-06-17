#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const PLAY_ACTION = 0;
const DEFAULT_MODELS = [
  "schell_table-peg_table-7.0",
  "schell_table-peg_table-8.0",
  "schell_table-peg_table-9.0",
  "schell_table-peg_table-10.0",
  "schell_table-peg_table-11.0",
  "schell_table-peg_table-11.1",
  "schell_table-peg_table-12.0",
];

function parseArgs(argv) {
  const args = {
    db: path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite"),
    out: path.join(root, "web", "src", "models", "schell_table-peg_table-13.0", "pone-lead-frequency.json"),
    workers: Math.max(1, Math.min(6, os.cpus().length - 2 || 1)),
    limit: 0,
    models: DEFAULT_MODELS,
    includeExcluded: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--db") args.db = path.resolve(root, next());
    else if (arg === "--out") args.out = path.resolve(root, next());
    else if (arg === "--workers") args.workers = Number.parseInt(next(), 10);
    else if (arg === "--limit") args.limit = Number.parseInt(next(), 10);
    else if (arg === "--models") args.models = next().split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--include-excluded") args.includeExcluded = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node --experimental-sqlite scripts/analyze-pone-lead-frequencies.cjs [options]

Options:
  --db <path>          SQLite compact game DB
  --out <path>         Output JSON path
  --workers <n>        Worker threads for parallel DB scans
  --limit <n>          Sample at most n compact_hands rows
  --models <csv>       Included engines; default is flush-aware 7.0+ engines
  --include-excluded   Include games marked included_in_tables = 0
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.workers) || args.workers < 1) args.workers = 1;
  args.workers = Math.floor(args.workers);
  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = 0;
  return args;
}

function cardRank(byte) {
  return Number.isInteger(byte) && byte >= 0 && byte < 52 ? Math.floor(byte / 4) : null;
}

function rankCounts(blob) {
  const counts = Array(13).fill(0);
  if (!blob) return counts;
  for (const byte of Buffer.from(blob)) {
    const rank = cardRank(byte);
    if (rank !== null) counts[rank] += 1;
  }
  return counts;
}

function rankCountKey(blob) {
  return rankCounts(blob).join("");
}

function firstPlayedRank(blob, player) {
  if (!blob) return null;
  const bytes = Buffer.from(blob);
  for (let offset = 0; offset + 4 < bytes.length; offset += 5) {
    if (bytes[offset] !== PLAY_ACTION || bytes[offset + 1] !== player) continue;
    return cardRank(bytes[offset + 2]);
  }
  return null;
}

function newAggregate() {
  return { handsSeen: 0, poneHandsSeen: 0, poneHandsWithLead: 0, keeps: {} };
}

function tally(aggregate, keepBlob, pegSequenceBlob, ponePlayer) {
  aggregate.poneHandsSeen += 1;
  const lead = firstPlayedRank(pegSequenceBlob, ponePlayer);
  if (lead === null) return;
  const key = rankCountKey(keepBlob);
  const bucket = aggregate.keeps[key] ??= { samples: 0, leads: Array(13).fill(0) };
  bucket.samples += 1;
  bucket.leads[lead] += 1;
  aggregate.poneHandsWithLead += 1;
}

function mergeAggregate(target, source) {
  target.handsSeen += source.handsSeen;
  target.poneHandsSeen += source.poneHandsSeen;
  target.poneHandsWithLead += source.poneHandsWithLead;
  for (const [key, sourceBucket] of Object.entries(source.keeps)) {
    const targetBucket = target.keeps[key] ??= { samples: 0, leads: Array(13).fill(0) };
    targetBucket.samples += sourceBucket.samples;
    for (let rank = 0; rank < 13; rank += 1) targetBucket.leads[rank] += sourceBucket.leads[rank];
  }
}

function modelPlaceholders(models) {
  return models.map(() => "?").join(",");
}

function rowBounds(db, args) {
  const where = [
    `g.left_engine IN (${modelPlaceholders(args.models)})`,
    `g.right_engine IN (${modelPlaceholders(args.models)})`,
  ];
  const params = [...args.models, ...args.models];
  if (!args.includeExcluded) where.push("g.included_in_tables = 1");
  return db.prepare(`
    SELECT min(h.rowid) AS minRowid, max(h.rowid) AS maxRowid, count(*) AS rows
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    WHERE ${where.join(" AND ")}
  `).get(...params);
}

function scanRows(db, args, minRowid, maxRowid) {
  const aggregate = newAggregate();
  const where = [
    `g.left_engine IN (${modelPlaceholders(args.models)})`,
    `g.right_engine IN (${modelPlaceholders(args.models)})`,
    "h.rowid BETWEEN ? AND ?",
  ];
  const params = [...args.models, ...args.models, minRowid, maxRowid];
  if (!args.includeExcluded) where.push("g.included_in_tables = 1");
  const rows = db.prepare(`
    SELECT h.pone, h.left_keep, h.right_keep, h.peg_sequence
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    WHERE ${where.join(" AND ")}
    ORDER BY h.rowid
  `).all(...params);
  let processed = 0;
  for (const row of rows) {
    aggregate.handsSeen += 1;
    const poneKeep = row.pone === 0 ? row.left_keep : row.right_keep;
    tally(aggregate, poneKeep, row.peg_sequence, row.pone);
    processed += 1;
    if (args.limit && processed >= args.limit) break;
  }
  return { aggregate, processed };
}

function sourceRunSummary(db, args) {
  const where = [
    `left_engine IN (${modelPlaceholders(args.models)})`,
    `right_engine IN (${modelPlaceholders(args.models)})`,
  ];
  const params = [...args.models, ...args.models];
  if (!args.includeExcluded) where.push("included_in_tables = 1");
  return db.prepare(`
    SELECT run_id, matchup_id, left_engine, right_engine, count(*) AS games,
      min(game_index) AS minGameIndex, max(game_index) AS maxGameIndex
    FROM compact_games
    WHERE ${where.join(" AND ")}
    GROUP BY run_id, matchup_id, left_engine, right_engine
    ORDER BY run_id, matchup_id
  `).all(...params);
}

function finalize(aggregate, metadata) {
  const table = {};
  for (const [key, bucket] of Object.entries(aggregate.keeps).sort((a, b) => b[1].samples - a[1].samples || a[0].localeCompare(b[0]))) {
    const leads = {};
    for (let rank = 0; rank < 13; rank += 1) {
      if (!bucket.leads[rank]) continue;
      leads[RANKS[rank]] = {
        count: bucket.leads[rank],
        probability: bucket.leads[rank] / bucket.samples,
      };
    }
    const order = bucket.leads
      .map((count, rank) => ({ rank: RANKS[rank], count, probability: bucket.samples ? count / bucket.samples : 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.probability - a.probability || a.rank.localeCompare(b.rank));
    table[key] = { samples: bucket.samples, leads, order };
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ranks: RANKS,
    semantics: "P(pone first pegging play rank | pone 4-card rank keep), using unordered rank-count keep keys in A,2,3,4,5,6,7,8,9,10,J,Q,K order.",
    filters: metadata.filters,
    sourceRuns: metadata.sourceRuns,
    totals: {
      compactHandsSeen: aggregate.handsSeen,
      poneHandsSeen: aggregate.poneHandsSeen,
      poneHandsWithLead: aggregate.poneHandsWithLead,
      keepBuckets: Object.keys(aggregate.keeps).length,
    },
    table,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runMain() {
  const { DatabaseSync } = require("node:sqlite");
  const args = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(args.db, { readOnly: true });
  const bounds = rowBounds(db, args);
  const sourceRuns = sourceRunSummary(db, args);
  db.close();
  if (!bounds?.rows) throw new Error("No compact hands matched the selected filters.");
  const totalRows = args.limit ? Math.min(args.limit, bounds.rows) : bounds.rows;
  const span = Math.max(1, bounds.maxRowid - bounds.minRowid + 1);
  const workerCount = Math.max(1, Math.min(args.workers, totalRows));
  const chunks = [];
  for (let index = 0; index < workerCount; index += 1) {
    const start = bounds.minRowid + Math.floor((span * index) / workerCount);
    const end = bounds.minRowid + Math.floor((span * (index + 1)) / workerCount) - 1;
    chunks.push({ minRowid: start, maxRowid: Math.max(start, end), limit: args.limit ? Math.ceil(args.limit / workerCount) : 0 });
  }

  const results = await Promise.all(chunks.map((chunk, workerIndex) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { args: { ...args, limit: chunk.limit }, minRowid: chunk.minRowid, maxRowid: chunk.maxRowid, workerIndex },
    });
    worker.on("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  })));
  const aggregate = newAggregate();
  let completedRows = 0;
  for (const result of results) {
    mergeAggregate(aggregate, result.aggregate);
    completedRows += result.processed;
  }
  const output = finalize(aggregate, {
    filters: {
      dbPath: path.relative(root, args.db),
      models: args.models,
      includeExcluded: args.includeExcluded,
      limit: args.limit || null,
      compactHandRowsMatched: bounds.rows,
    },
    sourceRuns,
  });
  writeJson(args.out, output);
  console.log(JSON.stringify({ out: args.out, completedRows, totals: output.totals }, null, 2));
}

function runWorker() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(workerData.args.db, { readOnly: true });
  const result = scanRows(db, workerData.args, workerData.minRowid, workerData.maxRowid);
  db.close();
  parentPort.postMessage(result);
}

if (isMainThread) {
  runMain().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker();
}
