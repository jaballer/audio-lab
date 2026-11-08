import { describe, expect, it, vi } from "vitest";
import { togglePower } from "./power.js";

const fakeAudio = (running, powered = true) => ({ running, powered, powerOn: vi.fn(), powerOff: vi.fn() });

describe("togglePower", () => {
  it("turns sound off when it is on", () => {
    const audio = fakeAudio(true);
    togglePower(audio);
    expect(audio.powerOff).toHaveBeenCalled();
    expect(audio.powerOn).not.toHaveBeenCalled();
  });

  it("turns sound back on when pressed again while the context is still running but power is off", () => {
    const audio = fakeAudio(true, false);
    togglePower(audio);
    expect(audio.powerOn).toHaveBeenCalled();
    expect(audio.powerOff).not.toHaveBeenCalled();
  });

  it("turns sound on when it is off, or still locked by the browser", () => {
    const audio = fakeAudio(false);
    togglePower(audio);
    expect(audio.powerOn).toHaveBeenCalled();
    expect(audio.powerOff).not.toHaveBeenCalled();
  });
});
