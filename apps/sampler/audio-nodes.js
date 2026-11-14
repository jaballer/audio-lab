// Two small things the mixer and its returns both do to Web Audio nodes. No DOM, and nothing at import time.

// How fast a changed setting is reached, as a time constant in seconds: slow enough that a slider dragged under a playing
// sound does not zipper or click, fast enough to feel immediate.
export const SETTING_TIME_CONSTANT = 0.015;

// Gives a parameter its value: at once when the node is built (`now` undefined), and afterwards by gliding to it, or by
// jumping when `jump` says a glide would pass through values that mean something else (a filter turned on at a cutoff it
// was not waiting at). `timeConstant` is how quickly a glide gets there (a change of tempo moves a delay slower than a slider
// moves a gain).
export function setParam(param, value, now, { jump = false, timeConstant = SETTING_TIME_CONSTANT } = {}) {
  if (now === undefined) {
    param.value = value;
  } else if (jump) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
  } else {
    param.setTargetAtTime(value, now, timeConstant);
  }
}

// A gain that takes whatever is connected to it as two channels, as speakers are (a mono sound is the same on both, as it is
// when it is heard), so what is after it has a left and a right to work on, and a stereo sample keeps its own.
export function createStereoGain(ctx) {
  const gain = ctx.createGain();
  gain.channelCount = 2;
  gain.channelCountMode = "explicit";
  gain.channelInterpretation = "speakers";
  return gain;
}
