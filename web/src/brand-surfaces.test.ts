// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const homepageHtml = readFileSync(new URL("../public/coming-soon.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("branded entry surfaces", () => {
  it("uses the dark-background lockup on both the homepage and first-name screen", () => {
    expect(appHtml).toMatch(/class="splash-logo" src="\/brand\/strong-cribbage-lockup-dark\.svg"/);
    expect(homepageHtml).toMatch(/src="\/brand\/strong-cribbage-lockup-dark\.svg"/);
    expect(homepageHtml).not.toMatch(/src="\/icon-512\.png"/);
  });

  it("carries the green, navy, cream, and gold game palette into the first-name screen", () => {
    expect(css).toMatch(/\.splash-page\s*\{[^}]*--splash-green:\s*#0b5b43[^}]*--splash-navy:\s*#071f38[^}]*--splash-cream:\s*#fbf8f0[^}]*--splash-gold:\s*#e8c575/s);
    expect(css).toMatch(/\.splash-shell\s*\{[^}]*background:\s*rgba\(7,\s*31,\s*56,\s*0\.94\)/s);
  });
});
