// Building blocks for synthesized sounds: noise, a decay envelope and a filter.
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

export function envelope(ctx, param, t, peak, duration) {
  param.setValueAtTime(peak, t);
  param.exponentialRampToValueAtTime(0.0001, t + duration);
}

export function filtered(ctx, type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}
