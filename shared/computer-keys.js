// The computer keyboard as a one-octave piano: A W S E D F T G Y H U J K play C
// to the C above. No DOM of its own: the events come from `target`, so it can be
// tested with a plain EventTarget.
//
//   const keys = createComputerKeys({ target: window, getBase, onNoteOn, onNoteOff, ignore });
//   keys.reset();   // forget every key held, without sending Note Offs (see below)
//
// `getBase()` is the lowest note of the on-screen piano; the keys play the octave
// above it, so they follow the piano as it scrolls. A key is remembered by its
// `code`, so its note ends when it is let go even if the view scrolled meanwhile.
//
// `ignore(event)` is optional: return true for a key press that is not meant for the piano, such
// as a letter typed to jump to an option in a menu on the page.
//
// A key let go while the page is in the background never sends its keyup. The
// page ends those notes through the note holder (by source), and calls reset()
// so the same key can be pressed again.

export const COMPUTER_KEYS = "awsedftgyhuj" + "k"; // C .. C one octave up
const OCTAVE = 12;

export function createComputerKeys({ target, getBase, onNoteOn, onNoteOff, ignore = () => false }) {
  const down = new Map(); // event.code -> note

  target.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || ignore(e)) return;
    const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
    if (i < 0 || down.has(e.code)) return;
    const note = getBase() + OCTAVE + i;
    down.set(e.code, note);
    onNoteOn(note);
  });

  target.addEventListener("keyup", (e) => {
    const note = down.get(e.code);
    if (note === undefined) return;
    down.delete(e.code);
    onNoteOff(note);
  });

  return {
    reset: () => down.clear(),
  };
}
