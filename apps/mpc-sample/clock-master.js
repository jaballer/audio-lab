// The MIDI clock the page sends so the device can be started from the page. No DOM, nothing at
// import time.
//
// The MPC Sample follows external clock (MIDI Sync In = Midi Clock): a bare Start is ignored, it
// begins on the first tick after Start, keeps going only while ticks keep arriving, and stops
// itself soon after they end (measured: docs/mpc-sample.md). So starting it from the page means
// sending Start and then a steady clock for as long as it should play, at the tempo the page
// chooses.
//
//   const master = createClockMaster({
//     send: (bytes, time) => output.send(bytes, time),
//     clear: () => output.clear?.(),         // optional: drops ticks already queued ahead
//     startMessage: [0xfa],
//   });
//   master.start(bpm, performance.now());   // Start, then ticks from now on
//   setInterval(() => master.tick(performance.now()), CLOCK_TICK_MS);   // queues the next stretch of ticks
//   master.halt();                           // stop sending ticks (the caller sends Stop itself)
//
// Ticks are queued a little ahead with a timestamp rather than sent from the timer, so a late
// timer callback does not bend the tempo: Web MIDI's own timestamp is the clock here, as the audio
// clock is for sounds. The timer must keep firing, so this holds only while the page is in front:
// a background tab's timers are slowed to about one a second, the ticks dry up and the device
// stops itself, which its Stop message then reports. A tick whose time has already passed is
// skipped, not sent late: the browser would deliver a backlog at once, a burst the device reads
// as a tempo spike, so a stall costs a pause in the clock instead.

export const CLOCKS_PER_BEAT = 24; // MIDI clock is 24 ticks per quarter note
export const DEFAULT_BPM = 120; // when the device has not told the page its tempo
export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const LOOKAHEAD_MS = 100; // how far ahead ticks are queued
export const CLOCK_TICK_MS = 25; // how often the caller should run tick()
const FIRST_TICK_DELAY_MS = 1; // the first tick follows Start by a moment, as the MIDI spec asks
const MS_PER_MINUTE = 60000;
const CLOCK = [0xf8];

export const clampBpm = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, Number.isFinite(bpm) ? bpm : DEFAULT_BPM));

export function createClockMaster({ send, clear, startMessage }) {
  let running = false;
  let gap = 0; // ms between ticks
  let next = 0; // when the next tick is due, in the caller's clock

  return {
    get running() {
      return running;
    },

    start(bpm, now) {
      gap = MS_PER_MINUTE / (clampBpm(bpm) * CLOCKS_PER_BEAT);
      running = true;
      send(startMessage, now);
      next = now + FIRST_TICK_DELAY_MS;
      this.tick(now);
    },

    // Queue every tick due before `now` + the lookahead, once each.
    tick(now) {
      if (!running) return;
      // Stay on the same beat grid but jump over what is already past.
      if (next < now) next += Math.ceil((now - next) / gap) * gap;
      while (next <= now + LOOKAHEAD_MS) {
        send(CLOCK, next);
        next += gap;
      }
    },

    // Web MIDI has MIDIOutput.clear() for ticks already queued ahead, but not every browser
    // implements it; where it is missing the few queued ticks (under LOOKAHEAD_MS) play out.
    halt() {
      running = false;
      clear?.();
    },
  };
}
