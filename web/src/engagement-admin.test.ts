// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("private engagement administration", () => {
  it("exposes the report only when the authenticated session grants admin access", () => {
    expect(source).toContain("authenticatedUser?.engagementAdmin");
    expect(source).toContain('authJson<EngagementReport>("/api/admin/engagement", { days })');
    expect(html).toMatch(/id="engagement-pathway-open"[^>]*hidden/);
    expect(html).toMatch(/id="engagement-menu-open"/);
  });

  it("reports the planned engagement dimensions and their denominators", () => {
    for (const id of ["overview", "funnel", "pathways", "opponents", "devices", "daily"]) {
      expect(html).toContain(`id="engagement-${id}"`);
    }
    expect(source).toContain("Distinct signed-in accounts plus anonymous tab sessions.");
    expect(source).toContain("Signed-in accounts active on at least two UTC dates.");
    expect(source).toContain("Unresolved page-exit abandonment candidates.");
  });

  it("supports every planned date window, empty states, and CSV export", () => {
    for (const days of ["1", "7", "30", "90", "0"]) {
      expect(html).toContain(`option value="${days}"`);
    }
    expect(source).toContain('type: "text/csv;charset=utf-8"');
    expect(source).toContain("No activity was recorded in this window.");
    expect(css).toContain(".engagement-empty");
  });

  it("keeps the report readable on desktop and phone layouts", () => {
    expect(css).toContain('.app[data-view="engagement"] > .scoreboard');
    expect(css).toMatch(/\.engagement-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(4/s);
    expect(css).toMatch(/@media \(max-width:\s*560px\)[\s\S]*\.engagement-metrics,[\s\S]*grid-template-columns:\s*1fr/s);
  });
});
