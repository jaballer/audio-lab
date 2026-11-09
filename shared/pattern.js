// The sequencer's pattern: one row of on/off steps per pad. No DOM.
//
//   const pattern = createPattern(16, 16, { 0: [0, 4] }, { onChange });   // rows, steps, optional starting steps
//   pattern.isOn(0, 4);        // is pad 0's step 4 on?
//   pattern.toggle(0, 4);      // flip it
//   pattern.set(0, 4, true);
//   pattern.row(0);            // a copy of pad 0's steps, as booleans
//   pattern.clearRow(0);
//   pattern.clearAll();
//   pattern.snapshot();        // { pad row: [steps that are on] }, the shape the starting steps come in
//
// A step that is on also has a velocity, FULL_VELOCITY unless set otherwise:
//   pattern.velocity(0, 4);        // 1-127, as in MIDI
//   pattern.setVelocity(0, 4, 90); // ignored while the step is off
//   pattern.set(0, 4, true, 90);   // turn it on at 90, or change the velocity of one that is already on
//   pattern.velocitySnapshot();    // { pad row: { step: velocity } } for steps not at full, to save with the steps
// A step that is turned off forgets its velocity, so one that is turned on again
// starts at full and no step carries a velocity nobody can see.
//
// Whole rows and the whole pattern can be read and replaced, for copy and paste and for undo:
//   pattern.rowState(0);               // { on: [steps], velocities: { step: velocity } } of one pad
//   pattern.replaceRow(1, rowState);   // pad 1 becomes a copy of it
//   pattern.state();                   // { pattern: snapshot(), velocities: velocitySnapshot() }
//   pattern.restore(state);            // every pad becomes what state says
//
// Starting velocities come as `{ velocities }` in the options, in the shape velocitySnapshot gives
// (those of steps that are off are ignored).
//
// `onChange()` is called after a step actually changes (not while the pattern is
// being built, and not when a call leaves everything as it was).

export const MIN_VELOCITY = 1;
export const FULL_VELOCITY = 127;

const clampVelocity = (value) => Math.min(FULL_VELOCITY, Math.max(MIN_VELOCITY, Math.round(value)));

export function createPattern(rows, steps, initial = {}, { onChange, velocities: initialVelocities = {} } = {}) {
  const grid = Array.from({ length: rows }, () => new Array(steps).fill(false));
  const velocities = Array.from({ length: rows }, () => new Array(steps).fill(FULL_VELOCITY));
  for (const [row, on] of Object.entries(initial)) on.forEach((step) => (grid[row][step] = true));
  for (const [row, byStep] of Object.entries(initialVelocities)) {
    for (const [step, value] of Object.entries(byStep)) {
      if (grid[row]?.[step]) velocities[row][step] = clampVelocity(value);
    }
  }

  function setVelocity(row, step, value) {
    if (!grid[row][step]) return;
    const next = clampVelocity(value);
    if (velocities[row][step] === next) return;
    velocities[row][step] = next;
    onChange?.();
  }

  // `velocity` is for a step turned on, or one that is on already (recording over it replaces it).
  function set(row, step, on, velocity) {
    if (grid[row][step] === on) {
      if (on && velocity !== undefined) setVelocity(row, step, velocity);
      return;
    }
    grid[row][step] = on;
    velocities[row][step] = on && velocity !== undefined ? clampVelocity(velocity) : FULL_VELOCITY;
    onChange?.();
  }

  // Steps and velocities that do not exist are ignored, so a state from elsewhere cannot break the grid.
  function fillRow(row, on = [], byStep = {}) {
    grid[row].fill(false);
    velocities[row].fill(FULL_VELOCITY);
    for (const step of on) if (Number.isInteger(step) && step >= 0 && step < steps) grid[row][step] = true;
    for (const [step, value] of Object.entries(byStep)) {
      if (grid[row][step]) velocities[row][step] = clampVelocity(value);
    }
  }

  const rowKey = (row) => JSON.stringify([grid[row], velocities[row]]);

  function replaceRow(row, state) {
    const before = rowKey(row);
    fillRow(row, state.on, state.velocities);
    if (rowKey(row) !== before) onChange?.();
  }

  function restore(state) {
    const before = JSON.stringify([grid, velocities]);
    for (let row = 0; row < rows; row++) fillRow(row, state.pattern[row], state.velocities[row]);
    if (JSON.stringify([grid, velocities]) !== before) onChange?.();
  }

  function clearRow(row) {
    if (!grid[row].some(Boolean)) return;
    grid[row].fill(false);
    velocities[row].fill(FULL_VELOCITY);
    onChange?.();
  }

  return {
    rows,
    steps,
    isOn: (row, step) => grid[row][step],
    set,
    toggle: (row, step) => set(row, step, !grid[row][step]),
    velocity: (row, step) => velocities[row][step],
    setVelocity,
    row: (row) => [...grid[row]],
    clearRow,
    clearAll() {
      // Each row reports its own change; one save for the lot is enough.
      if (!grid.some((row) => row.some(Boolean))) return;
      grid.forEach((row) => row.fill(false));
      velocities.forEach((row) => row.fill(FULL_VELOCITY));
      onChange?.();
    },
    rowState: (row) => ({
      on: grid[row].flatMap((isOn, step) => (isOn ? [step] : [])),
      velocities: Object.fromEntries(
        grid[row].flatMap((isOn, step) =>
          isOn && velocities[row][step] !== FULL_VELOCITY ? [[step, velocities[row][step]]] : [],
        ),
      ),
    }),
    replaceRow,
    restore,
    state() {
      return { pattern: this.snapshot(), velocities: this.velocitySnapshot() };
    },
    velocitySnapshot() {
      const out = {};
      velocities.forEach((row, index) => {
        const byStep = {};
        row.forEach((value, step) => {
          if (grid[index][step] && value !== FULL_VELOCITY) byStep[step] = value;
        });
        if (Object.keys(byStep).length) out[index] = byStep;
      });
      return out;
    },
    snapshot() {
      const on = {};
      grid.forEach((row, index) => {
        const steps = row.flatMap((isOn, step) => (isOn ? [step] : []));
        if (steps.length) on[index] = steps;
      });
      return on;
    },
  };
}
