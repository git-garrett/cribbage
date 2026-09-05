// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("player feedback controls", () => {
  it("offers a viewport-safe Bug report trigger with an accessible invitation", () => {
    expect(html).toMatch(/id="bug-report-open"[^>]*aria-describedby="bug-report-help"[^>]*aria-haspopup="dialog"/);
    expect(html).toMatch(/id="bug-report-help"[^>]*role="tooltip"[^>]*>[^<]*anything looks wrong/i);
    expect(css).toMatch(/\.bug-report-dock\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*max\([^}]*z-index:\s*5200/s);
    expect(css).toMatch(/\.bug-report-dock:is\(:hover, :focus-within\) \.feedback-tooltip/);
  });

  it("collects a concise bug description and optional screenshot in a modal", () => {
    expect(html).toMatch(/id="bug-report-dialog"[^>]*aria-labelledby="bug-report-title"/);
    expect(html).toMatch(/id="bug-report-description"[^>]*minlength="10"[^>]*maxlength="2000"[^>]*required/);
    expect(html).toMatch(/id="bug-report-screenshot"[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
    expect(source).toContain("const MAX_FEEDBACK_SCREENSHOT_BYTES = 5 * 1024 * 1024");
    expect(source).toMatch(/function screenshotDataUrl[\s\S]*FileReader/s);
    expect(source).toContain('submitFeedback("/api/feedback/bug-report"');
  });

  it("places Feature Request beside the home title with the supplied tooltip", () => {
    expect(html).toMatch(/class="pathway-title-row"[\s\S]*id="feature-request-open"[^>]*>Feature Request<\/button>/);
    expect(html).toContain("Ask for a feature that will make playing strong cribbage better! I'll read every one and build as many as I can");
    expect(css).toMatch(/@media \(min-width: 720px\)[\s\S]*\.feature-request-dock\s*\{[^}]*grid-column:\s*3/s);
    expect(source).toContain('submitFeedback("/api/feedback/feature-request"');
  });

  it("provides clear modal validation, sending, success, and failure states", () => {
    expect(html).toMatch(/id="bug-report-status"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="feature-request-status"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(source).toContain('status.dataset.state = "sending"');
    expect(source).toContain('status.dataset.state = "success"');
    expect(source).toContain('status.dataset.state = "error"');
    expect(css).toMatch(/\.feedback-status\[data-state="success"\]/);
    expect(css).toMatch(/\.feedback-status\[data-state="error"\]/);
  });
});
