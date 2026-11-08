// Which note each pointer (a mouse button or a finger) is holding on the piano. No DOM.
//
//   const pointers = createPointerNotes();
//   pointers.press(1, 60);    // returns the note this pointer was still holding, or undefined
//   pointers.release(1);      // returns the note it was holding, or undefined
//   pointers.releaseAll();    // [[pointerId, note], ...], for when the page loses focus
//
// One note per pointer, so that with two fingers down each ends its own note.
// A pointer that presses again while still recorded as down missed its pointerup
// (it ended outside the window, or the browser took it): press() hands back the
// note it was left holding so the caller can end it, instead of losing track of it.

export function createPointerNotes() {
  const notes = new Map(); // pointerId -> note

  return {
    press(pointerId, note) {
      const held = notes.get(pointerId);
      notes.set(pointerId, note);
      return held;
    },

    release(pointerId) {
      const held = notes.get(pointerId);
      notes.delete(pointerId);
      return held;
    },

    releaseAll() {
      const all = [...notes];
      notes.clear();
      return all;
    },
  };
}
