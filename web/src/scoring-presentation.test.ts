// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("scoring presentation", () => {
  it("places opponent scoring at the north edge and player scoring at the south edge", () => {
    expect(mainSource).toContain('els.scoringReview.dataset.owner = scoring.owner === "AI" ? "ai" : "human"');
    expect(css).toMatch(/\.scoring-review\[data-owner="ai"\]\s*\{[^}]*top:\s*18px[^}]*bottom:\s*auto/s);
    expect(css).toMatch(/\.scoring-review\[data-owner="human"\]\s*\{[^}]*top:\s*auto[^}]*bottom:\s*18px/s);
    expect(css).toMatch(/\.scoring-review #scoring-cards\s*\{[^}]*flex-wrap:\s*nowrap[^}]*justify-content:\s*center[^}]*margin-top:\s*calc\(\(var\(--game-card-height\) \* 0\.2\) \+ 8px\)/s);
    expect(css).toMatch(/\.scoring-review\[data-owner="ai"\][^{]*\{[^}]*--scoring-owner-accent:\s*var\(--ai\)/s);
    expect(css).toMatch(/\.scoring-review\[data-owner="human"\][^{]*\{[^}]*--scoring-owner-accent:\s*var\(--human\)/s);
  });

  it("swipes the completed rack away before the next owner rack enters and scoring resumes", () => {
    expect(mainSource).toContain('type ScoringTransitionStage = "leaving" | "entering" | null');
    expect(mainSource).toContain('els.scoringReview.dataset.transition = state.scoringTransitionStage');
    expect(mainSource).toContain('if (state.scoringTransitionStage === "entering")');
    expect(mainSource).toContain("await playScoringStageTransition");
    expect(css).toMatch(/\.scoring-review\[data-transition="leaving"\][^{]*\{[^}]*animation:\s*scoring-rack-leave\s+220ms/s);
    expect(css).toMatch(/\.scoring-review\[data-transition="entering"\][^{]*\{[^}]*animation:\s*scoring-rack-enter\s+300ms/s);
    expect(css).toContain("@keyframes scoring-rack-leave");
    expect(css).toContain("@keyframes scoring-rack-enter");
  });

  it("lifts scoring cards one fifth of a card before the delayed bubble appears", () => {
    expect(mainSource).toContain('bubble.dataset.cardEmphasis = notice.emphasizedCardIds.length ? "true" : "false"');
    expect(mainSource).toContain('card.classList.add("score-card-lift")');
    expect(css).toMatch(/\.game-notification-score\[data-card-emphasis="true"\][^{]*\{[^}]*animation-name:\s*game-score-notification-after-lift[^}]*animation-delay:\s*420ms[^}]*animation-duration:\s*1\.78s/s);
    expect(css).toMatch(/@keyframes game-score-notification-after-lift[\s\S]*68%\s*\{[^}]*opacity:\s*1[\s\S]*100%\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(/@keyframes score-card-lift-cycle[\s\S]*translateY\(calc\(var\(--game-card-height\) \* -0\.2\)\)[\s\S]*translateY\(0\)/s);
    expect(css).not.toContain("score-card-wiggle");
  });
});
