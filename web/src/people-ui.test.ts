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
    expect(source).toMatch(/state\.selectedLogGameId = game\.gameId;[\s\S]*state\.decisionReviewOpen = true/);
    expect(source).toContain("renderGameReportInto(");
  });

  it("uses player and opponent names throughout the playing surface", () => {
    expect(html).toContain('id="human-name"');
    expect(html).toContain('id="ai-name"');
    expect(html).toContain('id="ai-hand-title"');
    expect(source).toContain("function playerDisplayName");
    expect(source).toContain("function playerPossessive");
    expect(source).toContain('if (engine === PATHWAY_OPPONENTS.tough) return "Tough"');
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
    expect(html).toContain('id="people-challenge-section"');
    expect(html).toContain('id="people-online-list"');
    expect(source).toMatch(/incomingChallenges[\s\S]*peopleChallengeList[\s\S]*peopleOnlineList/);
    expect(source).toContain("peopleDirectory.onlineCount");
    expect(css).toContain(".people-presence.has-challenge .people-presence-toggle");
    expect(css).toContain("@keyframes people-challenge-pulse");
  });

  it("supports public profiles and authenticated profile editing", () => {
    expect(html).toContain('id="people-profile-page"');
    expect(html).toContain('id="people-profile-username"');
    expect(html).toContain('id="people-profile-email"');
    expect(html).toContain('id="people-profile-image"');
    expect(html).toContain('id="people-password-reset"');
    expect(html).toContain('id="people-profile-head-to-head"');
    expect(source).toContain('"/api/people/profile"');
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

  it("opens a shared waiting table and cuts for first deal", () => {
    expect(html).toContain('id="human-table-page"');
    expect(html).toContain('id="human-table-cut"');
    expect(source).toContain('"/api/people/challenge"');
    expect(source).toContain('"/api/people/challenge/accept"');
    expect(source).toContain('"/api/people/table/cut"');
    expect(source).toContain('kind: "table"');
    expect(source).toContain("Low card deals first.");
  });

  it("keeps motion optional and layouts responsive", () => {
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*\.human-table-felt/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain(".people-presence-toggle:focus-visible");
  });
});
