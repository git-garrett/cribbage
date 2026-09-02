#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const ACTION = { play: 0, go: 1, reset: 2 };

function parseArgs(argv) {
  const result = {
    workers: 1,
    startOrdinal: 0,
    count: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--source-db") result.sourceDb = path.resolve(value);
    else if (flag === "--out-db") result.outDb = path.resolve(value);
    else if (flag === "--runtime-root") result.runtimeRoot = path.resolve(value);
    else if (flag === "--workers") result.workers = positiveInteger(value, flag);
    else if (flag === "--start-ordinal") result.startOrdinal = nonnegativeInteger(value, flag);
    else if (flag === "--count") result.count = positiveInteger(value, flag);
    else throw new Error(`Unknown argument ${flag}`);
  }
  for (const field of ["sourceDb", "outDb", "runtimeRoot"]) {
    if (!result[field]) throw new Error(`--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return result;
}

function positiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be positive`);
  return parsed;
}

function nonnegativeInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be nonnegative`);
  return parsed;
}

function loadHistoricalHelpers(runtimeRoot, engineSource) {
  const scriptPath = path.join(runtimeRoot, "scripts", "smoke-four-model-ai.cjs");
  let source = fs.readFileSync(scriptPath, "utf8");
  const engineRead = 'fs.readFileSync(enginePath, "utf8")';
  if (!source.includes(engineRead)) {
    throw new Error(`Could not replace the historical engine read in ${scriptPath}`);
  }
  source = source.replace(engineRead, "globalThis.__CRIBBAGE_TRAJECTORY_ENGINE_SOURCE");
  source = source.replace("if (!isMainThread) {", "if (false) {");
  const mainStart = source.lastIndexOf("\nmain().catch((error) => {");
  if (mainStart < 0) throw new Error(`Could not isolate historical runner helpers in ${scriptPath}`);
  source = `${source.slice(0, mainStart)}\nglobalThis.__CRIBBAGE_TRAJECTORY_HELPERS = { loadEngine, cyrb128, sfc32 };\n`;
  const helperModule = new Module(scriptPath, module);
  helperModule.filename = scriptPath;
  helperModule.paths = Module._nodeModulePaths(path.dirname(scriptPath));
  globalThis.__CRIBBAGE_TRAJECTORY_ENGINE_SOURCE = engineSource;
  helperModule._compile(source, scriptPath);
  return globalThis.__CRIBBAGE_TRAJECTORY_HELPERS;
}

function loadUnboundedEngine(runtimeRoot) {
  const enginePath = path.join(runtimeRoot, "web", "src", "engine.ts");
  const original = fs.readFileSync(enginePath, "utf8");
  const cappedScore = "player.score = Math.min(player.score + points, 121);";
  const singleWinner = "if (player.score >= 121) {";
  if (!original.includes(cappedScore) || !original.includes(singleWinner)) {
    throw new Error("Historical engine scoring seam no longer matches the frozen source");
  }
  const patched = original
    .replace(cappedScore, "player.score += points;")
    .replace(singleWinner, "if (this.human.score >= 121 && this.ai.score >= 121) {")
    .replace(
      "    this.advanceUntilHuman();\n  }\n\n  private advanceUntilHuman(): void {",
      "  }\n\n  private advanceUntilHuman(): void {",
    )
    .replace("function analyzeDiscardChoice(", "export function analyzeDiscardChoice(");
  const helpers = loadHistoricalHelpers(runtimeRoot, patched);
  if (typeof helpers.loadEngine !== "function") {
    throw new Error(`Historical helper export failed: ${JSON.stringify(Object.keys(helpers))}`);
  }
  return { ...helpers.loadEngine(), helpers };
}

function initializeOutput(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS trajectory_games (
      source_game_id TEXT PRIMARY KEY,
      source_db TEXT NOT NULL,
      matchup_id TEXT NOT NULL,
      game_index INTEGER NOT NULL,
      random_seed TEXT NOT NULL,
      left_engine TEXT NOT NULL,
      right_engine TEXT NOT NULL,
      terminal_hand_number INTEGER NOT NULL,
      terminal_start_left_score INTEGER NOT NULL,
      terminal_start_right_score INTEGER NOT NULL,
      final_left_score INTEGER NOT NULL,
      final_right_score INTEGER NOT NULL,
      final_hand_number INTEGER NOT NULL,
      continuation_steps INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      reconstruction_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trajectory_events (
      source_game_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      hand_number INTEGER NOT NULL,
      dealer INTEGER NOT NULL,
      player INTEGER NOT NULL,
      phase TEXT NOT NULL,
      points INTEGER NOT NULL,
      PRIMARY KEY (source_game_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_trajectory_games_matchup
      ON trajectory_games(matchup_id, game_index);
  `);
}

