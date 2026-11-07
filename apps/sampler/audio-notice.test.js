import { describe, expect, it } from "vitest";
import { audioNoticeText } from "./audio-notice.js";

describe("audioNoticeText", () => {
  it("says nothing once audio is running", () => {
    expect(audioNoticeText("running")).toBe("");
  });

  it("tells the person how to turn sound on before any context exists", () => {
    // "closed" is what the engine reports on a fresh load, before the first click.
    expect(audioNoticeText("closed")).toMatch(/click.*press a key/i);
  });

  it("keeps telling them while the browser holds the context suspended or interrupted", () => {
    expect(audioNoticeText("suspended")).not.toBe("");
    expect(audioNoticeText("interrupted")).not.toBe("");
  });
});
