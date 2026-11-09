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
//
// Power off mutes the master gain and leaves the context running. Suspending it would freeze
// every sounding note and its release against a stopped clock, and a power cycle would bring
// them back; running muted lets them play out, unheard, on the clock as usual.
//
// The master gain feeds a soft clipper before the speakers: several loud sounds on one step (kick, snare and hat
// together, or a hit at a higher gain) add up past full scale, which the speakers would clip into a crackle. Below
// the clipper's knee the signal passes unchanged, so a single sound is not touched; above it the signal is bent
// towards a ceiling just under full scale. (A compressor is not used: Web Audio's lowers quiet sounds too.) If the
// context cannot make one, the master goes straight to the speakers as before.
//
// The context is created lazily, so nothing is built until it is needed.
//
// `createContext` is for a library that insists on owning the context. Tone.js builds its own
// wrapped one, which also fills in Web Audio features Firefox lacks (the listener's position
// params). Handing Tone a plain AudioContext instead makes its setup throw in Firefox.

// What the header marks its POWER button with (app-header.js).
export const POWER_SWITCH = "[data-power-switch]";

const FADE_TIME_CONSTANT = 0.01; // seconds: smooth enough not to click

// The clipper's shape: untouched up to `knee`, then a smooth bend that never reaches `ceiling`. A shaper only maps
// inputs from -1 to 1 across its curve, and clamps what lies outside, so the signal is halved before it and the
// curve spans -2 to 2: a sum of sounds can reach twice full scale before it is simply held at the ceiling.
export const CLIP = { knee: 0.7, ceiling: 0.98, reach: 2 };

export function softClipCurve({ knee, ceiling, reach }, size = 4097) {
  const curve = new Float32Array(size);
  const span = ceiling - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 * reach - reach;
    const magnitude = Math.abs(x);
    curve[i] = magnitude <= knee ? x : Math.sign(x) * (knee + span * Math.tanh((magnitude - knee) / span));
  }
  return curve;
}

// The pieces between the master gain and the speakers: the first node to connect the master to, and the last one
// (which goes to the speakers). Null when the context has no waveshaper.
function createClipper(ctx) {
  if (typeof ctx.createWaveShaper !== "function") return null;
  const half = ctx.createGain();
  half.gain.value = 1 / CLIP.reach;
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve(CLIP);
  shaper.oversample = "none"; // oversampling rings past full scale, which is what this is here to prevent
  half.connect(shaper);
  return { input: half, output: shaper };
}

export function createAudioEngine({ volume = 1, onStateChange, createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  let master = null;
  let level = volume;

  let powered = true;

  // While the power is off the engine says so, whatever the context's own state is.
  const notify = () => onStateChange?.(!powered ? "off" : ctx ? ctx.state : "closed");

  function ensure() {
    if (!ctx) {
      ctx = createContext();
      // A listener, not `onstatechange`: Tone.js assigns that property on the context it uses,
      // which would replace ours and leave the status stuck on "suspended".
      ctx.addEventListener("statechange", notify);
      master = ctx.createGain();
      master.gain.value = powered ? level : 0;
      const clipper = createClipper(ctx);
      if (clipper) {
        master.connect(clipper.input);
        clipper.output.connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
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
