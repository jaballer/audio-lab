// Building blocks for synthesized sounds: noise, a decay envelope, a sweep and a filter.
// Each takes the AudioContext and returns or schedules Web Audio nodes; no DOM,
// and nothing is created until a sound asks for it.

function noiseBuffer(ctx) {
  const length = ctx.sampleRate; // 1 second of white noise
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

let cachedNoise = null;
export function noise(ctx) {
  if (!cachedNoise || cachedNoise.sampleRate !== ctx.sampleRate) cachedNoise = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = cachedNoise;
  return src;
}

export function envelope(param, t, peak, duration) {
  param.setValueAtTime(peak, t);
  param.exponentialRampToValueAtTime(0.0001, t + duration);
}

// A frequency (an oscillator's, or a filter's) that glides exponentially from `from` at `t` to `to` `duration` later.
// It holds `from` before `t` as well. Without that it holds its default (440 Hz for an oscillator, 350 for a filter), and
// a source that starts part way through a render block is made from that default for the first part of the block: the
// waveform then depends on where in the block the hit lands, which differs from one pass of a loop to the next (a kick
// sounded one way on one pass and a different way, a phase apart, on the next, so an exported loop's end did not join its
// start).
export function sweep(param, from, to, t, duration) {
  param.value = from;
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, t + duration);
}

export function filtered(ctx, type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}
