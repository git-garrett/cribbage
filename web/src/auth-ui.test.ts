// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("account entry", () => {
  it("offers password, email code, reset, and invitation setup surfaces", () => {
    expect(html).toContain('id="auth-login-form"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('id="auth-password-form"');
    expect(source).toContain('"/api/auth/otp/request"');
    expect(source).toContain('"/api/auth/password/reset"');
    expect(source).toContain('"/api/auth/invite/accept"');
  });

  it("keeps credentials in secure server sessions rather than browser storage", () => {
    expect(source).toContain('credentials: "include"');
    expect(source).not.toMatch(/localStorage[^\n]*(token|password)/i);
    expect(css).toMatch(/body\[data-auth="signed-out"\] \.app/);
  });

  it("uses the cribbage peg-track brand signature", () => {
    expect(html).toContain('class="auth-peg-track"');
    expect(css).toMatch(/\.auth-peg-track i\s*\{[^}]*border-radius:\s*50%/s);
    expect(css).toContain("--auth-green: #0b5b43");
    expect(css).toContain("--auth-gold: #e8c575");
  });
});
