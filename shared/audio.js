// The AudioContext and master volume shared by every app.
//
//   const audio = createAudioEngine({
//     volume: 0.5,                 // master gain, 0-1
//     onStateChange: (state) => {}, // "closed" | "suspended" | "running" | ... | "off" (power off)
//     createContext: () => ctx      // optional: build the context some other way (see below)
//   });
//   const ctx = audio.ensure();    // create/resume on demand, returns the context
//   audio.master                   // GainNode every sound should connect to
//   audio.setVolume(0.8);          // safe to call before the context exists
//   audio.unlockOnInteraction();   // see below
//   audio.powerOff(); audio.powerOn();   // the device's power switch: off is silent until turned on
//
// The context is created lazily, so nothing is built until it is needed.
//
// `createContext` is for a library that insists on owning the context. Tone.js builds its own
// wrapped one, which also fills in Web Audio features Firefox lacks (the listener's position
// params). Handing Tone a plain AudioContext instead makes its setup throw in Firefox.

const FADE_TIME_CONSTANT = 0.01; // seconds: smooth enough not to click
const FADE_MS = 80; // long enough for the fade to reach silence (about 8 time constants)

export function createAudioEngine({ volume = 1, onStateChange, createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  let master = null;
  let level = volume;

  let powered = true;
  let fadeTimer = null;

  // While the power is off the engine says so, whatever the context's own state is.
  const notify = () => onStateChange?.(!powered ? "off" : ctx ? ctx.state : "closed");

  function ensure() {
    if (!ctx) {
      ctx = createContext();
      // A listener, not `onstatechange`: Tone.js assigns that property on the context it uses,
      // which would replace ours and leave the status stuck on "suspended".
      ctx.addEventListener("statechange", notify);
      master = ctx.createGain();
      master.gain.value = level;
      master.connect(ctx.destination);
    }
    if (!powered) {
      // Off stays off: a click, a key or a note must not wake it. A context a gesture
      // has just started (they begin running) is put back to sleep.
      if (ctx.state === "running") ctx.suspend();
      notify();
      return ctx;
    }
    if (ctx.state === "suspended") ctx.resume();
    notify();
    return ctx;
  }

  // Fade out, then suspend, so sound already playing stops without a click.
  function powerOff() {
    powered = false;
    clearTimeout(fadeTimer);
    if (ctx) {
      master.gain.setTargetAtTime(0, ctx.currentTime, FADE_TIME_CONSTANT);
      // A timer is fine here: nothing is scheduled by it, it only waits out the fade.
      fadeTimer = setTimeout(() => {
        if (!powered && ctx.state === "running") ctx.suspend();
      }, FADE_MS);
    }
    notify();
  }

  function powerOn() {
    powered = true;
    clearTimeout(fadeTimer);
    // Builds the context if there is none yet and resumes it: this runs from a click,
    // which is the gesture browsers want.
    ensure();
    master.gain.setTargetAtTime(level, ctx.currentTime, FADE_TIME_CONSTANT);
  }

  // Smoothed over a few milliseconds: a jump in gain would click.
  function setVolume(value) {
    level = value;
    if (master && powered) master.gain.setTargetAtTime(level, ctx.currentTime, FADE_TIME_CONSTANT);
  }

  // Browsers only start audio after a click or key press on the page, and a
  // MIDI message doesn't count. So unlock it on the first real interaction,
  // ahead of the first sound: otherwise a MIDI controller can play silently.
  function unlockOnInteraction(target = window) {
    for (const type of ["pointerdown", "keydown"]) target.addEventListener(type, ensure, { capture: true });
    notify();
  }

  return {
    ensure,
    setVolume,
    unlockOnInteraction,
    get ctx() {
      return ctx; // null until ensure() has run
    },
    get master() {
      return master;
    },
    powerOff,
    powerOn,
    get powered() {
      return powered;
    },
    get running() {
      return ctx?.state === "running";
    },
  };
}
