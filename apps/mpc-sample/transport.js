// Whether the MPC Sample is playing, and at what tempo. Pure: no DOM.
//
// The state follows what the device reports (Start, Continue, Stop) and nothing else: the
// page's own Play and Stop buttons only ask the device, so the lights and the device cannot
// disagree. The tempo is read from the MIDI clock, which the device sends only while playing.
//
//   const transport = createTransport();
//   transport.apply({ type: "transportStart" });         // or transportContinue / transportStop
//   transport.apply({ type: "clock", time: timeStamp }); // every tick, with its arrival time (ms)
//   transport.snapshot();                                // { state, bpm }
//   transport.reset();                                   // the device went away

export const CLOCKS_PER_BEAT = 24; // MIDI clock is 24 ticks per quarter note
const WINDOW = 2 * CLOCKS_PER_BEAT; // gaps averaged: two beats, enough to smooth USB timing jitter
const TENTH = 10; // the tempo is reported to a tenth of a BPM
const MS_PER_MINUTE = 60000;

export function createTransport() {
  let state = "unknown"; // "unknown" until the device sends Start, Continue or Stop
  let bpm = null;
  let times = []; // arrival time of the most recent clock ticks

  // Ticks from before a start or stop would make the gap across it look like a slow tempo.
  const forgetTicks = () => {
    times = [];
  };

  function estimate() {
    if (times.length <= CLOCKS_PER_BEAT) return; // not a full beat of gaps yet
    const gap = (times.at(-1) - times[0]) / (times.length - 1);
    bpm = Math.round((MS_PER_MINUTE / (gap * CLOCKS_PER_BEAT)) * TENTH) / TENTH;
  }

  return {
    apply(event) {
      switch (event.type) {
        case "transportStart":
          state = "playing";
          bpm = null; // a start may come with a new tempo, so do not show the old one
          forgetTicks();
          break;
        case "transportContinue":
          state = "playing";
          forgetTicks();
          break;
        case "transportStop":
          state = "stopped"; // the last tempo stays on show
          forgetTicks();
          break;
        case "clock":
          times.push(event.time);
          if (times.length > WINDOW + 1) times.shift();
          estimate();
          break;
      }
    },

    reset() {
      state = "unknown";
      bpm = null;
      forgetTicks();
    },

    snapshot: () => ({ state, bpm }),
  };
}
