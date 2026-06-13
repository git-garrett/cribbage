#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const defaultSearchDir = path.join(root, "benchmarks", "ai-smoke");

function parseArgs() {
  const args = process.argv.slice(2);
  const option = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
  };
  return {
    dbPath: path.resolve(root, option("--db", process.env.AI_SMOKE_GAME_DB_PATH || defaultDbPath)),
    searchDir: path.resolve(root, option("--from", defaultSearchDir)),
    phoneExport: option("--phone-export", null)
      ? path.resolve(root, option("--phone-export"))
      : null,
  };
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function walkGameLogs(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (/\.(game|hand|events)\.jsonl$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function logDetailFromPath(filePath) {
  const match = filePath.match(/\.([^.]+)\.jsonl$/);
  return match?.[1] || "unknown";
}

function runIdFromPath(filePath) {
  const relative = path.relative(path.join(root, "benchmarks", "ai-smoke"), filePath);
  return relative.split(path.sep)[0] || "imported-ai-smoke";
}

function matchupIdFromPath(filePath) {
  const parent = path.basename(path.dirname(filePath));
  return parent.replace(/\.game-logs$/, "");
}

function syntheticGameId(runId, matchupId, sourcePath, lineIndex) {
  const batch = path.basename(sourcePath).replace(/\.jsonl$/, "");
  return `import:${runId}:${matchupId}:${batch}:${lineIndex}`;
}

function openDb(filePath) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 30000;
    CREATE TABLE IF NOT EXISTS ai_runs (
      run_id TEXT PRIMARY KEY,
      out_dir TEXT NOT NULL,
      command TEXT,
      git_commit TEXT,
      run_seed TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      included_in_tables INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ai_games (
      game_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      matchup_id TEXT NOT NULL,
      game_index INTEGER NOT NULL,
      random_seed TEXT NOT NULL,
      left_engine TEXT NOT NULL,
      right_engine TEXT NOT NULL,
      winner TEXT,
      result TEXT,
      final_left_score INTEGER,
      final_right_score INTEGER,
      started_at TEXT,
      ended_at TEXT,
      included_in_tables INTEGER NOT NULL DEFAULT 1,
      reproducible INTEGER NOT NULL DEFAULT 1,
      source_log_path TEXT,
      notes TEXT NOT NULL DEFAULT '',
      record_json TEXT NOT NULL,
      hands_json TEXT,
      events_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES ai_runs(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_games_run ON ai_games(run_id);
    CREATE INDEX IF NOT EXISTS idx_ai_games_matchup ON ai_games(matchup_id);
    CREATE INDEX IF NOT EXISTS idx_ai_games_models ON ai_games(left_engine, right_engine);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_games_run_index ON ai_games(run_id, matchup_id, game_index);
    CREATE TABLE IF NOT EXISTS ai_run_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES ai_runs(run_id)
    );
    CREATE TABLE IF NOT EXISTS ai_game_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES ai_games(game_id)
    );
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(ai_games)").all().map((column) => column.name));
  if (!columns.has("reproducible")) db.exec("ALTER TABLE ai_games ADD COLUMN reproducible INTEGER NOT NULL DEFAULT 1");
  if (!columns.has("source_log_path")) db.exec("ALTER TABLE ai_games ADD COLUMN source_log_path TEXT");
  return db;
}

function importLogs({ dbPath, searchDir }) {
  const db = openDb(dbPath);
  const files = walkGameLogs(searchDir);
  const runInsert = db.prepare(`
    INSERT INTO ai_runs (
      run_id, out_dir, command, git_commit, run_seed, status, included_in_tables, notes, started_at, completed_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      included_in_tables = 1,
      notes = CASE
        WHEN instr(notes, 'Imported from legacy JSONL logs; legitimate contest but not deterministically reproducible.') > 0 THEN notes
        ELSE trim(notes || char(10) || 'Imported from legacy JSONL logs; legitimate contest but not deterministically reproducible.')
      END,
      metadata_json = excluded.metadata_json
  `);
  const gameInsert = db.prepare(`
    INSERT OR IGNORE INTO ai_games (
      game_id, run_id, matchup_id, game_index, random_seed, left_engine, right_engine,
      winner, result, final_left_score, final_right_score, started_at, ended_at,
      included_in_tables, reproducible, source_log_path, notes, record_json, hands_json, events_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)
  `);
  const runStats = new Map();
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const runId = runIdFromPath(filePath);
    const matchupId = matchupIdFromPath(filePath);
    const sourceLogPath = path.relative(root, filePath);
    const logDetail = logDetailFromPath(filePath);
    let records;
    try {
      records = readJsonl(filePath);
    } catch (error) {
      errors += 1;
      console.error(`Failed to read ${sourceLogPath}: ${error.message}`);
      continue;
    }
    runInsert.run(
      runId,
      path.dirname(path.dirname(filePath)),
      "legacy-jsonl-import",
      null,
      "",
      "imported",
      1,
      "Imported from legacy JSONL logs; legitimate contest but not deterministically reproducible.",
      records[0]?.startedAt || new Date(fs.statSync(filePath).mtimeMs).toISOString(),
      records.at(-1)?.endedAt || null,
      JSON.stringify({ source: "legacy-jsonl-import", logDetail }),
    );
    if (!runStats.has(runId)) {
      runStats.set(runId, { files: 0, inserted: 0, skipped: 0, matchups: new Set(), logDetails: new Set() });
    }
    const stats = runStats.get(runId);
    stats.files += 1;
    stats.matchups.add(matchupId);
    stats.logDetails.add(logDetail);

    db.exec("BEGIN");
    try {
      records.forEach((record, lineIndex) => {
        const gameId = record.gameId || syntheticGameId(runId, matchupId, sourceLogPath, lineIndex);
        const normalized = {
          ...record,
          schemaVersion: record.schemaVersion || 1,
          importedFrom: sourceLogPath,
          logDetail,
          reproducible: false,
          deterministicReproduction: false,
        };
        const result = gameInsert.run(
          gameId,
          runId,
          matchupId,
          Number.isFinite(record.gameIndex) ? record.gameIndex : lineIndex,
          "",
          record.leftEngine || "",
          record.rightEngine || "",
          record.winner || null,
          record.result || null,
          record.finalScores?.left ?? null,
          record.finalScores?.right ?? null,
          record.startedAt || null,
          record.endedAt || null,
          sourceLogPath,
          "Imported from legacy JSONL logs; legitimate contest but not deterministically reproducible.",
          JSON.stringify(normalized),
          record.hands ? JSON.stringify(record.hands) : null,
          record.events ? JSON.stringify(record.events) : null,
        );
        if (result.changes) {
          inserted += 1;
          stats.inserted += 1;
        } else {
          skipped += 1;
          stats.skipped += 1;
        }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      errors += 1;
      console.error(`Failed to import ${sourceLogPath}: ${error.message}`);
    }
  }

  const summary = {
    dbPath: path.relative(root, dbPath),
    searchDir: path.relative(root, searchDir),
    files: files.length,
    inserted,
    skipped,
    errors,
    runs: Object.fromEntries([...runStats.entries()].map(([runId, stats]) => [runId, {
      files: stats.files,
      inserted: stats.inserted,
      skipped: stats.skipped,
      matchups: [...stats.matchups].sort(),
      logDetails: [...stats.logDetails].sort(),
    }])),
  };
  db.close();
  return summary;
}

function groupByGame(events) {
  const byGame = new Map();
  for (const event of events || []) {
    if (!event?.gameId) continue;
    const items = byGame.get(event.gameId) || [];
    items.push(event);
    byGame.set(event.gameId, items);
  }
  for (const items of byGame.values()) {
    items.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  }
  return byGame;
}

function matchupSafeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function phoneRecordFromEvents({ gameId, events, exportPath, exportRecord }) {
  const start = events.find((event) => event.type === "game" && event.action === "start");
  const end = [...events].reverse().find((event) => event.type === "game" && event.action === "end");
  if (!end) return null;
  const opponent = end.opponent || start?.opponent || "unknown";
  const hands = [];
  const handsByNumber = new Map();
  for (const event of events) {
    if (event.type === "hand" && event.action === "start") {
      const hand = {
        handNumber: event.handNumber,
        dealer: event.dealer,
        pone: event.pone,
        startScores: event.scores,
        turnCard: event.turnCard,
        scoring: [],
      };
      handsByNumber.set(event.handNumber, hand);
      hands.push(hand);
    } else if (event.type === "score") {
      const hand = handsByNumber.get(event.handNumber) || {
        handNumber: event.handNumber,
        scoring: [],
      };
      hand.scoring.push({
        player: event.player,
        role: event.role,
        category: event.category,
        points: event.points,
        totalScore: event.totalScore,
        scores: event.scores,
      });
      hand.endScores = event.scores;
      if (!handsByNumber.has(event.handNumber)) {
        handsByNumber.set(event.handNumber, hand);
        hands.push(hand);
      }
    } else if (event.type === "hand" && event.action === "end") {
      const hand = handsByNumber.get(event.handNumber) || {
        handNumber: event.handNumber,
        scoring: [],
      };
      hand.endScores = event.scores;
      hand.crib = event.crib;
      hand.tables = event.tables;
      if (!handsByNumber.has(event.handNumber)) {
        handsByNumber.set(event.handNumber, hand);
        hands.push(hand);
      }
    }
  }
  return {
    schemaVersion: 1,
    source: "phone",
    gameIndex: 0,
    randomSeed: "",
    gameId: `phone:${gameId}`,
    originalGameId: gameId,
    leftEngine: "human",
    rightEngine: opponent,
    startedAt: start?.at || events[0]?.at || null,
    endedAt: end.at || null,
    winner: end.winner === "human" ? "left" : end.winner === "ai" ? "right" : null,
    result: end.result || null,
    finalScores: {
      left: end.finalScores?.human ?? null,
      right: end.finalScores?.ai ?? null,
    },
    exportedAt: exportRecord.exportedAt || null,
    appVersion: exportRecord.appVersion || null,
    importedFrom: path.relative(root, exportPath),
    reproducible: false,
    deterministicReproduction: false,
    hands: hands.sort((a, b) => a.handNumber - b.handNumber),
    events,
  };
}

function importPhoneExport({ dbPath, phoneExport }) {
  const db = openDb(dbPath);
  const exportRecord = JSON.parse(fs.readFileSync(phoneExport, "utf8"));
  const events = Array.isArray(exportRecord.events) ? exportRecord.events : [];
  const byGame = groupByGame(events);
  const runId = `phone-${path.basename(phoneExport).replace(/\.json$/i, "")}`;
  const sourceLogPath = path.relative(root, phoneExport);
  const runInsert = db.prepare(`
    INSERT INTO ai_runs (
      run_id, out_dir, command, git_commit, run_seed, status, included_in_tables, notes, started_at, completed_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      metadata_json = excluded.metadata_json
  `);
  const gameInsert = db.prepare(`
    INSERT OR IGNORE INTO ai_games (
      game_id, run_id, matchup_id, game_index, random_seed, left_engine, right_engine,
      winner, result, final_left_score, final_right_score, started_at, ended_at,
      included_in_tables, reproducible, source_log_path, notes, record_json, hands_json, events_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, '', ?, ?, ?)
  `);
  const records = [];
  for (const [gameId, gameEvents] of byGame.entries()) {
    const record = phoneRecordFromEvents({ gameId, events: gameEvents, exportPath: phoneExport, exportRecord });
    if (record) records.push(record);
  }
  records.sort((a, b) => String(a.endedAt || "").localeCompare(String(b.endedAt || "")));
  runInsert.run(
    runId,
    sourceLogPath,
    "phone-export-import",
    null,
    "",
    "imported",
    1,
    "Imported from phone game export.",
    records[0]?.startedAt || exportRecord.exportedAt || new Date().toISOString(),
    records.at(-1)?.endedAt || null,
    JSON.stringify({
      source: "phone-export",
      appVersion: exportRecord.appVersion || null,
      exportedAt: exportRecord.exportedAt || null,
      eventCount: events.length,
    }),
  );
  let inserted = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    records.forEach((record, index) => {
      record.gameIndex = index;
      const matchupId = `human__vs__${matchupSafeName(record.rightEngine)}`;
      const result = gameInsert.run(
        record.gameId,
        runId,
        matchupId,
        index,
        "",
        record.leftEngine,
        record.rightEngine,
        record.winner,
        record.result,
        record.finalScores.left,
        record.finalScores.right,
        record.startedAt,
        record.endedAt,
        sourceLogPath,
        JSON.stringify(record),
        JSON.stringify(record.hands || []),
        JSON.stringify(record.events || []),
      );
      if (result.changes) inserted += 1;
      else skipped += 1;
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  const summary = {
    dbPath: path.relative(root, dbPath),
    phoneExport: sourceLogPath,
    runId,
    eventCount: events.length,
    completedGames: records.length,
    inserted,
    skipped,
  };
  db.close();
  return summary;
}

const args = parseArgs();
const summary = args.phoneExport ? importPhoneExport(args) : importLogs(args);
console.log(JSON.stringify(summary, null, 2));
