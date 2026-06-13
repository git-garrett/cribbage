#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const args = process.argv.slice(2);

function usage() {
  console.error([
    "Usage:",
    "  node scripts/mark-ai-record.cjs run <run-id> --include 0|1 [--note text] [--db path]",
    "  node scripts/mark-ai-record.cjs game <game-id> --include 0|1 [--note text] [--db path]",
  ].join("\n"));
  process.exit(1);
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

const kind = args[0];
const id = args[1];
if (!["run", "game"].includes(kind) || !id) usage();

const includeValue = option("--include");
const note = option("--note");
const dbPath = path.resolve(root, option("--db") || process.env.AI_SMOKE_GAME_DB_PATH || defaultDbPath);
if (includeValue !== "0" && includeValue !== "1" && !note) usage();
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(dbPath);
const included = includeValue === null ? null : Number.parseInt(includeValue, 10);

if (kind === "run") {
  if (included !== null) {
    db.prepare("UPDATE ai_runs SET included_in_tables = ? WHERE run_id = ?").run(included, id);
  }
  if (note) {
    db.prepare("INSERT INTO ai_run_notes (run_id, note) VALUES (?, ?)").run(id, note);
    db.prepare("UPDATE ai_runs SET notes = trim(notes || char(10) || ?) WHERE run_id = ?").run(note, id);
  }
} else {
  if (included !== null) {
    db.prepare("UPDATE ai_games SET included_in_tables = ? WHERE game_id = ?").run(included, id);
  }
  if (note) {
    db.prepare("INSERT INTO ai_game_notes (game_id, note) VALUES (?, ?)").run(id, note);
    db.prepare("UPDATE ai_games SET notes = trim(notes || char(10) || ?) WHERE game_id = ?").run(note, id);
  }
}

db.close();
console.log(`${kind} ${id} updated in ${path.relative(root, dbPath)}`);
