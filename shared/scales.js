// Map a 0-100 slider position to a real value and back.
//
// Each helper returns { toValue(position), toSlider(value) }, so a control can
// be described by its range and curve and spread together with a formatter:
//
//   const cutoff = { ...exp(60, 16000), format: (hz) => `${Math.round(hz)} Hz` };

// Equal slider steps are equal amounts.
export const linear = (min, max) => ({
  toValue: (p) => min + (p / 100) * (max - min),
  toSlider: (v) => ((v - min) / (max - min)) * 100,
});

// Equal slider steps are equal ratios (equal musical steps for pitch, fine
// control over short times as well as long ones). `min` must be above 0.
export const exp = (min, max) => ({
  toValue: (p) => min * (max / min) ** (p / 100),
  toSlider: (v) => (100 * Math.log(v / min)) / Math.log(max / min),
});

// A control with a stop in the middle, like a DJ filter knob: the middle of the travel is the middle of the range, and the
// positions within `detent` per cent of it (a per cent of half the travel) all give exactly that. A knob or a slider with an
// even number of positions has no single middle one, so without this the middle value could be reached only by luck. The rest of
// the travel is spread over what is left of each half, so the value is continuous at the edge of the stop and still reaches
// `min` and `max` at the ends.
export const detented = (min, max, detent) => {
  const middle = (min + max) / 2;
  const half = (max - min) / 2;
  return {
    toValue: (p) => {
      const travel = ((p - 50) / 50) * 100; // -100 to +100 along the travel
      if (Math.abs(travel) <= detent) return middle;
      return middle + Math.sign(travel) * half * ((Math.abs(travel) - detent) / (100 - detent));
    },
    toSlider: (v) => {
      const share = (v - middle) / half; // -1 to +1 along the range
      if (share === 0) return 50;
      return 50 + Math.sign(share) * 0.5 * (Math.abs(share) * (100 - detent) + detent);
    },
  };
};

// 0 to 1, squared: the lower half of the slider has finer control, like a
// real fader.
export const squared = () => ({
  toValue: (p) => (p / 100) ** 2,
  toSlider: (v) => Math.sqrt(v) * 100,
});
