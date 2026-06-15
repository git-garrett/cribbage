const CARD_RE = /^(A|2|3|4|5|6|7|8|9|10|J|Q|K)([dchs])$/;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["d", "c", "h", "s"];
const PLAYER = { left: 0, right: 1, human: 0, ai: 1 };
const PLAYER_LABEL = ["left", "right"];
const RESULT = { regular: 0, skunk: 1, "double-skunk": 2 };
const ACTION = { play: 0, go: 1, reset: 2 };
const CATEGORY = { pegging: 0, hand: 1, crib: 2 };
const ROLE = { pone: 0, dealer: 1 };
const HAND_COMPONENT_KEYS = ["fifteens", "pairs", "runs", "flush", "knobs"];
const PEG_COMPONENT_KEYS = ["fifteens", "thirtyOne", "pairs", "runs", "go", "lastCard", "heels"];
const DISCARD_EV_COMPONENT_KEYS = [
  "handFifteens",
  "handPairs",
  "handRuns",
  "handFlush",
  "handKnobs",
  "cribFifteens",
  "cribPairs",
  "cribRuns",
  "cribFlush",
  "cribKnobs",
  "pegging",
];
const PEG_EV_COMPONENT_KEYS = ["pegFifteens", "pegThirtyOne", "pegPairs", "pegRuns", "pegGo", "pegLastCard", "pegHeels"];

function cardId(label) {
  if (!label) return null;
  const match = String(label).match(CARD_RE);
  if (!match) return null;
  const rank = RANKS.indexOf(match[1]);
  const suit = SUITS.indexOf(match[2]);
  if (rank < 0 || suit < 0) return null;
  return rank * 4 + suit;
}

function cardBlob(labels) {
  const ids = (labels || []).map(cardId).filter((id) => id !== null);
  return Buffer.from(ids);
}

function playerCode(player) {
  return PLAYER[player] ?? null;
}

function resultCode(result) {
  return RESULT[result] ?? 0;
}

function roleCode(role) {
  return ROLE[role] ?? null;
}

function componentBlob(components, keys) {
  if (!components) return null;
  return Buffer.from(keys.map((key) => Math.max(0, Math.min(255, Math.round(components[key] ?? 0)))));
}

function floatComponentBlob(components, keys) {
  if (!components) return null;
  const buffer = Buffer.alloc(keys.length * 4);
  keys.forEach((key, index) => {
    buffer.writeFloatLE(Number.isFinite(components[key]) ? components[key] : 0, index * 4);
  });
  return buffer;
}

function addComponentTotals(target, components, keys) {
  if (!components) return;
  for (const key of keys) target[key] += components[key] ?? 0;
}

function ensureCompactSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compact_games (
      game_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      matchup_id TEXT NOT NULL,
      game_index INTEGER NOT NULL,
      random_seed TEXT NOT NULL DEFAULT '',
      left_engine TEXT NOT NULL,
      right_engine TEXT NOT NULL,
      winner INTEGER,
      result INTEGER,
      final_left_score INTEGER,
      final_right_score INTEGER,
      started_at TEXT,
      ended_at TEXT,
      reproducible INTEGER NOT NULL DEFAULT 1,
      included_in_tables INTEGER NOT NULL DEFAULT 1,
      source_log_path TEXT,
      log_detail TEXT NOT NULL DEFAULT 'compact',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES ai_runs(run_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_compact_games_run_index ON compact_games(run_id, matchup_id, game_index);
    CREATE INDEX IF NOT EXISTS idx_compact_games_run ON compact_games(run_id);
    CREATE INDEX IF NOT EXISTS idx_compact_games_models ON compact_games(left_engine, right_engine);

    CREATE TABLE IF NOT EXISTS compact_hands (
      game_id TEXT NOT NULL,
      hand_number INTEGER NOT NULL,
      dealer INTEGER NOT NULL,
      pone INTEGER NOT NULL,
      start_left_score INTEGER,
      start_right_score INTEGER,
      end_left_score INTEGER,
      end_right_score INTEGER,
      cut_card INTEGER,
      left_dealt BLOB,
      right_dealt BLOB,
      left_keep BLOB,
      right_keep BLOB,
      crib BLOB,
      peg_sequence BLOB,
      left_pegging_points INTEGER NOT NULL DEFAULT 0,
      right_pegging_points INTEGER NOT NULL DEFAULT 0,
      left_hand_points INTEGER NOT NULL DEFAULT 0,
      right_hand_points INTEGER NOT NULL DEFAULT 0,
      crib_points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (game_id, hand_number),
      FOREIGN KEY (game_id) REFERENCES compact_games(game_id)
    );
    CREATE INDEX IF NOT EXISTS idx_compact_hands_scores ON compact_hands(start_left_score, start_right_score, dealer);

    CREATE TABLE IF NOT EXISTS compact_peg_plays (
      game_id TEXT NOT NULL,
      hand_number INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      player INTEGER,
      role INTEGER,
      model TEXT,
      selected_ev REAL,
      action INTEGER NOT NULL,
      card INTEGER,
      count_before INTEGER,
      count_after INTEGER,
      points INTEGER NOT NULL DEFAULT 0,
      left_score INTEGER,
      right_score INTEGER,
      PRIMARY KEY (game_id, hand_number, sequence),
      FOREIGN KEY (game_id, hand_number) REFERENCES compact_hands(game_id, hand_number)
    );
    CREATE TABLE IF NOT EXISTS compact_discards (
      game_id TEXT NOT NULL,
      hand_number INTEGER NOT NULL,
      player INTEGER NOT NULL,
      role INTEGER NOT NULL,
      model TEXT,
      selected_ev REAL,
      cards BLOB,
      hand_before BLOB,
      remaining_hand BLOB,
      crib_after_discard BLOB,
      left_score INTEGER,
      right_score INTEGER,
      PRIMARY KEY (game_id, hand_number, player),
      FOREIGN KEY (game_id, hand_number) REFERENCES compact_hands(game_id, hand_number)
    );
    CREATE INDEX IF NOT EXISTS idx_compact_discards_model ON compact_discards(model, role);
  `);
  const handColumns = new Set(db.prepare("PRAGMA table_info(compact_hands)").all().map((column) => column.name));
  if (!handColumns.has("peg_sequence")) {
    db.exec("ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB");
  }
  for (const column of [
    "left_pegging_components",
    "right_pegging_components",
    "left_hand_components",
    "right_hand_components",
    "crib_components",
  ]) {
    if (!handColumns.has(column)) db.exec(`ALTER TABLE compact_hands ADD COLUMN ${column} BLOB`);
  }
  const pegColumns = new Set(db.prepare("PRAGMA table_info(compact_peg_plays)").all().map((column) => column.name));
  if (!pegColumns.has("role")) db.exec("ALTER TABLE compact_peg_plays ADD COLUMN role INTEGER");
  if (!pegColumns.has("model")) db.exec("ALTER TABLE compact_peg_plays ADD COLUMN model TEXT");
  if (!pegColumns.has("selected_ev")) db.exec("ALTER TABLE compact_peg_plays ADD COLUMN selected_ev REAL");
  if (!pegColumns.has("score_components")) db.exec("ALTER TABLE compact_peg_plays ADD COLUMN score_components BLOB");
  if (!pegColumns.has("selected_ev_components")) db.exec("ALTER TABLE compact_peg_plays ADD COLUMN selected_ev_components BLOB");
  const discardColumns = new Set(db.prepare("PRAGMA table_info(compact_discards)").all().map((column) => column.name));
  if (!discardColumns.has("selected_ev_components")) db.exec("ALTER TABLE compact_discards ADD COLUMN selected_ev_components BLOB");
}

function eventsByHand(record) {
  const result = new Map();
  for (const event of record.events || []) {
    if (!Number.isFinite(event.handNumber)) continue;
    if (!result.has(event.handNumber)) result.set(event.handNumber, []);
    result.get(event.handNumber).push(event);
  }
  return result;
}

function handsFromEvents(record) {
  if (!record.events) return record.hands || [];
  const hands = new Map();
  for (const event of record.events) {
    if (event.type === "hand" && event.action === "start") {
      hands.set(event.handNumber, {
        handNumber: event.handNumber,
        dealer: event.dealer,
        pone: event.pone,
        startScores: event.scores,
        turnCard: event.turnCard,
        dealtHands: event.dealtHands,
        scoring: [],
      });
    } else if (event.type === "score") {
      const hand = hands.get(event.handNumber) || { handNumber: event.handNumber, scoring: [] };
      hand.scoring.push(event);
      hand.endScores = event.scores;
      hands.set(event.handNumber, hand);
    } else if (event.type === "hand" && event.action === "end") {
      const hand = hands.get(event.handNumber) || { handNumber: event.handNumber, scoring: [] };
      hand.endScores = event.scores;
      hand.crib = event.crib;
      hand.tables = event.tables;
      hands.set(event.handNumber, hand);
    }
  }
  return [...hands.values()].sort((a, b) => a.handNumber - b.handNumber);
}

function handPointTotals(hand) {
  const emptyHandComponents = () => Object.fromEntries(HAND_COMPONENT_KEYS.map((key) => [key, 0]));
  const emptyPegComponents = () => Object.fromEntries(PEG_COMPONENT_KEYS.map((key) => [key, 0]));
  const totals = {
    leftPegging: 0,
    rightPegging: 0,
    leftHand: 0,
    rightHand: 0,
    crib: 0,
    leftPeggingComponents: emptyPegComponents(),
    rightPeggingComponents: emptyPegComponents(),
    leftHandComponents: emptyHandComponents(),
    rightHandComponents: emptyHandComponents(),
    cribComponents: emptyHandComponents(),
  };
  for (const score of hand.scoring || []) {
    const side = playerCode(score.player);
    if (score.category === "pegging") {
      if (side === 0) {
        totals.leftPegging += score.points || 0;
        addComponentTotals(totals.leftPeggingComponents, score.scoreComponents, PEG_COMPONENT_KEYS);
      }
      if (side === 1) {
        totals.rightPegging += score.points || 0;
        addComponentTotals(totals.rightPeggingComponents, score.scoreComponents, PEG_COMPONENT_KEYS);
      }
    } else if (score.category === "hand") {
      if (side === 0) {
        totals.leftHand += score.points || 0;
        addComponentTotals(totals.leftHandComponents, score.scoreComponents, HAND_COMPONENT_KEYS);
      }
      if (side === 1) {
        totals.rightHand += score.points || 0;
        addComponentTotals(totals.rightHandComponents, score.scoreComponents, HAND_COMPONENT_KEYS);
      }
    } else if (score.category === "crib") {
      totals.crib += score.points || 0;
      addComponentTotals(totals.cribComponents, score.scoreComponents, HAND_COMPONENT_KEYS);
    }
  }
  totals.leftPeggingComponents = componentBlob(totals.leftPeggingComponents, PEG_COMPONENT_KEYS);
  totals.rightPeggingComponents = componentBlob(totals.rightPeggingComponents, PEG_COMPONENT_KEYS);
  totals.leftHandComponents = componentBlob(totals.leftHandComponents, HAND_COMPONENT_KEYS);
  totals.rightHandComponents = componentBlob(totals.rightHandComponents, HAND_COMPONENT_KEYS);
  totals.cribComponents = componentBlob(totals.cribComponents, HAND_COMPONENT_KEYS);
  return totals;
}

function compactHand(record, hand) {
  const totals = handPointTotals(hand);
  return {
    gameId: record.gameId,
    handNumber: hand.handNumber,
    dealer: playerCode(hand.dealer),
    pone: playerCode(hand.pone),
    startLeft: hand.startScores?.human ?? hand.startScores?.left ?? null,
    startRight: hand.startScores?.ai ?? hand.startScores?.right ?? null,
    endLeft: hand.endScores?.human ?? hand.endScores?.left ?? null,
    endRight: hand.endScores?.ai ?? hand.endScores?.right ?? null,
    cut: cardId(hand.turnCard),
    leftDealt: cardBlob(hand.dealtHands?.human || hand.dealtHands?.left),
    rightDealt: cardBlob(hand.dealtHands?.ai || hand.dealtHands?.right),
    leftKeep: cardBlob(hand.tables?.human || hand.tables?.left),
    rightKeep: cardBlob(hand.tables?.ai || hand.tables?.right),
    cribCards: cardBlob(hand.crib),
    ...totals,
  };
}

function compactPegPlays(record, events) {
  const rows = [];
  let sequenceByHand = new Map();
  for (const event of events || []) {
    if (event.type !== "pegging") continue;
    const handNumber = event.handNumber;
    const sequence = sequenceByHand.get(handNumber) || 0;
    sequenceByHand.set(handNumber, sequence + 1);
    rows.push({
      gameId: record.gameId,
      handNumber,
      sequence,
      player: playerCode(event.player),
      role: roleCode(event.role),
      model: event.model ?? null,
      selectedEv: event.selectedEv ?? null,
      action: ACTION[event.action] ?? 0,
      card: cardId(event.card),
      countBefore: event.countBefore ?? null,
      countAfter: event.count ?? null,
      points: event.points ?? 0,
      leftScore: event.scores?.human ?? event.scores?.left ?? null,
      rightScore: event.scores?.ai ?? event.scores?.right ?? null,
      scoreComponents: componentBlob(event.scoreComponents, PEG_COMPONENT_KEYS),
      selectedEvComponents: floatComponentBlob(event.selectedEvComponents, PEG_EV_COMPONENT_KEYS),
    });
  }
  return rows;
}

function compactDiscards(record, events) {
  const rows = [];
  for (const event of events || []) {
    if (event.type !== "discard") continue;
    rows.push({
      gameId: record.gameId,
      handNumber: event.handNumber,
      player: playerCode(event.player),
      role: roleCode(event.role),
      model: event.model ?? null,
      selectedEv: event.selectedEv ?? null,
      cards: cardBlob(event.cards),
      handBefore: cardBlob(event.handBeforeDiscard),
      remainingHand: cardBlob(event.remainingHand),
      cribAfterDiscard: cardBlob(event.cribAfterDiscard),
      leftScore: event.scores?.human ?? event.scores?.left ?? null,
      rightScore: event.scores?.ai ?? event.scores?.right ?? null,
      selectedEvComponents: floatComponentBlob(event.selectedEvComponents, DISCARD_EV_COMPONENT_KEYS),
    });
  }
  return rows;
}

function pegSequenceBlob(events, handNumber) {
  const bytes = [];
  for (const event of events || []) {
    if (event.type !== "pegging" || event.handNumber !== handNumber) continue;
    bytes.push(ACTION[event.action] ?? 0);
    bytes.push(playerCode(event.player) ?? 255);
    bytes.push(cardId(event.card) ?? 255);
    bytes.push(event.count ?? 255);
    bytes.push(event.points ?? 0);
  }
  return Buffer.from(bytes);
}

function insertCompactGameRecords(db, { runId, matchupId, records }) {
  if (!db || !records?.length) return { games: 0, hands: 0, pegPlays: 0 };
  ensureCompactSchema(db);
  const gameInsert = db.prepare(`
    INSERT OR REPLACE INTO compact_games (
      game_id, run_id, matchup_id, game_index, random_seed, left_engine, right_engine,
      winner, result, final_left_score, final_right_score, started_at, ended_at,
      reproducible, included_in_tables, source_log_path, log_detail, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const handInsert = db.prepare(`
    INSERT OR REPLACE INTO compact_hands (
      game_id, hand_number, dealer, pone, start_left_score, start_right_score,
      end_left_score, end_right_score, cut_card, left_dealt, right_dealt, left_keep,
      right_keep, crib, peg_sequence, left_pegging_points, right_pegging_points, left_hand_points,
      right_hand_points, crib_points, left_pegging_components, right_pegging_components,
      left_hand_components, right_hand_components, crib_components
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const pegDelete = db.prepare("DELETE FROM compact_peg_plays WHERE game_id = ?");
  const discardDelete = db.prepare("DELETE FROM compact_discards WHERE game_id = ?");
  const pegInsert = db.prepare(`
    INSERT OR REPLACE INTO compact_peg_plays (
      game_id, hand_number, sequence, player, role, model, selected_ev, action, card,
      count_before, count_after, points, left_score, right_score, score_components, selected_ev_components
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const discardInsert = db.prepare(`
    INSERT OR REPLACE INTO compact_discards (
      game_id, hand_number, player, role, model, selected_ev, cards, hand_before,
      remaining_hand, crib_after_discard, left_score, right_score, selected_ev_components
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let games = 0;
  let hands = 0;
  let pegPlays = 0;
  db.exec("BEGIN");
  try {
    for (const record of records) {
      const gameId = record.gameId || `${runId}:${matchupId}:${record.gameIndex}`;
      const normalized = { ...record, gameId };
      gameInsert.run(
        gameId,
        runId,
        matchupId,
        record.gameIndex,
        record.randomSeed || "",
        record.leftEngine,
        record.rightEngine,
        playerCode(record.winner),
        resultCode(record.result),
        record.finalScores?.left ?? null,
        record.finalScores?.right ?? null,
        record.startedAt ?? null,
        record.endedAt ?? null,
        record.reproducible === false ? 0 : 1,
        record.includedInTables === false ? 0 : 1,
        record.sourceLogPath ?? null,
        record.logDetail ?? (record.events ? "events" : record.hands ? "hand" : "game"),
        record.notes ?? "",
      );
      pegDelete.run(gameId);
      discardDelete.run(gameId);
      games += 1;
      for (const hand of handsFromEvents(normalized)) {
        const row = compactHand(normalized, hand);
        if (row.dealer === null || row.pone === null) continue;
        handInsert.run(
          row.gameId,
          row.handNumber,
          row.dealer,
          row.pone,
          row.startLeft,
          row.startRight,
          row.endLeft,
          row.endRight,
          row.cut,
          row.leftDealt,
          row.rightDealt,
          row.leftKeep,
          row.rightKeep,
          row.cribCards,
          pegSequenceBlob(normalized.events, row.handNumber),
          row.leftPegging,
          row.rightPegging,
          row.leftHand,
          row.rightHand,
          row.crib,
          row.leftPeggingComponents,
          row.rightPeggingComponents,
          row.leftHandComponents,
          row.rightHandComponents,
          row.cribComponents,
        );
        hands += 1;
      }
      for (const discard of compactDiscards(normalized, normalized.events)) {
        if (discard.player === null || discard.role === null) continue;
        discardInsert.run(
          discard.gameId,
          discard.handNumber,
          discard.player,
          discard.role,
          discard.model,
          discard.selectedEv,
          discard.cards,
          discard.handBefore,
          discard.remainingHand,
          discard.cribAfterDiscard,
          discard.leftScore,
          discard.rightScore,
          discard.selectedEvComponents,
        );
      }
      for (const play of compactPegPlays(normalized, normalized.events)) {
        pegInsert.run(
          play.gameId,
          play.handNumber,
          play.sequence,
          play.player,
          play.role,
          play.model,
          play.selectedEv,
          play.action,
          play.card,
          play.countBefore,
          play.countAfter,
          play.points,
          play.leftScore,
          play.rightScore,
          play.scoreComponents,
          play.selectedEvComponents,
        );
        pegPlays += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { games, hands, pegPlays };
}

module.exports = {
  ensureCompactSchema,
  insertCompactGameRecords,
  cardId,
  cardBlob,
  compactHand,
  eventsByHand,
  handsFromEvents,
  pegSequenceBlob,
  playerCode,
  resultCode,
};
