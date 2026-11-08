import { describe, expect, it } from "vitest";
import { audioNoticeText, createAudioNotice } from "./audio-notice.js";

describe("audioNoticeText", () => {
  it("says nothing once audio is running", () => {
    expect(audioNoticeText("running")).toBe("");
  });

  it("tells the person how to turn sound on before any context exists", () => {
    // "closed" is what the engine reports on a fresh load, before the first click.
    expect(audioNoticeText("closed")).toMatch(/click.*press a key/i);
  });

  it("points at POWER when the switch is what turned sound off", () => {
    expect(audioNoticeText("off")).toMatch(/power/i);
    expect(audioNoticeText("off")).not.toBe(audioNoticeText("closed"));
  });

  it("keeps telling them while the browser holds the context suspended or interrupted", () => {
    expect(audioNoticeText("suspended")).not.toBe("");
    expect(audioNoticeText("interrupted")).not.toBe("");
  });
});

describe("createAudioNotice", () => {
  // The smallest stand-in for the bits of an element the notice touches.
  const fakeElement = () => ({ textContent: "", hidden: true, classList: { remove() {}, add() {} }, offsetWidth: 0 });

  it("shows the text while audio is off and hides it once audio runs", () => {
    const el = fakeElement();
    const notice = createAudioNotice(el);
    notice.update("closed");
    expect(el.hidden).toBe(false);
    expect(el.textContent).not.toBe("");
    notice.update("running");
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe("");
  });

  it("only restarts the nudge animation while the notice is showing", () => {
    const calls = [];
    const el = { ...fakeElement(), classList: { remove: () => calls.push("remove"), add: () => calls.push("add") } };
    const notice = createAudioNotice(el);
    notice.nudge(); // hidden: nothing to shake
    expect(calls).toEqual([]);
    notice.update("suspended");
    notice.nudge();
    expect(calls).toEqual(["remove", "add"]);
  });
});
