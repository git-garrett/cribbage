// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("opponent selection lock", () => {
  it("keeps the AI selector unavailable in both browser and mobile markup", () => {
    expect(html).toMatch(/class="opponent-control" hidden[\s\S]*<select id="opponent" disabled>/);
  });

  it("pins new games to the configured client default instead of submitted UI state", () => {
    expect(source).toMatch(/function selectedMenuOpponent\(\): Opponent \{\s*return SIMPLE_NETWORK_MODE \? SIMPLE_NETWORK_OPPONENT : DEFAULT_OPPONENT;/);
    expect(source).toMatch(/if \(path === "\/api\/new"\) \{\s*return serverGameAction\("new", \{ opponent: selectedMenuOpponent\(\) \}\);/);
    expect(source).not.toMatch(/body\?\.opponent as Opponent/);
  });
});
