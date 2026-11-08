// The sampler's starter beat, so Play makes noise on a first visit. The pad rows are the sampler's own kit.

// { pad row: [steps that are on] }, the shape createPattern takes as its starting steps.
export const STARTER_BEAT = {
  0: [0, 4, 8, 12], // kick
  1: [4, 12], // snare
  2: [0, 2, 4, 6, 8, 10, 12, 14], // closed hat
};
