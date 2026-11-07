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

// 0 to 1, squared: the lower half of the slider has finer control, like a
// real fader.
export const squared = () => ({
  toValue: (p) => (p / 100) ** 2,
  toSlider: (v) => Math.sqrt(v) * 100,
});
