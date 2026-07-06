#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { fileURLToPath, pathToFileURL } = require("node:url");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "web", "src", "engine.ts");
const MODEL = process.env.MODEL || "schell_table-peg_table-14.8.1";

function loadEngine() {
  installLocalAssetFetch();
  const source = patchEngineAssetImports(fs.readFileSync(enginePath, "utf8"));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      resolveJsonModule: true,
      esModuleInterop: true,
    },
  }).outputText;
  const engineModule = new Module(enginePath, module);
  engineModule.filename = enginePath;
  engineModule.paths = Module._nodeModulePaths(path.dirname(enginePath));
  engineModule._compile(compiled, enginePath);
  return engineModule.exports;
}

function patchEngineAssetImports(source) {
  const replacements = [
    ["rank-crib-discard/six-card-discard-policy.bin", "sixCardDiscardPolicyUrl"],
    ["schell_table-peg_table-12.0/pegging-outcome-pairwise.bin", "peggingPairwise12Url"],
    ["schell_table-peg_table-13.0/pegging-remaining-hand-distribution.bin", "model13HoldUrl"],
    ["schell_table-peg_table-13.0/pone-lead-frequency.bin", "model13LeadUrl"],
    ["schell_table-peg_table-14.0/pegging-outcome-tripolicy-aligned.bin", "peggingPairwise14Url"],
    ["schell_table-peg_table-14.0/crib-score-histogram-tripolicy-by-discard-cut.bin", "cribTripolicy14Url"],
    ["schell_table-peg_table-14.4/pegging-outcome-bounded-overrides.bin", "peggingBounded144Url"],
    ["schell_table-peg_table-14.4/crib-score-histogram-bounded-tripolicy-by-discard-cut.bin", "cribBounded144Url"],
    ["schell_table-peg_table-14.5/pegging-outcome-frontier-overrides.bin", "peggingFrontier145Url"],
    ["schell_table-peg_table-14.5/crib-score-histogram-frontier-by-discard-cut.bin", "cribFrontier145Url"],
    ["schell_table-peg_table-14.6/crib-score-histogram-full-frontier-by-discard-cut.bin", "cribFullFrontier146Url"],
  ];
  let patched = source;
  for (const [relativePath, name] of replacements) {
    const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`import\\s+${name}\\s+from\\s+"\\.\\/models\\/${escaped}\\?url";`);
    const assetPath = path.join(path.dirname(enginePath), "models", relativePath);
    patched = patched.replace(regex, `const ${name} = ${JSON.stringify(pathToFileURL(assetPath).href)};`);
  }
  return patched;
}

function installLocalAssetFetch() {
  if (globalThis.__CRIBBAGE_LOCAL_ASSET_FETCH_INSTALLED) return;
  globalThis.fetch = async (resource) => {
    const url = typeof resource === "string" ? resource : resource?.url;
    if (typeof url === "string" && (url.startsWith("file:") || path.isAbsolute(url))) {
      const filePath = url.startsWith("file:") ? fileURLToPath(url) : url;
      const bytes = fs.readFileSync(filePath);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        json: async () => JSON.parse(bytes.toString("utf8")),
        text: async () => bytes.toString("utf8"),
      };
    }
    throw new Error(`Unexpected fixture fetch URL: ${url}`);
  };
  globalThis.__CRIBBAGE_LOCAL_ASSET_FETCH_INSTALLED = true;
}

function idsValue(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "number").join(",") : "";
}

function dealerKey(snapshot) {
  return snapshot.deal === 1 ? "ai" : "human";
}

function poneKey(snapshot) {
  return dealerKey(snapshot) === "ai" ? "human" : "ai";
}

function roleFor(snapshot, player) {
  return dealerKey(snapshot) === player ? "dealer" : "pone";
}

function currentPlayerKey(snapshot) {
  return snapshot.turn === 0 ? poneKey(snapshot) : dealerKey(snapshot);
}

