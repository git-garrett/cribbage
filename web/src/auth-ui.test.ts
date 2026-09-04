// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const landing = readFileSync(new URL("../public/coming-soon.html", import.meta.url), "utf8");

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

  it("offers prospective players a direct way to request preview access", () => {
    expect(html).toContain('href="https://strongcribbage.com/#request-access">Request preview access</a>');
    expect(landing).toContain('id="request-access"');
    for (const field of ["firstName", "lastName", "username", "email"]) {
      expect(landing).toMatch(new RegExp(`<input[^>]+name="${field}"[^>]+required`));
    }
    expect(landing).toContain('/api/auth/access-request');
  });

  it("requires authentication before revealing any application area", () => {
    expect(source).toContain("const AUTHENTICATION_ENABLED = true;");
    expect(html).toContain('<body data-auth="checking">');
    expect(css).toMatch(/body\[data-auth="checking"\] \.pathway-page/);
    expect(css).toMatch(/body\[data-auth="signed-out"\] \.people-presence/);
    expect(source).toContain("function locationAuthenticationRequest");
    expect(source).toContain('kind: "table"');
    expect(source).toContain('kind: "profile"');
  });

  it("keeps credentials in secure server sessions rather than browser storage", () => {
    expect(source).toContain('credentials: "include"');
    expect(source).not.toMatch(/localStorage[^\n]*(token|password)/i);
    expect(css).toMatch(/body\[data-auth="signed-out"\] \.app/);
  });

  it("rechecks an interrupted account session when Safari returns to the page", () => {
    expect(source).toContain("function recoverInterruptedAuthentication");
    expect(source).toMatch(/addEventListener\("pageshow",[\s\S]*recoverInterruptedAuthentication\(\)/);
    expect(source).toMatch(/visibilitychange[\s\S]*recoverInterruptedAuthentication/);
  });

  it("uses the cribbage peg-track brand signature", () => {
    expect(html).toContain('class="auth-peg-track"');
    expect(css).toMatch(/\.auth-peg-track i\s*\{[^}]*border-radius:\s*50%/s);
    expect(css).toContain("--auth-green: #0b5b43");
    expect(css).toContain("--auth-gold: #e8c575");
  });
});
