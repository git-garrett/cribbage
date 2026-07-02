#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const defaultOutPath = path.join(root, "web", "src", "models", "rank-crib-discard", "empirical-discard-keep-14.8.json");
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const roles = ["pone", "dealer"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(root, args.db || defaultDbPath);
const outPath = path.resolve(root, args.output || defaultOutPath);
const minVersion = Number.parseFloat(args.minVersion ?? "7");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") parsed.db = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--min-version") parsed.minVersion = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node --experimental-sqlite scripts/build-empirical-discard-keep-table.cjs [options]

Options:
  --db <path>            Defaults to benchmarks/ai-db/cribbage-games.sqlite
  --output <path>        Defaults to web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json
  --min-version <n>      Minimum schell_table-peg_table model version, default 7
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function rankKey(counts) {
  return counts.join("");
}

function ranksFromBlob(blob) {
  return [...Buffer.from(blob || [])].map((id) => Math.floor(id / 4));
}

function suitsFromBlob(blob) {
  return [...Buffer.from(blob || [])].map((id) => id % 4);
}

function rankSetFromBlob(blob) {
  const counts = emptyRanks();
  for (const rank of ranksFromBlob(blob)) counts[rank] += 1;
  return counts;
}

function modelVersion(engine) {
  const match = String(engine || "").match(/^schell_table-peg_table-(\d+(?:\.\d+)*)$/);
  return match ? Number.parseFloat(match[1]) : Number.NaN;
}

function modelEligible(engine) {
  const version = modelVersion(engine);
  return Number.isFinite(version) && version >= minVersion;
}

function emptyRoleStats() {
  return {
    discardTotal: 0,
    keepTotal: 0,
    suitedDiscardTotal: 0,
    distinctDiscardTotal: 0,
    distinctSuitedDiscardTotal: 0,
    discards: {},
    keeps: {},
  };
}

function incrementDiscard(roleStats, cards) {
  const cardBytes = Buffer.from(cards || []);
  if (cardBytes.length !== 2) return false;
  const discardRanks = rankSetFromBlob(cardBytes);
  const key = rankKey(discardRanks);
  const suits = suitsFromBlob(cardBytes);
  const rankList = ranksFromBlob(cardBytes);
  const distinct = rankList[0] !== rankList[1];
  const suited = distinct && suits[0] === suits[1];
  const entry = roleStats.discards[key] || { count: 0, suitedCount: 0 };
  entry.count += 1;
  if (suited) entry.suitedCount += 1;
  roleStats.discards[key] = entry;
  roleStats.discardTotal += 1;
  if (suited) roleStats.suitedDiscardTotal += 1;
  if (distinct) {
    roleStats.distinctDiscardTotal += 1;
    if (suited) roleStats.distinctSuitedDiscardTotal += 1;
  }
  return true;
}

function incrementKeep(roleStats, remainingHand) {
  const cardBytes = Buffer.from(remainingHand || []);
  if (cardBytes.length !== 4) return false;
  const key = rankKey(rankSetFromBlob(cardBytes));
  roleStats.keeps[key] = (roleStats.keeps[key] || 0) + 1;
  roleStats.keepTotal += 1;
  return true;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function finalizeRole(roleStats) {
  const discards = {};
  for (const [key, entry] of Object.entries(roleStats.discards).sort(([a], [b]) => a.localeCompare(b))) {
    discards[key] = {
      count: entry.count,
      suitedCount: entry.suitedCount,
      suitedRate: entry.count ? Number((entry.suitedCount / entry.count).toFixed(8)) : 0,
    };
  }
  return {
    discardTotal: roleStats.discardTotal,
    keepTotal: roleStats.keepTotal,
    suitedDiscardTotal: roleStats.suitedDiscardTotal,
    distinctDiscardTotal: roleStats.distinctDiscardTotal,
    distinctSuitedDiscardTotal: roleStats.distinctSuitedDiscardTotal,
    suitedDiscardRate: roleStats.discardTotal
      ? Number((roleStats.suitedDiscardTotal / roleStats.discardTotal).toFixed(8))
      : 0,
    distinctSuitedDiscardRate: roleStats.distinctDiscardTotal
      ? Number((roleStats.distinctSuitedDiscardTotal / roleStats.distinctDiscardTotal).toFixed(8))
      : 0,
    discards,
    keeps: sortedObject(roleStats.keeps),
  };
}

function main() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT
      d.role,
      d.cards,
      d.remaining_hand,
      g.left_engine,
      g.right_engine
    FROM compact_discards d
    JOIN compact_games g ON g.game_id = d.game_id
    WHERE g.included_in_tables = 1
      AND d.cards IS NOT NULL
      AND d.remaining_hand IS NOT NULL
  `).all();

  const sourceGameRows = db.prepare(`
    SELECT left_engine, right_engine, COUNT(*) AS count
    FROM compact_games
    WHERE included_in_tables = 1
    GROUP BY left_engine, right_engine
  `).all();
  db.close();

  const roleStats = {
    pone: emptyRoleStats(),
    dealer: emptyRoleStats(),
  };
  const sourceModels = {};
  let sourceGameCount = 0;
  let sourceDiscardRows = 0;
  let discardedRows = 0;

  for (const row of sourceGameRows) {
    if (!modelEligible(row.left_engine) || !modelEligible(row.right_engine)) continue;
    sourceGameCount += row.count;
    sourceModels[row.left_engine] = (sourceModels[row.left_engine] || 0) + row.count;
    sourceModels[row.right_engine] = (sourceModels[row.right_engine] || 0) + row.count;
  }

  for (const row of rows) {
    if (!modelEligible(row.left_engine) || !modelEligible(row.right_engine)) {
      discardedRows += 1;
      continue;
    }
    const role = row.role === 1 ? "dealer" : "pone";
    const keepOk = incrementKeep(roleStats[role], row.remaining_hand);
    const discardOk = incrementDiscard(roleStats[role], row.cards);
    if (keepOk && discardOk) sourceDiscardRows += 1;
    else discardedRows += 1;
  }

  const artifact = {
    schemaVersion: 1,
    model: "schell_table-peg_table-14.8",
    generatedAt: new Date().toISOString(),
    source: "compact SQLite included games where both engines are schell_table-peg_table models at or above the configured minimum version",
    dbPath: path.relative(root, dbPath),
    filters: {
      minVersion,
      includedInTables: true,
      bothEnginesRequired: true,
    },
    ranks,
    roles: Object.fromEntries(roles.map((role) => [role, finalizeRole(roleStats[role])])),
    sourceGameCount,
    sourceDiscardRows,
    skippedDiscardRows: discardedRows,
    sourceModels: sortedObject(sourceModels),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "complete",
    output: path.relative(root, outPath),
    sourceGameCount,
    sourceDiscardRows,
    dealerDiscards: artifact.roles.dealer.discardTotal,
    poneDiscards: artifact.roles.pone.discardTotal,
    dealerKeeps: artifact.roles.dealer.keepTotal,
    poneKeeps: artifact.roles.pone.keepTotal,
    dealerSuitedDiscardRate: artifact.roles.dealer.suitedDiscardRate,
    poneSuitedDiscardRate: artifact.roles.pone.suitedDiscardRate,
  }, null, 2));
}

main();
