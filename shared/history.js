// Undo and redo for anything whose state can be set aside as a value. No DOM, and it does not know what the
// states are: the caller hands it the state from before a change (push), and the current state when it goes
// back or forward (undo, redo), and gets the state to restore.
//
//   const history = createHistory({ limit: 100 });
//   history.push(before);           // a change is about to be kept: `before` is what to come back to
//   const back = history.undo(now); // `now` is stored for redo; null when there is nothing to undo
//   const again = history.redo(now);
//   history.canUndo; history.canRedo;
//
// A new change after an undo ends the redo line, as in any editor.

export function createHistory({ limit = 100 } = {}) {
  let past = [];
  let future = [];

  return {
    push(state) {
      past.push(state);
      // The oldest changes fall off, so a long session does not hold on to every step it ever made.
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      if (!past.length) return null;
      future.push(current);
      return past.pop();
    },
    redo(current) {
      if (!future.length) return null;
      past.push(current);
      return future.pop();
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    clear() {
      past = [];
      future = [];
    },
  };
}
