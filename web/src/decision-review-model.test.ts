// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../rust/cribbage-api/main.rs", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("postgame decision reviewer", () => {
  it("always presents and runs analysis with Ace regardless of the game opponent", () => {
    expect(mainSource).toContain('const DECISION_REVIEWER_NAME = "Ace"');
    expect(mainSource).toContain('`Analyze with ${DECISION_REVIEWER_NAME}`');
    expect(mainSource).toContain('`Compared with ${DECISION_REVIEWER_NAME} decision analysis.');
    expect(mainSource).not.toContain('`Analyze with ${playerName("ai")}`');

    const reviewImplementation = apiSource.match(/fn evaluate_saved_decision_review\([\s\S]*?\n}\n\nfn completed_review/)?.[0] ?? "";
    expect(reviewImplementation.match(/ACE_MODEL_ID/g)).toHaveLength(2);
  });

  it("gives both postgame calls to action the branded rounded treatment", () => {
    const sharedActions = stylesSource.match(/\.report-new-game,\n\.decision-review-analyze \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(sharedActions).toContain("border: 2px solid var(--game-gold, #e8c575)");
    expect(sharedActions).toContain("border-radius: 999px");
    expect(sharedActions).toContain("min-height: max(54px");
    expect(stylesSource).toContain(".report-new-game:focus-visible");
    expect(stylesSource).toContain(".decision-review-analyze:focus-visible");
  });
});