function loadKeys(db, startOrdinal, count, completed) {
  const rows = db.prepare(`
    SELECT game_id, matchup_id, game_index
    FROM compact_games
    WHERE reproducible = 1 AND included_in_tables = 1
    ORDER BY matchup_id, game_index, game_id
  `).all();
  const selected = rows.slice(startOrdinal, count === null ? undefined : startOrdinal + count);
  return selected.filter((row) => !completed.has(row.game_id));
}

function loadStoredGame(db, key) {
  const row = db.prepare(`
    SELECT g.random_seed, g.left_engine, g.right_engine,
           h.hand_number, h.dealer, h.start_left_score, h.start_right_score,
           h.left_dealt, h.right_dealt, h.cut_card
    FROM compact_games g
    JOIN compact_hands h ON h.game_id = g.game_id
    WHERE g.game_id = ?
      AND h.hand_number = (SELECT MAX(hand_number) FROM compact_hands WHERE game_id = g.game_id)
  `).get(key.game_id);
  if (!row) throw new Error(`${key.game_id} has no terminal hand`);
  const discards = db.prepare(`
    SELECT player, cards FROM compact_discards
    WHERE game_id = ? AND hand_number = ? ORDER BY player
  `).all(key.game_id, row.hand_number).map((discard) => ({
    player: Number(discard.player),
    cards: [...discard.cards],
  }));
  const pegActions = db.prepare(`
    SELECT action, card, player, left_score, right_score FROM compact_peg_plays
    WHERE game_id = ? AND hand_number = ? ORDER BY sequence
  `).all(key.game_id, row.hand_number).map((play) => ({
    action: Number(play.action),
    card: play.card === null ? null : Number(play.card),
    player: play.player === null ? null : Number(play.player),
    leftScore: play.left_score === null ? null : Number(play.left_score),
    rightScore: play.right_score === null ? null : Number(play.right_score),
  }));
  return {
    ...key,
    randomSeed: row.random_seed,
    leftEngine: row.left_engine,
    rightEngine: row.right_engine,
    terminalHand: Number(row.hand_number),
    dealer: Number(row.dealer),
    startLeftScore: Number(row.start_left_score),
    startRightScore: Number(row.start_right_score),
    leftDealt: [...row.left_dealt],
    rightDealt: [...row.right_dealt],
    cutCard: Number(row.cut_card),
    discards,
    pegActions,
  };
}

