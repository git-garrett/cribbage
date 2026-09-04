import { describe, expect, it } from "vitest";

import { shouldRecoverExpiredSession } from "./auth-recovery";

describe("expired authenticated sessions", () => {
  it("recovers an authenticated 401 through the login view", () => {
    expect(shouldRecoverExpiredSession(401, "/api/new")).toBe(true);
    expect(shouldRecoverExpiredSession(401, "/api/people/me")).toBe(true);
  });

  it("does not reinterpret login failures or server failures", () => {
    expect(shouldRecoverExpiredSession(401, "/api/auth/login")).toBe(false);
    expect(shouldRecoverExpiredSession(403, "/api/new")).toBe(false);
    expect(shouldRecoverExpiredSession(500, "/api/new")).toBe(false);
  });
});
