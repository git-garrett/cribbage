import { describe, expect, it } from "vitest";
import { BEGINNER_DRILLS, DrillProgression } from "./training-drills";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("beginner training drills", () => {
  it("loads the generated discard and scoring catalogs", () => {
    expect(BEGINNER_DRILLS["find-scoring-play"].length).toBeGreaterThan(1_000);
    expect(BEGINNER_DRILLS.discard.length).toBeGreaterThan(300);
    expect(BEGINNER_DRILLS["find-scoring-play"].every((drill) => drill.answer.length === 1)).toBe(true);
    expect(BEGINNER_DRILLS.discard.every((drill) => drill.answer.length === 2)).toBe(true);
  });

  it("does not present a solved drill again while unsolved drills remain", () => {
    const storage = new MemoryStorage();
    const progression = new DrillProgression(storage, () => 0);
    const first = progression.next("discard");
    progression.markSolved("discard", first.id);
    const second = progression.next("discard");

    expect(second.id).not.toBe(first.id);
    expect(progression.progress("discard").solved).toEqual([first.id]);
  });

  it("keeps failed or skipped drills eligible and avoids an immediate repeat", () => {
    const progression = new DrillProgression(new MemoryStorage(), () => 0);
    const first = progression.next("find-scoring-play");
    const next = progression.next("find-scoring-play", first.id);

    expect(next.id).not.toBe(first.id);
    expect(progression.progress("find-scoring-play").solved).toEqual([]);
  });

  it("starts a fresh random cycle after every drill has been solved", () => {
    const storage = new MemoryStorage();
    const progression = new DrillProgression(storage, () => 0);
    for (const drill of BEGINNER_DRILLS.discard) progression.markSolved("discard", drill.id);

    expect(progression.progress("discard").solved).toEqual([]);
    expect(progression.next("discard")).toBeDefined();
  });

  it("identifies the scoring opportunity for corrective feedback", () => {
    const labels = new Set(BEGINNER_DRILLS["find-scoring-play"].map((drill) => drill.opportunity));
    expect(labels.has("a fifteen")).toBe(true);
    expect([...labels].some((label) => label?.startsWith("a run of"))).toBe(true);
    expect(labels.has("a pair")).toBe(true);
  });
});
