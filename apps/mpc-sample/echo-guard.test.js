import { describe, expect, it } from "vitest";
import { ECHO_EARLY_MS, ECHO_LATE_MS, createEchoGuard } from "./echo-guard.js";

describe("createEchoGuard", () => {
  it("knows a note it sent when the hit arrives on time, once", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 990);
    expect(guard.isEcho(36, 1006)).toBe(true);
    expect(guard.isEcho(36, 1007)).toBe(false); // each sent note is one echo
  });

  it("does not take another note for it", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 990);
    expect(guard.isEcho(37, 1005)).toBe(false);
    expect(guard.isEcho(36, 1005)).toBe(true);
  });

  it("matches the hits to the notes in the order they were sent", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 990);
    guard.expect(36, 1100, 990);
    expect(guard.isEcho(36, 1005)).toBe(true);
    expect(guard.isEcho(36, 1105)).toBe(true);
    expect(guard.isEcho(36, 1110)).toBe(false);
  });

  it("is not fooled by a hit before the note was due, beyond the clocks' difference", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 900);
    expect(guard.isEcho(36, 1000 - ECHO_EARLY_MS - 1)).toBe(false);
    expect(guard.isEcho(36, 1000 - ECHO_EARLY_MS)).toBe(true);
  });

  it("stops waiting for an echo that is too late, so a real hit is not taken for it", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 990);
    expect(guard.isEcho(36, 1000 + ECHO_LATE_MS + 1)).toBe(false);
  });

  it("drops what it waits for as new notes are sent, so it cannot grow without echoes", () => {
    const guard = createEchoGuard();
    guard.expect(36, 0, 0);
    guard.expect(36, 100000, 100000); // long after: the first is expired and forgotten
    expect(guard.isEcho(36, 100)).toBe(false);
    expect(guard.isEcho(36, 100001)).toBe(true);
  });

  it("clear forgets everything", () => {
    const guard = createEchoGuard();
    guard.expect(36, 1000, 990);
    guard.clear();
    expect(guard.isEcho(36, 1005)).toBe(false);
  });
});
