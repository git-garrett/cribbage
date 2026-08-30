// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("Concept B mobile playing UI", () => {
  it("uses the scalable dark lockup and live hand number in the header", () => {
    expect(html).toMatch(/class="app-brand-logo" src="\/strong-cribbage-dark-lockup\.svg"/);
    expect(html).toMatch(/id="hand-number" class="hand-number"/);
    expect(mainSource).toMatch(/els\.handNumber\.textContent = `Hand \$\{game\.handNumber\}`/);
  });

  it("moves the text-size selector inside the hamburger menu", () => {
    expect(html).toMatch(/id="settings-panel"[^>]*>[\s\S]*class="font-size-control"[\s\S]*id="font-size-select"/);
  });

  it("uses the circular track for normal mobile without changing the desktop lanes", () => {
    expect(css).toMatch(/body\[data-font-size="normal"\] \.board > \.lane\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\[data-font-size="normal"\] \.circular-board\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.circular-board\s*\{[^}]*display:\s*none/s);
  });

  it("names the play action for the selected card", () => {
    expect(mainSource).toMatch(/els\.play\.textContent = selectedPlay \? `Play \$\{selectedPlay\.rank\}\$\{selectedPlay\.symbol\}` : "Select a card"/);
  });
});
