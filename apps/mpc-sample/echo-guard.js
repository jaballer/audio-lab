// Tells a hit the device echoed from a hit someone made on its pads. No DOM, nothing at import time.
//
// With Pad MIDI In on, the device plays a note it is sent and then reports it back on its input as a
// pad hit, with the velocity and note kept and the timing of the send (measured: docs/mpc-sample.md).
// A page that sends the device notes therefore receives each one as a `padDown`, and would play its own
// browser sound for it on top of the device's. The guard is told what was sent and when, and says
// whether a hit that arrives is that note coming back.
//
//   const guard = createEchoGuard();
//   guard.expect(note, time, now);   // a note was queued for `time` (ms); `now` is the clock's time (ms)
//   guard.isEcho(note, now);         // a hit just arrived: true once for each note that was sent
//   guard.clear();                   // forget what was sent (the sequence stopped)
//
// A real hit of the same pad within the window of a sent note is taken for the echo, and not sounded
// by the browser: the cost of the guess is one missing browser sound, never a doubled one.

export const ECHO_EARLY_MS = 30; // the echo cannot come before the note was due, but clocks differ a little
export const ECHO_LATE_MS = 150; // the longest an echo is waited for: USB and the device's own processing

export function createEchoGuard() {
  let expected = []; // { note, time }, oldest first

  // An echo that has not come by now is not coming (echo is off, or the note was dropped).
  const dropExpired = (now) => {
    expected = expected.filter((entry) => now - entry.time <= ECHO_LATE_MS);
  };

  return {
    expect(note, time, now) {
      dropExpired(now);
      expected.push({ note, time });
    },

    isEcho(note, now) {
      dropExpired(now);
      const index = expected.findIndex((entry) => entry.note === note && now - entry.time >= -ECHO_EARLY_MS);
      if (index < 0) return false;
      expected.splice(index, 1);
      return true;
    },

    clear() {
      expected = [];
    },
  };
}
