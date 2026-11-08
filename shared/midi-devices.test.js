import { describe, expect, it, vi } from "vitest";
import { createMidiRouter, selectProfile } from "./midi-devices.js";

const profile = (id, pattern) => ({ id, match: (name) => pattern.test(name), translate: () => [] });
const catchAll = { id: "any", match: () => true, translate: () => [] };

describe("selectProfile", () => {
  it("returns the first profile that matches", () => {
    const profiles = [profile("a", /alpha/i), profile("b", /alpha|beta/i), catchAll];
    expect(selectProfile(profiles, "Alpha 2").id).toBe("a");
    expect(selectProfile(profiles, "Beta").id).toBe("b");
  });

  it("falls through to a catch-all profile placed last", () => {
    expect(selectProfile([profile("a", /alpha/), catchAll], "Gamma").id).toBe("any");
  });

  it("returns null when nothing matches", () => {
    expect(selectProfile([profile("a", /alpha/)], "Gamma")).toBeNull();
  });

  it("treats a missing name as an empty string", () => {
    expect(selectProfile([catchAll], undefined).id).toBe("any");
  });
});

describe("createMidiRouter", () => {
  const NOTE_ON = [0x90, 60, 100];
  // Turns every Note On into a "play" event and everything else into nothing.
  const player = {
    id: "player",
    match: (name) => /player/i.test(name),
    translate: (msg) => (msg.type === "noteOn" ? [{ type: "play", note: msg.note }] : []),
  };
  const silent = { id: "silent", match: () => true, translate: () => [] };

  it("hands the events of the matching profile to their handlers, with the input", () => {
    const play = vi.fn();
    const route = createMidiRouter([player, silent], { play });
    const input = { name: "My Player" };
    route(input, NOTE_ON);
    expect(play).toHaveBeenCalledWith({ type: "play", note: 60 }, input);
  });

  it("does nothing for a message its profile has no event for", () => {
    const play = vi.fn();
    createMidiRouter([player, silent], { play })({ name: "Other" }, NOTE_ON);
    expect(play).not.toHaveBeenCalled();
  });

  it("does nothing when no profile matches the input", () => {
    const play = vi.fn();
    createMidiRouter([player], { play })({ name: "Other" }, NOTE_ON);
    expect(play).not.toHaveBeenCalled();
  });

  it("handles several events from one message in order", () => {
    const seen = [];
    const twice = { id: "t", match: () => true, translate: () => [{ type: "a" }, { type: "b" }] };
    createMidiRouter([twice], { a: () => seen.push("a"), b: () => seen.push("b") })({ name: "x" }, NOTE_ON);
    expect(seen).toEqual(["a", "b"]);
  });

  it("throws for an event the app has no handler for", () => {
    const route = createMidiRouter([player], {});
    expect(() => route({ name: "Player" }, NOTE_ON)).toThrow('No handler for MIDI event "play"');
  });
});
