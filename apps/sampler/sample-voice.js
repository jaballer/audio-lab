// A loaded sample as a pad sound, and the decoding that makes one. No DOM, and nothing at import time.
//
//   const result = await decodeSample(ctx, arrayBuffer);   // { ok: true, buffer } or { ok: false, reason }
//   const sound = createSampleSound({ id, name, buffer }); // the same shape as the built-in sounds: play(ctx, out, t)
//
// A sample plays once, to its end; hitting the pad again lets the earlier hit ring out beside the new one,
// as the built-in sounds do. The decoded buffer is shared; each hit makes a source of its own (they are
// single-use).

export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
export const MAX_SAMPLE_SECONDS = 10;

// The short reasons are for the LCD, which is small.
export const REASONS = {
  empty: "EMPTY FILE",
  bytes: "FILE OVER 5 MB",
  notAudio: "NOT AUDIO",
  seconds: "OVER 10 SECONDS",
};

export function createSampleSound({ id, name, buffer }) {
  return {
    id,
    name,
    play(ctx, out, t) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      source.start(t);
    },
  };
}

// Decodes a file's bytes, or says why not. Never throws: a file that cannot be decoded is an ordinary
// outcome here. `decodeAudioData` takes over the bytes it is given, so it gets a copy and the caller keeps
// the original (to store it).
export async function decodeSample(ctx, bytes) {
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: REASONS.empty };
  if (bytes.byteLength > MAX_SAMPLE_BYTES) return { ok: false, reason: REASONS.bytes };
  let buffer;
  try {
    buffer = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    return { ok: false, reason: REASONS.notAudio };
  }
  if (!buffer || !(buffer.length > 0)) return { ok: false, reason: REASONS.empty };
  if (buffer.duration > MAX_SAMPLE_SECONDS) return { ok: false, reason: REASONS.seconds };
  return { ok: true, buffer };
}
