// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("human clubhouse UI", () => {
  it("separates My Stats by human and AI opponent", () => {
    expect(html).toContain('id="my-stats-opponent-tabs"');
    for (const opponent of ["master", "human", "easy", "tough", "grandmaster", "dynamic"]) {
      expect(html).toContain(`data-my-stats-opponent="${opponent}"`);
    }
    expect(source).toContain("function renderEmptyMyStatsOpponent");
    expect(source).toContain("function emptyMyStatsComparisonTable");
    expect(source).toContain('cell.textContent = "—"');
    expect(css).toContain(".my-stats-opponent-tabs");
  });

  it("makes unavailable opponent tabs genuinely non-interactive", () => {
    for (const opponent of ["grandmaster"]) {
      expect(html).toMatch(new RegExp(`data-my-stats-opponent="${opponent}"[^>]*disabled`));
    }
    expect(source).toMatch(/button\.dataset\.statsAvailable === "false"[\s\S]*return/);
    expect(css).toMatch(/\.my-stats-opponent-tabs button:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  });

  it("sizes mobile statistics tabs to their text and preserves semantic diff colors", () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.my-stats-opponent-tabs button\s*\{[^}]*inline-size:\s*max-content[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.my-stats-table \.difference\.comparison-good\s*\{[^}]*color:\s*var\(--comparison-good\)/s);
    expect(css).toMatch(/\.my-stats-table \.difference\.comparison-bad\s*\{[^}]*color:\s*var\(--comparison-bad\)/s);
  });

  it("leaves room above the scrolling stats tabs for their hover lift", () => {
    expect(css).toMatch(/\.my-stats-opponent-tabs\s*\{[^}]*padding:\s*5px 0 13px[^}]*overflow-x:\s*auto/s);
  });

  it("hides Grandmaster surfaces only in production builds", () => {
    expect(source).toContain("applyProductionOpponentVisibility(import.meta.env.PROD)");
    expect(source).toContain('[data-pathway-destination="grandmaster"]');
    expect(source).toContain('[data-my-stats-opponent="grandmaster"]');
  });

  it("puts leaderboard and account actions into the shared statistics and clubhouse surfaces", () => {
    expect(html).toContain('id="stats-view-tabs"');
    expect(html).toContain('data-stats-view="leaderboard"');
    expect(html).toContain('id="stats-leaderboard"');
    expect(html).toContain('id="auth-account-profile"');
    expect(html).toContain('id="auth-login"');
    expect(html).not.toContain('id="menu-toggle"');
    expect(source).toContain("function renderStatsLeaderboard");
  });

  it("keeps the complete game log inside Stats and reopens detailed reports", () => {
    expect(html).toContain('data-stats-view="game-log"');
    expect(html).toContain('id="stats-game-log"');
    expect(html).toContain('id="game-log-opponent"');
    expect(html).toContain('id="game-log-result"');
    expect(html).toContain('id="game-log-match-type"');
    expect(source).toContain("function openStatsGameLog");
    expect(source).toContain("function gameLogResult");
    expect(source).toContain("function gameLogMatchType");
    expect(source).toContain("openLoggedGameReport(game.gameId)");
    expect(source).toMatch(/function openLoggedGameReport[\s\S]*state\.selectedLogGameId = gameId;[\s\S]*state\.decisionReviewOpen = true/);
    expect(source).toContain("renderGameReportInto(");
  });

  it("uses opponent-scoped production totals and an explicit Ace table heading", () => {
    expect(source).toContain("playerStatsByOpponent");
    expect(source).toMatch(/const opponentLabel = MY_STATS_OPPONENT_LABEL\[state\.myStatsOpponent\]/);
    expect(source).toMatch(/myStatsComparisonTable\([\s\S]*serverScoringAvailable,[\s\S]*opponentLabel,[\s\S]*\)/);
  });

  it("uses player and opponent names throughout the playing surface", () => {
    expect(html).toContain('id="human-name"');
    expect(html).toContain('id="ai-name"');
    expect(html).toContain('id="ai-hand-title"');
    expect(source).toContain("function playerDisplayName");
    expect(source).toContain("function playerPossessive");
    expect(source).toContain('if (engine === PATHWAY_OPPONENTS.tough) return "Tough"');
  });

  it("shows positive handicaps beside player identities with hover and focus help", () => {
    expect(source).toContain("function setPlayerIdentity");
    expect(source).toContain('marker.className = "player-handicap"');
    expect(source).toContain("HANDICAP_EXPLANATION");
    expect(source).toContain('const HANDICAP_EXPLANATION = "Handicap measures win probability of cribbage decisions."');
    expect(source).toContain("playerHandicaps");
    expect(source).toContain('document.addEventListener("mouseover"');
    expect(source).toContain('document.addEventListener("focusin"');
    expect(css).toContain(".player-handicap-tooltip");
  });

  it("offers Ace advice only as a lower-level gameplay aid", () => {
    expect(html).toContain('id="ask-master"');
    expect(html).toContain('id="master-hint-dialog"');
    expect(html).toContain('id="master-hint-apply"');
    expect(html).toContain("Play Ace’s Pick");
    expect(source).toContain("function canAskMaster");
    expect(source).toContain('action: "master-hint"');
    expect(source).toContain("function requestMasterHint");
    expect(source).toMatch(/hint\.kind === "discard"[\s\S]*els\.discard\.click\(\)/);
    expect(source).toMatch(/hint\.kind === "play"[\s\S]*els\.play\.click\(\)/);
    expect(css).toContain(".master-hint-dialog");
  });

  it("provides a global online-player control with incoming challenges first", () => {
    expect(html).toContain('id="people-presence"');
    expect(html).toMatch(/id="people-presence-alert"[^>]*role="alert"/);
    expect(html).toContain('id="people-challenge-section"');
    expect(html).toContain('id="people-online-list"');
    expect(source).toMatch(/incomingChallenges[\s\S]*peopleChallengeList[\s\S]*peopleOnlineList/);
    expect(source).toContain("peopleDirectory.onlineCount");
    expect(css).toContain(".people-presence.has-challenge .people-presence-toggle");
    expect(css).toContain("@keyframes people-challenge-pulse");
  });

  it("wakes the online pill immediately and animates each new human challenge", () => {
    expect(source).toContain('"/api/people/challenges/watch"');
    expect(source).toContain("function startPeopleChallengeWatch");
    expect(source).toContain("function announceIncomingChallenge");
    expect(source).toContain('classList.add("challenge-arrived")');
    expect(source).toContain("challenged you to a game");
    expect(css).toContain("@keyframes people-challenge-arrived");
    expect(css).toContain("@keyframes people-challenge-badge-arrived");
  });

  it("uses real activity instead of background polling for 15-minute presence", () => {
    expect(source).toContain("const PEOPLE_IDLE_MS = 15 * 60 * 1000");
    expect(source).toMatch(/schedulePeoplePoll[\s\S]*await refreshPeople\(\{ heartbeat: Boolean\(authenticatedUser && peopleActive\) \}\);/);
    expect(source).toContain("function recordPeopleActivity");
    expect(source).toMatch(/pointerdown[\s\S]*recordPeopleActivity/);
    expect(source).toMatch(/keydown[\s\S]*recordPeopleActivity/);
  });

  it("supports public profiles and authenticated profile editing", () => {
    expect(html).toContain('id="people-profile-page"');
    expect(html).toContain('id="people-profile-username"');
    expect(html).toContain('id="people-profile-handicap"');
    expect(html).toContain('id="people-profile-email"');
    expect(html).toContain('id="people-profile-image"');
    expect(html).toContain('id="people-password-reset"');
    expect(html).toContain('id="people-profile-head-to-head"');
    expect(source).toContain('"/api/people/profile"');
    expect(source).toContain("Ace handicap:");
    expect(source).toContain('"/api/people/me"');
    expect(source).toContain('"/api/auth/password/request"');
  });

  it("shows a compact head-to-head section when one player views another profile", () => {
    expect(source).toContain("function renderPeopleHeadToHead");
    expect(source).toContain("No completed games together yet.");
    expect(css).toContain(".people-profile-head-to-head");
    expect(css).toContain(".people-head-to-head-score");
  });

  it("shares the online directory with Find a Human Opponent", () => {
    expect(html).toContain('data-pathway-view="human"');
    expect(html).toContain('id="human-directory"');
    expect(source).toContain("lookingForGame: isLookingForHumanGame()");
    expect(source).toMatch(/for \(const player of peopleDirectory\.players\)[\s\S]*player\.lookingForGame/);
    expect(css).toContain(".people-list-item.is-looking");
  });

  it("restores an active human game from the online pill and Human pathway", () => {
    expect(html).toContain('id="people-table-section"');
    expect(html).toContain('id="people-table-list"');
    expect(source).toContain("activeTable: HumanTable | null");
    expect(source).toContain("function resumableHumanTable");
    expect(source).toContain("function humanTableResumeItem");
    expect(source).toContain('actionLabel: "Resume"');
    expect(source).toContain("peopleDirectory.activeTable = table.phase === \"complete\" ? null : table");
    expect(source).toContain("pathwayUrl(route, true)");
    expect(css).toContain(".people-list-item.is-game");
    expect(css).toContain(".people-presence.has-game:not(.has-challenge)");
  });

  it("keeps each online row a single tap target and dismisses handicap help before navigation", () => {
    expect(source).toMatch(/setPlayerIdentity\(name, player\.displayName, player\.dynamicHandicap \?\? null, \{ interactive: false \}\)/);
    expect(css).toMatch(/\.people-list-item \.player-handicap\s*\{[^}]*pointer-events:\s*none/s);
    expect(source).toContain("function dismissHandicapTooltip");
    expect(source).toMatch(/function resumeHumanTable[\s\S]*dismissHandicapTooltip\(\)/);
    expect(source).toMatch(/async function openPeopleProfile[\s\S]*dismissHandicapTooltip\(\)/);
  });

  it("does not replace online rows during an in-flight pointer interaction", () => {
    expect(source).toContain("function beginPeopleDirectoryInteraction");
    expect(source).toContain("function finishPeopleDirectoryInteraction");
    expect(source).toMatch(/function applyPeopleDirectory[\s\S]*peopleDirectoryInteractionActive[\s\S]*pendingPeopleDirectory/);
    expect(source).toMatch(/peoplePresencePanel\.addEventListener\("pointerdown", beginPeopleDirectoryInteraction/);
    expect(source).toMatch(/document\.addEventListener\("pointerup", finishPeopleDirectoryInteraction/);
    expect(css).toMatch(/\.people-presence-toggle,[\s\S]*\.people-list-item\s*\{[^}]*touch-action:\s*manipulation/s);
  });

  it("shows the cached Online directory before starting its refresh", () => {
    const handler = source.match(/els\.peoplePresenceToggle\.addEventListener\("click", \(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? "";
    expect(handler).toContain("renderPeopleDirectory()");
    expect(handler.indexOf("renderPeopleDirectory()"))
      .toBeLessThan(handler.indexOf("refreshPeople("));
  });

  it("uses a visible-only one-minute presence heartbeat", () => {
    expect(source).toContain("const PEOPLE_POLL_MS = 60_000");
    expect(source).toMatch(/function schedulePeoplePoll[\s\S]*document\.visibilityState === "visible"[\s\S]*refreshPeople\(\{ heartbeat: Boolean\(authenticatedUser && peopleActive\) \}\)/);
    expect(source).toMatch(/visibilitychange[\s\S]*document\.visibilityState === "visible"[\s\S]*refreshPeople\(\{ heartbeat: Boolean\(authenticatedUser\) \}\)/);
  });

  it("opens a shared table, cuts for first deal, and enters the human game", () => {
    expect(html).toContain('id="human-table-page"');
    expect(html).toContain('id="human-table-cut"');
    expect(source).toContain('"/api/people/challenge"');
    expect(source).toContain('"/api/people/challenge/accept"');
    expect(source).toContain('"/api/people/table/cut"');
    expect(source).toContain('"/api/people/table/game"');
    expect(source).toContain('"/api/people/table/game/action"');
    expect(source).toContain('kind: "table"');
    expect(source).toContain("Low card deals first.");
    expect(source).toContain("async function enterHumanGame");
    expect(source).toMatch(/response\.table\.phase === "playing"[\s\S]*await enterHumanGame\(\)/);
    expect(source).toMatch(/function scheduleHumanTablePoll[\s\S]*catch \(error\)[\s\S]*scheduleHumanTablePoll\(\)/);
  });

  it("watches a human opponent instead of asking the AI engine to move", () => {
    expect(source).toContain("function startHumanGameSync");
    expect(source).toContain('"/api/people/table/game/watch"');
    expect(source).toMatch(/function shouldAdvancePeggingAi[\s\S]*!activeHumanTable/);
    expect(source).toMatch(/const optimisticNext = activeHumanTable \? null/);
    expect(source).toMatch(/next\.phase === "ai_discarding"[\s\S]*activeHumanTable[\s\S]*startHumanGameSync\(\)/);
    expect(source).toMatch(/els\.go\.hidden = !\(activeHumanTable[\s\S]*game\.canGo/);
    expect(source).toMatch(/function shouldAutoHumanGo[\s\S]*!activeHumanTable/);
  });

  it("applies human game state monotonically and acknowledges retried actions", () => {
    expect(source).toMatch(/sameTable && response\.revision < humanGameRevision/);
    expect(source).toContain("function humanGameCommand");
    expect(source).toContain("actionId: command.actionId");
    expect(source).toMatch(/!acknowledgment[\s\S]*acknowledgment\.actionId !== command\.actionId/);
    expect(source).toContain("pendingHumanGameCommand?.actionId === command.actionId");
  });

  it("refreshes the authoritative human game after returning to the page", () => {
    expect(source).toContain("function refreshVisibleHumanGame");
    expect(source).toMatch(/window\.addEventListener\("pageshow"[\s\S]*event\.persisted[\s\S]*refreshVisibleHumanGame/);
    expect(source).toMatch(/document\.addEventListener\("visibilitychange"[\s\S]*document\.visibilityState === "visible"[\s\S]*refreshVisibleHumanGame/);
  });

  it("replaces a stale count summary when the other player advances scoring", () => {
    expect(source).toMatch(/function applyHumanGameResponse[\s\S]*currentScoringScoreEvent\(response\.snapshot\.gameId \?\? null, response\.state\)/);
    expect(source).toMatch(/state\.activeScoreSummary\.key !== currentScoreEvent\?\.id[\s\S]*state\.activeScoreSummary = null/);
  });

  it("reviews both human players with Ace and exposes player tabs after the game", () => {
    expect(source).toContain('"/api/people/table/game/review"');
    expect(source).toContain('tabs.setAttribute("aria-label", "Player errors")');
    expect(source).toContain('className = "decision-review-tab"');
    expect(source).toMatch(/sortedDecisionMistakes\(events, end\.gameId, reviewPlayer\)/);
    expect(source).toMatch(/humanTablePage\.hidden && !activeHumanTable && !pendingAuthDestination/);
    expect(css).toContain(".decision-review-tabs");
    expect(css).toContain('.decision-review-tab[aria-selected="true"]');
  });

  it("keeps motion optional and layouts responsive", () => {
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*\.human-table-felt/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain(".people-presence-toggle:focus-visible");
  });
});
