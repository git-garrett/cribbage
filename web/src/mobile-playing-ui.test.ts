// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("Concept B mobile playing UI", () => {
  it("uses the scalable dark lockup and a pathway-style home control in the header", () => {
    expect(html).toMatch(/class="app-brand-logo" src="\/brand\/strong-cribbage-lockup-dark\.svg"/);
    expect(html).toMatch(/<picture class="splash-logo">[\s\S]*?lockup-dark\.svg[\s\S]*?lockup-light\.svg[\s\S]*?<\/picture>/);
    expect(html).toMatch(/id="app-back" class="pathway-back app-back"/);
    expect(html).not.toMatch(/id="hand-number"/);
    expect(html).not.toMatch(/id="new-game"/);
    expect(mainSource).toMatch(/els\.appBack\.addEventListener\("click", \(\) => \{[\s\S]*navigatePathway\("home"\)/);
  });

  it("moves the text-size selector inside the hamburger menu", () => {
    expect(html).toMatch(/id="settings-panel"[^>]*>[\s\S]*class="font-size-control"[\s\S]*id="font-size-select"/);
  });

  it("uses the circular track for normal mobile without changing the desktop lanes", () => {
    expect(css).toMatch(/body\[data-font-size="normal"\] \.board > \.lane\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\[data-font-size="normal"\] \.circular-board\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.circular-board\s*\{[^}]*display:\s*none/s);
  });

  it("keeps a disabled play prompt visible until a card is selected, then names that card", () => {
    const visibilityRule = mainSource.match(/els\.play\.hidden = ([^;]*);/)?.[1] ?? "";
    expect(visibilityRule).toContain('game.phase === "pegging"');
    expect(visibilityRule).toContain('game.turn === "User"');
    expect(visibilityRule).not.toContain("selectedPlay");
    expect(mainSource).toMatch(/els\.play\.disabled = [^;]*game\.phase === "pegging"[^;]*game\.turn === "User" && selectedPlay/);
    expect(mainSource).toMatch(/els\.play\.textContent = selectedPlay \? `Play \$\{selectedPlay\.rank\}\$\{selectedPlay\.symbol\}` : "Play selected"/);
  });
});
