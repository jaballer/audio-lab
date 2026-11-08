import { describe, expect, it, vi } from "vitest";
import { createPadSound } from "./pad-sound.js";

const SOUNDS = [{ id: "kick" }, { id: "snare" }];

function setup({ running = true } = {}) {
  const audio = { running };
  const play = vi.fn();
  const padSound = createPadSound({ audio, sounds: SOUNDS, play });
  return { audio, play, padSound };
}

describe("createPadSound.hit", () => {
  it("plays the pad's own sound at its velocity as a fraction of the MIDI maximum", () => {
    const { audio, play, padSound } = setup();
    expect(padSound.hit({ index: 1, velocity: 127 })).toBe(true);
    expect(play).toHaveBeenCalledWith(audio, SOUNDS[1], 1);

    padSound.hit({ index: 0, velocity: 64 });
    expect(play).toHaveBeenLastCalledWith(audio, SOUNDS[0], 64 / 127);
  });

  // A MIDI hit is not the click a browser needs before it lets audio start. Playing now would
  // create a suspended context whose hits all sound at once on the first click.
  it("drops a hit that arrives before audio has been unlocked", () => {
    const { play, padSound } = setup({ running: false });
    expect(padSound.hit({ index: 0, velocity: 100 })).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});
