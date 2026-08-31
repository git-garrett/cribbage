// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const homepageHtml = readFileSync(new URL("../public/coming-soon.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("browser color-scheme support", () => {
  it("publishes mode-specific browser chrome colors", () => {
    for (const html of [appHtml, homepageHtml]) {
      expect(html).toMatch(/name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/i);
      expect(html).toMatch(/name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/i);
    }
  });

  it("defines light and dark entry materials instead of inverting arbitrary colors", () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light[^}]*--entry-canvas:\s*#e8eee9[^}]*--entry-panel:\s*#fbf8f0[^}]*--entry-accent:\s*#8f6720/s);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*color-scheme:\s*dark[^}]*--entry-canvas:\s*#042d22[^}]*--entry-panel:\s*#071f38[^}]*--entry-accent:\s*#e8c575/s);
    expect(homepageHtml).toContain("--gold: #8f6720");
    expect(homepageHtml).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*color-scheme:\s*dark/);
  });

  it("routes every entry lockup through picture source selection", () => {
    for (const className of ["pathway-logo", "auth-logo", "splash-logo"]) {
      expect(appHtml).toMatch(new RegExp(`<picture class="${className}">[\\s\\S]*?prefers-color-scheme: dark[\\s\\S]*?lockup-dark\\.svg[\\s\\S]*?lockup-light\\.svg[\\s\\S]*?<\\/picture>`));
    }
    expect(homepageHtml).toMatch(/<picture class="homepage-logo">[\s\S]*?lockup-dark\.svg[\s\S]*?lockup-light\.svg[\s\S]*?<\/picture>/);
  });

  it("keeps the approved physical gameplay palette stable while theming its surrounding UI", () => {
    expect(css).toMatch(/\.app\[data-view="game"\]\s*\{[^}]*--game-cream:\s*#fbf8f0[^}]*--game-gold:\s*#e8c575[^}]*--game-navy:\s*#071f38[^}]*--game-green:\s*#0b5b43/s);
    expect(css).toMatch(/\.settings-panel\s*\{[^}]*background:\s*var\(--surface\)/s);
    expect(css).toMatch(/\.analytics-page,[\s\S]*?background:\s*var\(--surface\)/s);
    expect(css).toContain("color: var(--comparison-good)");
    expect(css).toContain("color: var(--comparison-bad)");
  });
});
