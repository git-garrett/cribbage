import { describe, expect, it } from "vitest";

import { shouldUploadCompletedGame } from "./upload-policy";

describe("shouldUploadCompletedGame", () => {
  it("blocks forced history uploads until a player name exists", () => {
    expect(shouldUploadCompletedGame({
      remoteEnabled: true,
      force: true,
      alreadyUploaded: false,
      playerTag: "",
    })).toBe(false);

    expect(shouldUploadCompletedGame({
      remoteEnabled: true,
      force: true,
      alreadyUploaded: false,
      playerTag: "   ",
    })).toBe(false);
  });

  it("allows history uploads after a player name is added", () => {
    expect(shouldUploadCompletedGame({
      remoteEnabled: true,
      force: true,
      alreadyUploaded: false,
      playerTag: "Garrett",
    })).toBe(true);
  });

  it("preserves the remote and duplicate-upload guards", () => {
    expect(shouldUploadCompletedGame({
      remoteEnabled: false,
      force: true,
      alreadyUploaded: false,
      playerTag: "Garrett",
    })).toBe(false);

    expect(shouldUploadCompletedGame({
      remoteEnabled: true,
      force: false,
      alreadyUploaded: true,
      playerTag: "Garrett",
    })).toBe(false);
  });

  it("never uploads QA games from a local development session", () => {
    expect(shouldUploadCompletedGame({
      remoteEnabled: true,
      localQaMode: true,
      force: true,
      alreadyUploaded: false,
      playerTag: "Garrett",
    })).toBe(false);
  });
});