function cyrb128(value) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < value.length; index += 1) {
    const k = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

function sfc32FirstWord(a, b, c, d) {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d = (d + 1) | 0;
  return (((a + b) | 0) + d) >>> 0;
}

function rngStateAfterTerminalDeal(seed, terminalHand) {
  let state = sfc32FirstWord(...cyrb128(seed));
  if (!state) state = 0x9e3779b9;
  const advances = 1 + (51 * terminalHand);
  for (let index = 0; index < advances; index += 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  }
  return state;
}

function engineCardId(compactId) {
  const rank = Math.floor(compactId / 4);
  const suit = compactId % 4;
  return (suit * 13) + rank;
}

function compactCardId(card) {
  if (card === null || card === undefined) return null;
  if (typeof card === "number") {
    const rank = card % 13;
    const suit = Math.floor(card / 13);
    return (rank * 4) + suit;
  }
  const label = typeof card === "string" ? card : card.label;
  const match = /^(A|2|3|4|5|6|7|8|9|10|J|Q|K)([♣♦♥♠cdhs])$/.exec(label || "");
  if (!match) throw new Error(`Cannot parse card ${JSON.stringify(card)}`);
  const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(match[1]);
  const suit = ({ "♦": 0, d: 0, "♣": 1, c: 1, "♥": 2, h: 2, "♠": 3, s: 3 })[match[2]];
  return (rank * 4) + suit;
}

async function completeGame(db, source, engine) {
  const { CribbageGame, loadOpponentResources, helpers } = engine;
  await Promise.all([
    loadOpponentResources(source.leftEngine),
    loadOpponentResources(source.rightEngine),
  ]);
  const previousRandom = Math.random;
  Math.random = helpers.sfc32(...helpers.cyrb128(source.randomSeed));
  let game;
  try {
    game = new CribbageGame(source.rightEngine, source.leftEngine);
    while (game.handNumber < source.terminalHand) {
      game.deal ^= 1;
      game.handNumber += 1;
      game.startHand();
    }
  } finally {
    Math.random = previousRandom;
  }
  verifyDeal(source, game);
  game.gameId = source.game_id;
  game.human.score = source.startLeftScore;
  game.ai.score = source.startRightScore;
  game.pegPositions = {
    human: [source.startLeftScore, source.startLeftScore],
    ai: [source.startRightScore, source.startRightScore],
  };
  game.analyticsCounter = 0;
  game.analyticsEvents = [];
  game.log = [];
  game.result = [];
  replayTerminalPrefix(source, game, engine);
  game.autoPlayToEnd();
  const events = scoreEvents(source, game.analyticsEvents);
  if (!events.length) throw new Error(`${source.game_id} produced no continuation events`);
  return {
    source,
    finalLeftScore: game.human.score,
    finalRightScore: game.ai.score,
    finalHand: game.handNumber,
    steps: game.analyticsEvents.length,
    events,
  };
}

function verifyDeal(source, game) {
  const left = game.human.hand.map((card) => compactCardId(card.id));
  const right = game.ai.hand.map((card) => compactCardId(card.id));
  if (game.deal !== source.dealer ||
      JSON.stringify(left) !== JSON.stringify(source.leftDealt) ||
      JSON.stringify(right) !== JSON.stringify(source.rightDealt) ||
      compactCardId(game.turnCard.id) !== source.cutCard) {
    throw new Error(`${source.game_id} terminal deal reconstruction mismatch`);
  }
}

function replayTerminalPrefix(source, game, engine) {
  if (source.discards.length !== 2) {
    throw new Error(`${source.game_id} does not have two terminal discards`);
  }
  const leftDiscard = source.discards.find((discard) => discard.player === 0);
  const rightDiscard = source.discards.find((discard) => discard.player === 1);
  if (!leftDiscard || !rightDiscard) throw new Error(`${source.game_id} terminal discards are incomplete`);

  const leftIds = leftDiscard.cards.map(engineCardId);
  const rightIds = rightDiscard.cards.map(engineCardId);
  const leftCards = leftIds.map((id) => game.human.hand.find((card) => card.id === id));
  const rightCards = rightIds.map((id) => game.ai.hand.find((card) => card.id === id));
  if (leftCards.some((card) => !card) || rightCards.some((card) => !card)) {
    throw new Error(`${source.game_id} terminal discard card is missing from its dealt hand`);
  }
  const leftAnalysis = engine.analyzeDiscardChoice(
    [...game.human.hand], leftCards, game.dealer === game.human,
    source.leftEngine, { game, player: game.human },
  );
  const rightAnalysis = engine.analyzeDiscardChoice(
    [...game.ai.hand], rightCards, game.dealer === game.ai,
    source.rightEngine, { game, player: game.ai },
  );
  game.pegTableLeads.human = leftAnalysis.selectedPegTableLead;
  game.pegTableLeads.ai = rightAnalysis.selectedPegTableLead;
  game.discard(leftIds);
  game.finishDiscardWithAiCards(rightIds, rightAnalysis.selectedPegTableLead);

  for (const action of source.pegActions) {
    if (action.action === 2) {
      if (!game.peggingResetPending) callGo(game, game.currentPlayer().key === "human" ? 0 : 1);
      verifyCappedScores(source, game, action);
      continue;
    }
    if (game.peggingResetPending) game.acknowledgePeggingReset();
    if (action.action === 0) {
      if (action.player === null || action.card === null) {
        throw new Error(`${source.game_id} has an incomplete recorded play`);
      }
      const cardId = engineCardId(action.card);
      if (action.player === 0) game.playHumanPeggingCard(cardId);
      else game.playAiPeggingCard(cardId);
    } else if (action.action === 1) {
      if (action.player === null) throw new Error(`${source.game_id} has a go without a player`);
      callGo(game, action.player);
    } else {
      throw new Error(`${source.game_id} has unknown pegging action ${action.action}`);
    }
    verifyCappedScores(source, game, action);
  }
}

function callGo(game, player) {
  if (player === 0) game.humanPeggingGo();
  else game.aiPeggingGo();
}

function verifyCappedScores(source, game, action) {
  const leftActual = Math.min(game.human.score, 121);
  const rightActual = Math.min(game.ai.score, 121);
  if (action.leftScore !== null && action.leftScore < 121 &&
      leftActual !== action.leftScore && leftActual !== action.leftScore + 1) {
    throw new Error(`${source.game_id} left score diverged while replaying terminal pegging action=${JSON.stringify(action)} actual=${game.human.score}:${game.ai.score}`);
  }
  if (action.rightScore !== null && action.rightScore < 121 &&
      rightActual !== action.rightScore && rightActual !== action.rightScore + 1) {
    throw new Error(`${source.game_id} right score diverged while replaying terminal pegging action=${JSON.stringify(action)} actual=${game.human.score}:${game.ai.score}`);
  }
}

function scoreEvents(source, analyticsEvents) {
  const result = [];
  for (const event of analyticsEvents) {
    if (event.type !== "score" || !event.points) continue;
    const player = event.player === "human" ? 0 : 1;
    const dealer = (source.dealer ^ ((event.handNumber - source.terminalHand) & 1));
    let phase = event.category;
    if (event.category === "pegging" && event.reason === "his heels") phase = "heels";
    else if (event.category === "pegging") phase = "pegging";
    else if (event.category === "hand") phase = event.role === "pone" ? "pone_hand" : "dealer_hand";
    else if (event.category === "crib") phase = "crib";
    result.push({
      handNumber: event.handNumber,
      dealer,
      player,
      phase,
      points: event.points,
    });
  }
  return result;
}

function writeCompleted(db, sourceDb, result) {
  const insertGame = db.prepare(`
    INSERT OR REPLACE INTO trajectory_games (
      source_game_id, source_db, matchup_id, game_index, random_seed,
      left_engine, right_engine, terminal_hand_number,
      terminal_start_left_score, terminal_start_right_score,
      final_left_score, final_right_score, final_hand_number,
      continuation_steps, event_count, reconstruction_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const deleteEvents = db.prepare("DELETE FROM trajectory_events WHERE source_game_id = ?");
  const insertEvent = db.prepare(`
    INSERT INTO trajectory_events
      (source_game_id, sequence, hand_number, dealer, player, phase, points)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    const source = result.source;
    insertGame.run(
      source.game_id, sourceDb, source.matchup_id, source.game_index, source.randomSeed,
      source.leftEngine, source.rightEngine, source.terminalHand,
      source.startLeftScore, source.startRightScore,
      result.finalLeftScore, result.finalRightScore, result.finalHand,
      result.steps, result.events.length,
    );
    deleteEvents.run(source.game_id);
    result.events.forEach((event, sequence) => {
      insertEvent.run(
        source.game_id, sequence, event.handNumber, event.dealer,
        event.player, event.phase, event.points,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function workerMain() {
  const sourceDb = new DatabaseSync(workerData.sourceDb, { readOnly: true });
  sourceDb.exec("PRAGMA busy_timeout = 30000");
  const engine = loadUnboundedEngine(workerData.runtimeRoot);
  for (const key of workerData.keys) {
    try {
      const source = loadStoredGame(sourceDb, key);
      const result = await completeGame(sourceDb, source, engine);
      parentPort.postMessage({ type: "result", result });
    } catch (error) {
      parentPort.postMessage({
        type: "error",
        gameId: key.game_id,
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
      break;
    }
  }
  sourceDb.close();
  parentPort.postMessage({ type: "done" });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(config.sourceDb)) throw new Error(`Missing source database ${config.sourceDb}`);
  fs.mkdirSync(path.dirname(config.outDb), { recursive: true });
  const output = new DatabaseSync(config.outDb);
  initializeOutput(output);
  const completed = new Set(output.prepare("SELECT source_game_id FROM trajectory_games").all().map((row) => row.source_game_id));
  const source = new DatabaseSync(config.sourceDb, { readOnly: true });
  source.exec("PRAGMA busy_timeout = 30000");
  const keys = loadKeys(source, config.startOrdinal, config.count, completed);
  source.close();
  if (!keys.length) {
    process.stdout.write(`${JSON.stringify({ status: "complete", completed: 0 })}\n`);
    output.close();
    return;
  }
  const workerCount = Math.max(1, Math.min(config.workers, keys.length));
  const chunks = Array.from({ length: workerCount }, () => []);
  keys.forEach((key, index) => chunks[index % workerCount].push(key));
  let done = 0;
  let written = 0;
  let failed = null;
  await new Promise((resolve, reject) => {
    for (const chunk of chunks) {
      const worker = new Worker(__filename, {
        workerData: {
          sourceDb: config.sourceDb,
          runtimeRoot: config.runtimeRoot,
          keys: chunk,
        },
      });
      worker.on("message", (message) => {
        if (message.type === "result") {
          try {
            writeCompleted(output, config.sourceDb, message.result);
            written += 1;
            if (written % 100 === 0 || written === keys.length) {
              process.stderr.write(`completed ${written}/${keys.length} trajectories\n`);
            }
          } catch (error) {
            failed = error;
            reject(error);
          }
        } else if (message.type === "error") {
          failed = new Error(`${message.gameId}: ${message.error}`);
          reject(failed);
        } else if (message.type === "done") {
          done += 1;
          if (done === workerCount && !failed) resolve();
        }
      });
      worker.on("error", (error) => {
        failed = error;
        reject(error);
      });
    }
  });
  output.close();
  if (written !== keys.length) throw new Error(`Wrote ${written} of ${keys.length} trajectories`);
  process.stdout.write(`${JSON.stringify({ status: "complete", completed: written, workers: workerCount })}\n`);
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  workerMain().catch((error) => {
    parentPort.postMessage({ type: "error", error: error.stack || error.message });
  });
}
