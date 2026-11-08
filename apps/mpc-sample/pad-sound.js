// What a pad hit sounds like on this page: the pad's own sound from the shared kit, as loud as
// the hit was hard. No DOM, nothing at import time.
//
//   const padSound = createPadSound({ audio, sounds: SOUNDS, isOn: () => soundOn });
//   padSound.hit({ index, velocity });   // true if it played; velocity is MIDI 1-127
//
// Every bank plays the same sounds: a pad is the same pad whichever bank it is in.

import { playSound } from "../../shared/sounds.js";

const MIDI_VELOCITY_MAX = 127;

export function createPadSound({ audio, sounds, isOn, play = playSound }) {
  return {
    hit({ index, velocity }) {
      // Only once audio is running: a MIDI hit does not count as the click a browser wants
      // before it starts audio, and playing now would create a suspended context whose
      // queued hits all sound together at the first click. Such a hit is dropped.
      if (!isOn() || !audio.running) return false;
      play(audio, sounds[index], velocity / MIDI_VELOCITY_MAX);
      return true;
    },
  };
}
