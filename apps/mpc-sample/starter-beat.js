// The page's starter beat: a boom-tap, so Play makes the device sound without drawing a pattern first.
// No DOM, nothing at import time.

// { pad row: [steps that are on] }, the shape createPattern takes as its starting steps. A row is
// bank * 16 + pad, so these are pads 1 and 2 of bank A (notes 36 and 37). Which pad has which sample is
// the owner's choice on the device; kick then snare is the usual order. One bar of 16th notes.
export const STARTER_BEAT = {
  0: [0, 8], // boom: beats 1 and 3
  1: [4, 12], // tap: beats 2 and 4
};
