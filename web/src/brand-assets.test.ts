// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const homepageHtml = readFileSync(new URL("../public/coming-soon.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"));
const fullMark = readFileSync(new URL("../../resources/brand/vector/strong-cribbage-mark.svg", import.meta.url), "utf8");
const microMark = readFileSync(new URL("../../resources/brand/vector/strong-cribbage-mark-micro.svg", import.meta.url), "utf8");
const brandReadme = readFileSync(new URL("../../resources/brand/README.md", import.meta.url), "utf8");

function pngDimensions(relativeUrl: string): [number, number] {
  const image = readFileSync(new URL(relativeUrl, import.meta.url));
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

describe("Counted Monogram asset system", () => {
  it("routes every HTML logo placement to the production brand family", () => {
    expect(appHtml.match(/\/brand\/strong-cribbage-lockup-dark\.svg/g)).toHaveLength(4);
    expect(homepageHtml).toContain('/brand/strong-cribbage-lockup-dark.svg');
    expect(`${appHtml}\n${homepageHtml}`).not.toContain('/strong-cribbage-dark-lockup.svg');
  });

  it("uses an intentionally simpler mark for favicon sizes", () => {
    expect(fullMark.match(/<circle /g)).toHaveLength(5);
    expect(microMark).not.toContain("<circle");
    expect(appHtml).toContain('href="/brand/strong-cribbage-mark-micro.svg"');
    expect(homepageHtml).toContain('href="/brand/strong-cribbage-mark-micro.svg"');
  });

  it("describes the 1200 by 630 share image for social clients and iMessage", () => {
    for (const html of [appHtml, homepageHtml]) {
      expect(html).toContain("social-preview-counted-monogram.png");
      expect(html).toContain('<meta property="og:image:width" content="1200">');
      expect(html).toContain('<meta property="og:image:height" content="630">');
      expect(html).toMatch(/<meta property="og:image:alt" content="[^"]+">/);
      expect(html).toMatch(/<meta name="twitter:image:alt" content="[^"]+">/);
    }
  });

  it("ships install icons at standard PWA sizes", () => {
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icon-512.png", sizes: "512x512" }),
    ]));
    expect(pngDimensions("../public/icon-192.png")).toEqual([192, 192]);
    expect(pngDimensions("../public/icon-512.png")).toEqual([512, 512]);
    expect(pngDimensions("../public/apple-touch-icon.png")).toEqual([180, 180]);
    expect(pngDimensions("../public/favicon-32x32.png")).toEqual([32, 32]);
    expect(pngDimensions("../public/favicon-16x16.png")).toEqual([16, 16]);
  });

  it("exports the social and native iOS masters at their production dimensions", () => {
    expect(pngDimensions("../public/social-preview-counted-monogram.png")).toEqual([1200, 630]);
    expect(pngDimensions("../public/social-preview.png")).toEqual([1200, 630]);
    expect(pngDimensions("../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")).toEqual([1024, 1024]);
    expect(pngDimensions("../../ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png")).toEqual([2732, 2732]);
  });

  it("records the legacy artwork as deprecated", () => {
    expect(brandReadme).toContain("## Deprecated assets");
    expect(brandReadme).toContain("legacy/app-icon-v1.svg");
    expect(brandReadme).toContain("legacy/strong-cribbage-dark-lockup-v1.svg");
    expect(brandReadme).toContain("web/strong-cribbage-logo.png");
  });
});
