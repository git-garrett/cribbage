import { describe, expect, it } from "vitest";

import { resumablePathwayDestinations } from "./pathway-resume";

describe("Play Now resume presentation", () => {
  it("maps active Easy, Tough, and Ace games to their corresponding cards", () => {
    expect(resumablePathwayDestinations({ opponent: "myrmidon-5", phase: "pegging", modelGameActive: true, humanGameActive: false })).toEqual(["easy"]);
    expect(resumablePathwayDestinations({ opponent: "schell_table-peg_table-9.11", phase: "discard", modelGameActive: true, humanGameActive: false })).toEqual(["tough"]);
    expect(resumablePathwayDestinations({ opponent: "schell_table-peg_table-13.0", phase: "score_pone", modelGameActive: true, humanGameActive: false })).toEqual(["master"]);
  });

  it("marks an active human table and excludes completed model games", () => {
    expect(resumablePathwayDestinations({ opponent: "myrmidon-5", phase: "game_over", modelGameActive: true, humanGameActive: true })).toEqual(["human"]);
  });
});
