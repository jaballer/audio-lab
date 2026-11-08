// Whether the MPC Sample is playing, its tempo and where it is in the song. Pure: no DOM.
//
// The state follows what the device reports and nothing else: the page's own Play and Stop
// buttons only ask the device, so the lights and the device cannot disagree. The tempo comes
// from the MIDI clock, which the device sends only while playing (captured: none while idle).
// So clock from a device the page has not heard Start from means it was already playing when
// the page connected, and a clock that goes quiet means it stopped. The place in the song is
// what the device says (Play sends position 0, Continue the place it resumes from), counted
// on by the clock.
//
//   const transport = createTransport();
//   transport.apply({ type: "transportStart" });         // or transportContinue / transportStop
//   transport.apply({ type: "songPosition", position }); // in sixteenth notes
//   transport.apply({ type: "clock", time: timeStamp }); // every tick, with its arrival time (ms)
//   transport.expire(now);                               // call now and then; true if it changed state
//   transport.snapshot();                                // { state, bpm, position }
//   transport.reset();                                   // the device went away

export const CLOCKS_PER_BEAT = 24; // MIDI clock is 24 ticks per quarter note
export const BEATS_PER_BAR = 4; // assumed: the device's time signature is not sent
export const STALE_MS = 1000; // a clock this quiet while playing means the device stopped
const CLOCKS_PER_SIXTEENTH = CLOCKS_PER_BEAT / 4; // song position counts sixteenth notes
const WINDOW = 2 * CLOCKS_PER_BEAT; // gaps averaged: two beats, enough to smooth USB timing jitter
const TENTH = 10; // the tempo is reported to a tenth of a BPM
const MS_PER_MINUTE = 60000;

// What a toggle (the Space key) asks the device for.
export const toggleAction = (state) => (state === "playing" ? "stop" : "play");

export function createTransport() {
  let state = "unknown"; // "unknown" until the device sends Start, Continue or Stop, or a clock
  let bpm = null;
  let times = []; // arrival time of the most recent clock ticks
  let lastTick = null; // when the latest tick arrived, since the last Start, Continue or Stop
  let base = null; // where the song was, in clocks, when it last set off; null when not known
  let since = 0; // ticks since then

  // Ticks from before a start or stop would make the gap across it look like a slow tempo.
  const forgetTicks = () => {
    times = [];
    lastTick = null;
  };

  // The first tick after it sets off arrives at once and marks the place, so it has not moved
  // the song yet.
  const clocksIn = () => base + Math.max(0, since - 1);

  function estimate() {
    if (times.length <= CLOCKS_PER_BEAT) return; // not a full beat of gaps yet
    const gap = (times.at(-1) - times[0]) / (times.length - 1);
    bpm = Math.round((MS_PER_MINUTE / (gap * CLOCKS_PER_BEAT)) * TENTH) / TENTH;
  }

  function position() {
    if (base === null) return null;
    const beats = Math.floor(clocksIn() / CLOCKS_PER_BEAT);
    return { bar: Math.floor(beats / BEATS_PER_BAR) + 1, beat: (beats % BEATS_PER_BAR) + 1 };
  }

  return {
    apply(event) {
      switch (event.type) {
        case "transportStart":
          state = "playing";
          bpm = null; // a start may come with a new tempo, so do not show the old one
          base = 0;
          since = 0;
          forgetTicks();
          break;
        case "transportContinue":
          state = "playing";
          if (base !== null) base = clocksIn(); // pick up where it stopped, unless it says otherwise
          since = 0;
          forgetTicks();
          break;
        case "transportStop":
          state = "stopped"; // the last tempo and place stay on show
          forgetTicks();
          break;
        case "songPosition":
          base = event.position * CLOCKS_PER_SIXTEENTH;
          since = 0;
          break;
        case "clock":
          // A tick after a Stop is a stray one, not a sign it is playing again.
          if (state === "stopped") break;
          state = "playing";
          if (base !== null) since += 1;
          lastTick = event.time;
          times.push(event.time);
          if (times.length > WINDOW + 1) times.shift();
          estimate();
          break;
      }
    },

    // A device that never sent clock is not stopped by its absence, so only a clock that was
    // running can go quiet.
    expire(now) {
      if (state !== "playing" || lastTick === null || now - lastTick <= STALE_MS) return false;
      state = "stopped";
      forgetTicks();
      return true;
    },

    reset() {
      state = "unknown";
      bpm = null;
      base = null;
      since = 0;
      forgetTicks();
    },

    snapshot: () => ({ state, bpm, position: position() }),
  };
}
