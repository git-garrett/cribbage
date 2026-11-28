// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAceOpponent, PRODUCTION_ACE_OPPONENT } from "./ace-opponent";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("curated opponent selection", () => {
  it("keeps experimental Ace 28.4 separate from production Ace", () => {
    expect(PRODUCTION_ACE_OPPONENT).toBe("schell_table-peg_table-28.3.fast");
    expect(isAceOpponent("schell_table-peg_table-28.4")).toBe(false);
  });

  it("keeps the AI selector unavailable in both browser and mobile markup", () => {
    expect(html).toMatch(/class="opponent-control" hidden[\s\S]*<select id="opponent" disabled>/);
  });

  it("maps the available pathway tiers to server opponents", () => {
    expect(source).toContain("const DEFAULT_OPPONENT: Opponent = PRODUCTION_ACE_OPPONENT");
    expect(source).toMatch(/const PATHWAY_OPPONENTS = \{\s*easy: "myrmidon-5",\s*tough: "schell_table-peg_table-9\.11",\s*master: DEFAULT_OPPONENT,\s*dynamic: "dynamic"/);
    expect(source).toMatch(/function selectedMenuOpponent\(\): Opponent \{\s*return SIMPLE_NETWORK_MODE \? selectedPathwayOpponent \?\? SIMPLE_NETWORK_OPPONENT : DEFAULT_OPPONENT;/);
    expect(source).toMatch(/pathwayDestinationButtons[\s\S]*const destination = button\.dataset\.pathwayDestination;[\s\S]*pathwayOpponent\(destination\)[\s\S]*launchPathwayOpponent\(opponent\)/);
    expect(source).toMatch(/if \(path === "\/api\/new"\) \{\s*return serverGameAction\("new", \{ opponent: selectedMenuOpponent\(\) \}\);/);
    expect(source).not.toMatch(/body\?\.opponent as Opponent/);
  });
});