function compactRustDecisionInput(kind, snapshot) {
  const ai = snapshot.ai;
  const human = snapshot.human;
  const fields = {
    v: 1,
    kind,
    model: MODEL,
    player: "ai",
    role: roleFor(snapshot, "ai"),
    dealer: dealerKey(snapshot),
    pone: poneKey(snapshot),
    phase: snapshot.phase,
    handNumber: snapshot.handNumber ?? 1,
    aiScore: ai.score,
    humanScore: human.score,
    myScore: ai.score,
    opponentScore: human.score,
    aiHand: idsValue(ai.hand),
    humanHandCount: human.hand.length,
    aiTable: idsValue(ai.table),
    humanTable: idsValue(human.table),
    crib: idsValue(snapshot.crib),
    turnCard: snapshot.turnCard,
    count: snapshot.count,
    turn: currentPlayerKey(snapshot),
    go: snapshot.goPlayer ?? "-",
    last: snapshot.lastPlayer ?? "-",
    plays: idsValue(snapshot.plays),
    playOwners: Array.isArray(snapshot.playOwners) ? snapshot.playOwners.join(",") : "",
    pegLead: typeof snapshot.pegTableLeads?.ai === "number" ? snapshot.pegTableLeads.ai : "-",
  };
  return Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(";");
}

function applyDiscardFixture(game, Card, fixture) {
  game.opponent = MODEL;
  game.playerEngines = { human: MODEL, ai: MODEL };
  game.deal = fixture.dealer === "ai" ? 1 : 0;
  game.firstDeal = game.deal;
  game.dealer = fixture.dealer === "ai" ? game.ai : game.human;
  game.pone = fixture.dealer === "ai" ? game.human : game.ai;
  game.human.score = fixture.humanScore;
  game.ai.score = fixture.aiScore;
  game.ai.hand = fixture.aiHand.map((id) => new Card(id));
  game.human.hand = fixture.humanHand.map((id) => new Card(id));
  game.ai.table = [];
  game.human.table = [];
  game.ai.crib = [];
  game.human.crib = [];
  game.crib = [];
  game.turnCard = new Card(fixture.turnCard);
  game.plays = [];
  game.playOwners = [];
  game.completedPlays = [];
  game.completedPlayOwners = [];
  game.count = 0;
  game.turn = 0;
  game.goPlayer = null;
  game.lastPlayer = null;
  game.peggingResetPending = false;
  game.phase = "ai_discarding";
  game.pegTableLeads = { human: null, ai: null };
}

function applyPegFixture(game, Card, fixture) {
  game.opponent = MODEL;
  game.playerEngines = { human: MODEL, ai: MODEL };
  game.deal = fixture.dealer === "ai" ? 1 : 0;
  game.firstDeal = game.deal;
  game.dealer = fixture.dealer === "ai" ? game.ai : game.human;
  game.pone = fixture.dealer === "ai" ? game.human : game.ai;
  game.human.score = fixture.humanScore;
  game.ai.score = fixture.aiScore;
  game.ai.hand = fixture.aiHand.map((id) => new Card(id));
  game.human.hand = fixture.humanHand.map((id) => new Card(id));
  game.ai.table = fixture.aiTable.map((id) => new Card(id));
  game.human.table = fixture.humanTable.map((id) => new Card(id));
  game.crib = fixture.crib.map((id) => new Card(id));
  game.dealer.crib = [...game.crib];
  game.pone.crib = [];
  game.turnCard = new Card(fixture.turnCard);
  game.plays = fixture.plays.map((id) => new Card(id));
  game.playOwners = [...fixture.playOwners];
  game.completedPlays = [];
  game.completedPlayOwners = [];
  game.count = fixture.count;
  game.turn = fixture.turn === "dealer" ? 1 : 0;
  game.goPlayer = fixture.goPlayer ? (fixture.goPlayer === "ai" ? game.ai : game.human) : null;
  game.lastPlayer = fixture.lastPlayer ? (fixture.lastPlayer === "ai" ? game.ai : game.human) : null;
  game.peggingResetPending = false;
  game.phase = "pegging";
  game.pegTableLeads = { human: null, ai: fixture.pegLead ?? null };
}

function combinations(items, size) {
  const result = [];
  const selected = [];
  function visit(start) {
    if (selected.length === size) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (size - selected.length); index += 1) {
      selected.push(items[index]);
      visit(index + 1);
      selected.pop();
    }
  }
  visit(0);
  return result;
}

