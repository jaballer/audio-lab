// ADSR envelope built from native Web Audio scheduling.
//
// Web Audio has no "envelope" object. Every AudioParam (here a GainNode's
// `gain`) keeps a timeline of scheduled events, and the audio thread follows
// that timeline sample by sample. An ADSR is just a few events on that timeline:
//
//   level
//    peak |      /\
//         |     /  \___________  <- sustain level (held while the key is down)
//         |    /               \
//       0 |___/                 \____
//           A    D       S       R
//         key down            key up
//
// Because the events are scheduled in advance, they stay perfectly in time even
// if the main thread is busy. Timings are in seconds; `t` is an AudioContext time.

// Key down: attack, then decay to the sustain level.
//
// env = { attack, decay, sustain }   (sustain is a fraction of the peak, 0 - 1)
export function startEnvelope(param, t, { attack, decay, sustain }, peak) {
  // Start from silence at the moment the key goes down.
  param.setValueAtTime(0, t);

  // Attack: a straight line up to the peak. A linear ramp is fine here, and,
  // unlike an exponential ramp, it can start from exactly 0.
  param.linearRampToValueAtTime(peak, t + attack);

  // Decay: glide toward the sustain level, starting when the attack ends.
  // setTargetAtTime moves a fraction of the remaining distance every instant,
  // so it eases out like a real instrument and never needs an end time.
  // `timeConstant` is how long it takes to cover ~63% of the distance, so
  // decay / 3 means it has covered ~95% by the end of the decay time.
  // Once it arrives it simply stays there: that is the sustain stage.
  param.setTargetAtTime(peak * sustain, t + attack, decay / 3);
}

// Key up: fade to silence over `release` seconds, starting from wherever the
// gain is right now (which may be mid-attack or mid-decay).
export function releaseEnvelope(param, t, release) {
  // Throw away events that haven't happened yet (the rest of the attack or
  // decay), then pin the gain to the value it has right now so the fade
  // starts from there. `param.value` is the live value, so `t` must be "now"
  // (the AudioContext's currentTime) for this to be right.
  //
  // Gotcha: there is a built-in for this, cancelAndHoldAtTime, but in Chrome
  // it followed by a ramp drops straight to silence when the key is released
  // during the decay/sustain curve (a setTargetAtTime event). It is also not
  // available in every browser. Doing it by hand works everywhere.
  const current = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(current, t);

  // A linear ramp always reaches exactly 0, so stopping the oscillator right
  // after leaves no click. (An exponential fade sounds a little more natural,
  // but it can't reach 0 or start from 0, which makes it fiddlier.)
  param.linearRampToValueAtTime(0, t + release);
}
