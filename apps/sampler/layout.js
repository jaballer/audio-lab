// The shape of the sampler: how many pads, in what grid, and how many steps.
// The pad grid, the step keys, the computer-key map and the Launchpad profile all
// depend on these, so they are decided here once. No DOM.

export const PAD_COLUMNS = 4;
export const PAD_ROWS = 4;
export const PAD_COUNT = PAD_ROWS * PAD_COLUMNS;

// The step keys, the LCD ruler and the Launchpad show one bar of 16 steps at a time;
// a longer sequence is paged through them.
export const STEPS = 16;
export const STEP_GROUP = 4; // steps drawn together, one beat of 16ths

// The sequence is 1 to MAX_BARS bars of STEPS steps. The choices are powers of two:
// the usual loop lengths, and few enough to fit as a row of keys.
export const BAR_CHOICES = [1, 2, 4, 8];
export const MAX_BARS = BAR_CHOICES[BAR_CHOICES.length - 1];

// Separate patterns to choose between, each with its own steps and length.
export const SEQUENCE_COUNT = 8;

// Pad 1 sits bottom-left and the numbers run along each row, so the top row of
// the grid holds the highest pads. `row` counts from the top, as drawn.
export const padIndex = (row, column) => (PAD_ROWS - 1 - row) * PAD_COLUMNS + column;

export const padRow = (index) => PAD_ROWS - 1 - Math.floor(index / PAD_COLUMNS);
export const padColumn = (index) => index % PAD_COLUMNS;
