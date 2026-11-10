// The maths behind the backdrop light show: how loud it is, what colour that is, how it pulses on the beat. No DOM.
//
//   rmsLevel(samples)                        // 0..1 loudness of a block of samples (Float32Array from an AnalyserNode)
//   bandLevels(bytes, sampleRate)            // { low, high } 0..1: the kick's and the hats' share of a frequency reading
//   sparkleOpacity(high, index, timeMs)      // how bright one of the edge sparkles is
//   smoothLevel(previous, next, dtMs)        // rises fast, falls slowly, whatever the frame rate
//   beatPhase({ step, sinceStepMs, bpm })    // 0..1 through the current beat, from the playhead
//   beatPulse(phase)                         // 1 on the beat, fading to 0 before the next
//   orbitPositions(angle, count)             // where the lights that circle the window are
//   lightFrame({ level, phase, playing, beat, timeMs, still })   // what the view paints: colour, brightness, where and how big

const STEPS_PER_BEAT = 4; // a sixteenth-note grid
const LOUD = 0.35; // an RMS this loud is as hot as the lights get: a mix of several pads is about 0.2-0.3 (the clipper holds peaks near 1)
const ATTACK_MS = 40;
const RELEASE_MS = 320;
const HUE_QUIET = 225; // blue; louder passes through green and yellow to red (hue 0)
const GLOW_REST = 0.18; // the light never goes fully dark while it is on, so the beat shows before any sound
const GLOW_PULSE = 0.3;
const GLOW_LEVEL = 0.5;
const HUE_WANDER = 18; // degrees the colour drifts either way over a slow cycle, so a steady sound is not a flat colour
const DRIFT_X = 12; // percent of the width the main glow wanders either way
const DRIFT_Y = 6;
const MAIN_SIZE = 52; // percent of the width, swelling with each beat and with loudness
const SIZE_PULSE = 8;
const SIZE_LEVEL = 10;
const GLOW_LOW = 0.15; // the bass lifts the big glow, on top of the loudness
const SIZE_LOW = 8; // and swells it
const ORBIT_RATE = 0.2; // radians a second at 100 bpm (about half a minute a lap): the tempo sets the pace
const ORBIT_LEVEL = 0.6; // and a loud passage spins it up
export const ORBIT_LIGHTS = 4; // one for each corner at a time
const ORBIT_RADIUS = { x: 60, y: 62 }; // percent of the window: past the corners' diagonal, so a light reaches into them
const OFF_TURN = 0.2; // the side whose turn it is not still answers, a little

const LOW_BAND = [20, 200]; // Hz: kick and bass
const HIGH_BAND = [4000, 12000]; // Hz: hats, cymbals and the edge of a snare
const BAND_GATE = 0.45; // a byte reading maps -100..-30 dB to 0..255; the lowest 45% of it is room noise and is ignored
const SPARKLE_RATE = 0.004; // flicker speed, radians a millisecond

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// `bytes` is an AnalyserNode's getByteFrequencyData. The mean of a band's bins, gated and stretched to 0..1.
export function bandLevels(bytes, sampleRate) {
  if (!bytes?.length || !sampleRate) return { low: 0, high: 0 };
  const binHz = sampleRate / 2 / bytes.length;
  const mean = ([from, to]) => {
    const first = Math.max(0, Math.floor(from / binHz));
    const last = Math.min(bytes.length - 1, Math.ceil(to / binHz));
    let sum = 0;
    for (let i = first; i <= last; i++) sum += bytes[i];
    return last < first ? 0 : sum / (last - first + 1) / 255;
  };
  const shape = (x) => clamp01((x - BAND_GATE) / (1 - BAND_GATE));
  return { low: shape(mean(LOW_BAND)), high: shape(mean(HIGH_BAND)) };
}

