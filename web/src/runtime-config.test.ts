import { describe, expect, it } from "vitest";

import { DEPLOYED_API_BASE, resolveRemoteAiBase } from "./runtime-config";

describe("resolveRemoteAiBase", () => {
  it("uses the deployed API for a native Capacitor app", () => {
    expect(resolveRemoteAiBase("", true)).toBe(DEPLOYED_API_BASE);
  });

  it("keeps the web app on same-origin API requests", () => {
    expect(resolveRemoteAiBase("", false)).toBe("");
  });

  it("preserves an explicit API override", () => {
    expect(resolveRemoteAiBase("?api=https%3A%2F%2Fexample.test%2F", true)).toBe("https://example.test");
    expect(resolveRemoteAiBase("?api=https%3A%2F%2Fexample.test%2F", false)).toBe("https://example.test");
  });
});
