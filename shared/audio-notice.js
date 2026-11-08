// The "sound is off" notice, the same on every page. Browsers keep audio silent
// until the person clicks or presses a key on the page, and a MIDI message does
// not count, so a controller played on a fresh load looks broken. This says what
// to do, and points at POWER when that is what was turned off. (On a phone or
// tablet the first tap unlocks audio by itself, so base.css hides the notice
// there: a touch screen needs no telling. The POWER light still shows the state.)
//
//   const notice = createAudioNotice(element);
//   notice.update(state);   // from the audio engine's onStateChange
//   notice.nudge();         // a MIDI hit arrived while sound was still off
//
// `audioNoticeText` decides from the audio state with no DOM, so it can be
// tested; `createAudioNotice` shows and hides the element it is handed.

const LOCKED_TEXT = "Sound is off. Click anywhere or press a key to turn it on.";
const POWER_OFF_TEXT = "Power is off. Press POWER to turn sound on.";

// `state` is what the audio engine reports: "closed" before any context exists,
// then the context's own state, or "off" while the POWER switch is off. Anything
// but "running" is silent ("interrupted" is Safari after a phone call or a locked
// screen). Returns "" when audio is on.
export function audioNoticeText(state) {
  if (state === "running") return "";
  return state === "off" ? POWER_OFF_TEXT : LOCKED_TEXT;
}

export function createAudioNotice(element) {
  return {
    update(state) {
      const text = audioNoticeText(state);
      element.textContent = text;
      element.hidden = text === "";
    },

    // Draws the eye to the notice again, for a hit that made no sound.
    // Removing the class and reading offsetWidth restarts the CSS animation if
    // it is already playing.
    nudge() {
      if (element.hidden) return;
      element.classList.remove("nudge");
      void element.offsetWidth;
      element.classList.add("nudge");
    },
  };
}