// Each sparkle flickers on its own sine, and the highs decide how much of it shows: silent highs, dark sparkles.
export function sparkleOpacity(high, index, timeMs) {
  const flicker = 0.5 + 0.5 * Math.sin(timeMs * SPARKLE_RATE * (1 + (index % 5) * 0.37) + index * 2.4);
  return Math.round(clamp01(high * (0.35 + 0.65 * flicker)) * 100) / 100;
}

export function rmsLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return clamp01(Math.sqrt(sum / samples.length) / LOUD);
}

// A one-pole filter whose time constant depends on the direction: a hit lights up at once, and the light dies away
// after it. The step is in milliseconds, so a slow frame does not make the light slower.
export function smoothLevel(previous, next, dtMs) {
  const tau = next > previous ? ATTACK_MS : RELEASE_MS;
  return previous + (next - previous) * (1 - Math.exp(-Math.max(0, dtMs) / tau));
}

// `step` is the playhead's step in the sequence and `sinceStepMs` how long ago it moved there; a step lasts
// 60000 / bpm / STEPS_PER_BEAT milliseconds, so how far through it we are carries the beat on between steps.
export function beatPhase({ step, sinceStepMs, bpm }) {
  if (step < 0) return 0; // the scheduler is at -1 before its first step; a negative phase would read as a hit
  const stepMs = 60000 / bpm / STEPS_PER_BEAT;
  const within = clamp01(sinceStepMs / stepMs);
  return (((step % STEPS_PER_BEAT) + within) / STEPS_PER_BEAT) % 1;
}

// A sharp rise on the beat and a curved fall, like a lamp on a kick drum.
export function beatPulse(phase) {
  return (1 - clamp01(phase)) ** 3;
}

// `beat` is the beat's number in the sequence and `timeMs` the page's clock: the main glow wanders on slow sines of
// it, and the side lights take the beats in turn (left on the even ones). `still` holds all of that at rest, for a
// person who asked for less motion; the colour and brightness still follow the sound.
// Where the orbiting lights are for an angle: evenly round an ellipse centred on the window. The first is at the angle,
// the next a quarter turn on, and so on, so with four they are at the four corners at once.
export function orbitPositions(angle, count = ORBIT_LIGHTS) {
  return Array.from({ length: count }, (_, k) => {
    const a = angle + (k / count) * Math.PI * 2;
    return {
      x: Math.round((50 + ORBIT_RADIUS.x * Math.cos(a)) * 100) / 100,
      y: Math.round((50 + ORBIT_RADIUS.y * Math.sin(a)) * 100) / 100,
    };
  });
}

export function lightFrame({
  level,
  phase,
  playing,
  beat = 0,
  bpm = 100,
  timeMs = 0,
  still = false,
  low = 0,
  high = 0,
}) {
  const heat = clamp01(level);
  const pulse = playing && !still ? beatPulse(phase) : 0; // a flash on every beat is the motion `still` is asked to hold back
  const t = still ? 0 : timeMs / 1000;
  const evenTurn = beat % 2 === 0;
  const round = (x) => Math.round(x * 100) / 100;
  return {
    hue: Math.round(HUE_QUIET * (1 - heat) + HUE_WANDER * Math.sin(t * 0.25)),
    glow: clamp01(GLOW_REST + pulse * GLOW_PULSE + heat * GLOW_LEVEL + low * GLOW_LOW),
    pulse,
    x: round(50 + DRIFT_X * Math.sin(t * 0.45)),
    y: round(55 + DRIFT_Y * Math.sin(t * 0.31 + 1)),
    size: round(MAIN_SIZE + pulse * SIZE_PULSE + heat * SIZE_LEVEL + low * SIZE_LOW),
    high: clamp01(high),
    even: round(playing && evenTurn ? pulse : pulse * OFF_TURN),
    odd: round(playing && !evenTurn ? pulse : pulse * OFF_TURN),
    spin: still ? 0 : ORBIT_RATE * (bpm / 100) + heat * ORBIT_LEVEL,
  };
}
