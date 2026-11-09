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
//   audio.powered                  // false while off: a page should not start sounds then (they are
//                                  // inaudible, but a held note would be heard again at power on)
//   audio.running                  // true only while sound can be heard: powered, and the context running
//   audio.killSound()              // cut off everything sounding now, tails and all; sounds made after it are heard
//
// Power off mutes the master gain and leaves the context running. Suspending it would freeze
// every sounding note and its release against a stopped clock, and a power cycle would bring
// them back; running muted lets them play out, unheard, on the clock as usual.
//
// The context is created lazily, so nothing is built until it is needed.
//
// `createContext` is for a library that insists on owning the context. Tone.js builds its own
// wrapped one, which also fills in Web Audio features Firefox lacks (the listener's position
// params). Handing Tone a plain AudioContext instead makes its setup throw in Firefox.

// What the header marks its POWER button with (app-header.js).
export const POWER_SWITCH = "[data-power-switch]";

const FADE_TIME_CONSTANT = 0.01; // seconds: smooth enough not to click
// Killing sound is a faster fade (still no click), and the cut-off master is disconnected once it is inaudible.
const KILL_TIME_CONSTANT = 0.004;
const KILL_DISCONNECT_MS = 60;

export function createAudioEngine({ volume = 1, onStateChange, createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  let master = null;
  let level = volume;

  let powered = true;

  // While the power is off the engine says so, whatever the context's own state is.
  const notify = () => onStateChange?.(!powered ? "off" : ctx ? ctx.state : "closed");

  // A master gain wired to the speakers, at the level the engine is at now.
  function createMaster() {
    const gain = ctx.createGain();
    gain.gain.value = powered ? level : 0;
    gain.connect(ctx.destination);
    return gain;
  }

  function ensure() {
    if (!ctx) {
      ctx = createContext();
      // A listener, not `onstatechange`: Tone.js assigns that property on the context it uses,
      // which would replace ours and leave the status stuck on "suspended".
      ctx.addEventListener("statechange", notify);
      master = createMaster();
    }
    // "interrupted" is Safari after a phone call or a locked screen; resume() ends it too.
    // Off stays off: a click, a key or a note must not wake a context the browser holds suspended.
    if (powered && (ctx.state === "suspended" || ctx.state === "interrupted")) ctx.resume();
    notify();
    return ctx;
  }

  // Muting is a fade, so sound already playing stops without a click.
  function powerOff() {
    powered = false;
    if (ctx) master.gain.setTargetAtTime(0, ctx.currentTime, FADE_TIME_CONSTANT);
    notify();
  }

  function powerOn() {
    powered = true;
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

  // Sound that is already playing cannot be taken back by the page that started it (a long sample, a crash, the
  // tail of a held note), so the engine does it: every sound is connected to the master gain, so the master is
  // faded out and cut off, and a new one takes its place for whatever is played next. A page must read
  // `audio.master` each time it plays to pick the new one up: one that connects to it once (the Tone page's delay)
  // must not call this. Whether anything was cut off: false before the context exists.
  function killSound() {
    if (!ctx) return false;
    const old = master;
    master = createMaster();
    old.gain.setTargetAtTime(0, ctx.currentTime, KILL_TIME_CONSTANT);
    setTimeout(() => old.disconnect(), KILL_DISCONNECT_MS);
    return true;
  }

  // Browsers only start audio after a click or key press on the page, and a
  // MIDI message doesn't count. So unlock it on the first real interaction,
  // ahead of the first sound: otherwise a MIDI controller can play silently.
  function unlockOnInteraction(target = window) {
    // Not for the POWER switch: the press that turns sound on must find it still off, or the
    // page would start audio on pointerdown and the click would then switch it straight off.
    const unlock = (e) => {
      if (!e?.target?.closest?.(POWER_SWITCH)) ensure();
    };
    for (const type of ["pointerdown", "keydown"]) target.addEventListener(type, unlock, { capture: true });
    notify();
  }

  return {
    ensure,
    setVolume,
    unlockOnInteraction,
    killSound,
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
      return powered && ctx?.state === "running";
    },
  };
}
