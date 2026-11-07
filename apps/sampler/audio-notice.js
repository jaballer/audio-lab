// The "sound is off" notice. Browsers keep audio silent until the person clicks
// or presses a key on the page, and a MIDI hit doesn't count, so a Launchpad
// tapped on a fresh load looks broken. This says what to do instead.
//
// `audioNoticeText` decides from the audio state with no DOM, so it can be
// tested; `createAudioNotice` shows and hides the element it is handed.

const LOCKED_TEXT = "Sound is off. Click anywhere or press a key to turn it on.";

// `state` is what the audio engine reports: "closed" before any context exists,
// then the context's own state. Anything but "running" is silent ("interrupted"
// is Safari after a phone call or a locked screen). Returns "" when audio is on.
export function audioNoticeText(state) {
  return state === "running" ? "" : LOCKED_TEXT;
}

export function createAudioNotice(element) {
  return {
    update(state) {
      const text = audioNoticeText(state);
      element.textContent = text;
      element.hidden = text === "";
    },

    // Draws the eye to the notice again, for a pad hit that made no sound.
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
