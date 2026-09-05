import { describe, expect, it } from "vitest";

import { resumablePathwayDestinations } from "./pathway-resume";

describe("Play Now resume presentation", () => {
  it("marks every model card that has an active saved game", () => {
    expect(resumablePathwayDestinations({
      modelGames: [
        { opponent: "myrmidon-5", phase: "pegging" },
        { opponent: "schell_table-peg_table-9.11", phase: "discard" },
        { opponent: "schell_table-peg_table-13.215", phase: "score_pone" },
        { opponent: "dynamic", phase: "score_crib" },
      ],
      humanGameActive: false,
    })).toEqual(["easy", "tough", "master", "dynamic"]);
  });

  it("maps active Easy, Tough, and Ace games to their corresponding cards", () => {
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "myrmidon-5", phase: "pegging" }], humanGameActive: false })).toEqual(["easy"]);
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "schell_table-peg_table-9.11", phase: "discard" }], humanGameActive: false })).toEqual(["tough"]);
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "schell_table-peg_table-13.215", phase: "score_pone" }], humanGameActive: false })).toEqual(["master"]);
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "schell_table-peg_table-13.0", phase: "score_pone" }], humanGameActive: false })).toEqual(["master"]);
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "dynamic", phase: "pegging" }], humanGameActive: false })).toEqual(["dynamic"]);
  });

  it("marks an active human table and excludes completed model games", () => {
    expect(resumablePathwayDestinations({ modelGames: [{ opponent: "myrmidon-5", phase: "game_over" }], humanGameActive: true })).toEqual(["human"]);
  });
});
