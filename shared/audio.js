// The AudioContext and master volume shared by every app.
//
//   const audio = createAudioEngine({
//     volume: 0.5,                 // master gain, 0-1
//     onStateChange: (state) => {}, // "suspended" | "running" | ...
//     createContext: () => ctx      // optional: build the context some other way (see below)
//   });
//   const ctx = audio.ensure();    // create/resume on demand, returns the context
//   audio.master                   // GainNode every sound should connect to
//   audio.setVolume(0.8);          // safe to call before the context exists
//   audio.unlockOnInteraction();   // see below
//
// The context is created lazily, so nothing is built until it is needed.
//
// `createContext` is for a library that insists on owning the context. Tone.js builds its own
// wrapped one, which also fills in Web Audio features Firefox lacks (the listener's position
// params). Handing Tone a plain AudioContext instead makes its setup throw in Firefox.

export function createAudioEngine({ volume = 1, onStateChange, createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  let master = null;
  let level = volume;

  const notify = () => onStateChange?.(ctx ? ctx.state : "closed");

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
    if (ctx.state === "suspended") ctx.resume();
    notify();
    return ctx;
  }

  // Smoothed over a few milliseconds: a jump in gain would click.
  function setVolume(value) {
    level = value;
    if (master) master.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
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
    get running() {
      return ctx?.state === "running";
    },
  };
}
