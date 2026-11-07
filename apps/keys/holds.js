// Who is holding each note. No DOM.
//
//   const holds = createHolds();
//   holds.press(60, "midi");
//   holds.press(60, "keyboard");
//   holds.release(60, "midi");      // false: the keyboard still holds it
//   holds.release(60, "keyboard");  // true: nobody does now, so stop the sound
//   holds.releaseAll("keyboard");   // every note that source held; [60, ...] left with no holder
//
// A note can be held from the MIDI keyboard, the computer keyboard and each
// finger on the on-screen piano at once. It should sound until the last of them
// lets go, not stop when the first does. A source is counted once however often
// it presses (a controller may repeat a Note On), so one release is enough for it.

export function createHolds() {
  const holders = new Map(); // note -> Set of sources holding it

  return {
    press(note, source) {
      if (!holders.has(note)) holders.set(note, new Set());
      holders.get(note).add(source);
    },

    // True when this release leaves the note with no holder: the moment to stop it.
    // False if the source was not holding it, or others still are.
    release(note, source) {
      const sources = holders.get(note);
      if (!sources?.delete(source)) return false;
      if (sources.size > 0) return false;
      holders.delete(note);
      return true;
    },

    // Drops everything one source was holding, for when it goes away without
    // letting go: a window that lost focus, a MIDI device that was unplugged.
    // Returns the notes that now have no holder, which are the ones to stop.
    releaseAll(source) {
      const freed = [];
      for (const [note, sources] of holders) {
        if (!sources.delete(source) || sources.size > 0) continue;
        holders.delete(note);
        freed.push(note);
      }
      return freed;
    },
  };
}
