// The sequencer's pattern: one row of on/off steps per pad. No DOM.
//
//   const pattern = createPattern(16, 16, STARTER_BEAT);   // rows, steps, optional starting steps
//   pattern.isOn(0, 4);        // is pad 0's step 4 on?
//   pattern.toggle(0, 4);      // flip it
//   pattern.set(0, 4, true);
//   pattern.row(0);            // a copy of pad 0's steps, as booleans
//   pattern.clearRow(0);
//   pattern.clearAll();

// Starter beat so Play makes noise right away: { pad row: [steps that are on] }.
export const STARTER_BEAT = {
  0: [0, 4, 8, 12], // kick
  1: [4, 12], // snare
  2: [0, 2, 4, 6, 8, 10, 12, 14], // closed hat
};

export function createPattern(rows, steps, initial = {}) {
  const grid = Array.from({ length: rows }, () => new Array(steps).fill(false));
  for (const [row, on] of Object.entries(initial)) on.forEach((step) => (grid[row][step] = true));

  return {
    rows,
    steps,
    isOn: (row, step) => grid[row][step],
    set: (row, step, on) => (grid[row][step] = on),
    toggle: (row, step) => (grid[row][step] = !grid[row][step]),
    row: (row) => [...grid[row]],
    clearRow: (row) => grid[row].fill(false),
    clearAll: () => grid.forEach((row) => row.fill(false)),
  };
}
