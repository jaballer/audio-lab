// The shape of the sampler: how many pads, in what grid, and how many steps.
// The pad grid, the step keys, the computer-key map and the Launchpad profile all
// depend on these, so they are decided here once. No DOM.

export const PAD_COLUMNS = 4;
export const PAD_ROWS = 4;
export const PAD_COUNT = PAD_ROWS * PAD_COLUMNS;

export const STEPS = 16;
export const STEP_GROUP = 4; // steps drawn together, one beat of 16ths

// Pad 1 sits bottom-left and the numbers run along each row, so the top row of
// the grid holds the highest pads. `row` counts from the top, as drawn.
export const padIndex = (row, column) => (PAD_ROWS - 1 - row) * PAD_COLUMNS + column;

export const padRow = (index) => PAD_ROWS - 1 - Math.floor(index / PAD_COLUMNS);
export const padColumn = (index) => index % PAD_COLUMNS;