async function main() {
  const { Card, CribbageGame, loadOpponentResources } = loadEngine();
  await loadOpponentResources(MODEL);
  if (process.env.MODE === "peg") {
    const pegFixtures = [
      {
        name: "peg-one-legal",
        dealer: "human",
        aiScore: 70,
        humanScore: 72,
        aiHand: [4, 10, 23],
        humanHand: [0, 13, 26],
        aiTable: [30],
        humanTable: [31],
        crib: [1, 14, 27, 40],
        turnCard: 38,
        plays: [9, 8, 5],
        playOwners: ["human", "ai", "human"],
        count: 25,
        turn: "pone",
        goPlayer: null,
        lastPlayer: "human",
      },
      {
        name: "peg-stored-lead",
        dealer: "human",
        aiScore: 88,
        humanScore: 84,
        aiHand: [26, 27, 28, 29],
        humanHand: [3, 16, 30, 32],
        aiTable: [],
        humanTable: [],
        crib: [43, 50, 44, 45],
        turnCard: 7,
        plays: [],
        playOwners: [],
        count: 0,
        turn: "pone",
        goPlayer: null,
        lastPlayer: null,
        pegLead: 3,
      },
      {
        name: "peg-exhaustive-mid",
        dealer: "ai",
        aiScore: 70,
        humanScore: 68,
        aiHand: [0, 5, 9, 12],
        humanHand: [2, 15, 28, 41],
        aiTable: [],
        humanTable: [],
        crib: [3, 16, 29, 42],
        turnCard: 25,
        plays: [],
        playOwners: [],
        count: 0,
        turn: "dealer",
        goPlayer: null,
        lastPlayer: null,
      },
    ];
    for (const fixture of pegFixtures) {
      const game = new CribbageGame(MODEL);
      applyPegFixture(game, Card, fixture);
      const recommendation = game.recommendAiPeggingAction();
      const snapshot = game.snapshot();
      const expected = { action: recommendation.action };
      if (typeof recommendation.cardId === "number") expected.cardId = recommendation.cardId;
      if (typeof recommendation.ev === "number") expected.ev = recommendation.ev;
      process.stdout.write(`${JSON.stringify({
        name: fixture.name,
        expected,
        inputText: compactRustDecisionInput("peg", snapshot),
      })}\n`);
    }
    return;
  }
  const fixtures = [
    {
      name: "ai-dealer-mixed",
      dealer: "ai",
      aiScore: 57,
      humanScore: 61,
      aiHand: [0, 14, 28, 42, 9, 22],
      humanHand: [5, 18, 31, 44, 12, 25],
      turnCard: 35,
    },
    {
      name: "ai-pone-flush-pressure",
      dealer: "human",
      aiScore: 88,
      humanScore: 84,
      aiHand: [26, 27, 28, 29, 43, 50],
      humanHand: [3, 16, 30, 32, 45, 51],
      turnCard: 7,
    },
    {
      name: "ai-dealer-pairs",
      dealer: "ai",
      aiScore: 104,
      humanScore: 102,
      aiHand: [4, 17, 30, 43, 10, 23],
      humanHand: [0, 13, 26, 39, 12, 25],
      turnCard: 36,
    },
  ];
  for (const fixture of fixtures) {
    const game = new CribbageGame(MODEL);
    applyDiscardFixture(game, Card, fixture);
    const recommendation = game.recommendAiDiscard();
    const snapshot = game.snapshot();
    const record = {
      name: fixture.name,
      expected: {
        cardIds: recommendation.cardIds,
        bestLead: recommendation.bestLead,
      },
      inputText: compactRustDecisionInput("discard", snapshot),
    };
    if (process.env.DETAILS === "1") {
      record.candidates = [];
      for (const discardIds of combinations(fixture.aiHand, 2)) {
        const candidateGame = new CribbageGame(MODEL);
        applyDiscardFixture(candidateGame, Card, fixture);
        candidateGame.finishDiscardWithAiCards(discardIds);
        const event = [...candidateGame.analyticsEvents].reverse().find((item) =>
          item.type === "discard" && item.player === "ai"
        );
        record.candidates.push({
          discardIds,
          selectedEv: event?.selectedEv,
          selectedWinProbability: event?.selectedWinProbability,
          recommendedWinProbability: event?.recommendedWinProbability,
          pegLead: candidateGame.pegTableLeads.ai,
        });
      }
    }
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
