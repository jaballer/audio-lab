// A loaded sample as a pad sound, and the decoding that makes one. No DOM, and nothing at import time.
//
//   const seconds = await probeDuration(file);            // a file's length from its header, or null: before decoding
//   const result = await decodeSample(ctx, arrayBuffer);   // { ok: true, buffer } or { ok: false, reason }
//   const sound = createSampleSound({ id, name, buffer }); // the same shape as the built-in sounds: play(ctx, out, t)
//
// A sample plays once, to its end; hitting the pad again lets the earlier hit ring out beside the new one,
// as the built-in sounds do. The decoded buffer is shared; each hit makes a source of its own (they are
// single-use).

// Why these numbers. Decoded audio is 4-byte floats at the audio context's rate, so a sample costs
// seconds x rate x channels x 4 bytes of memory: 10 s of stereo at 48 kHz is about 3.7 MiB, and the 16 pads at
// the cap are about 59 MiB, which is the most the kit can ever take whatever the files are (a typical drum hit
// of half a second is a few hundred KB). The file cap keeps a file from being read whole into memory and
// decoded for nothing; 5 MB holds 10 s of 48 kHz 24-bit stereo WAV with room to spare, and MP3s of that
// length are a few hundred KB. The length is checked from the file's header first (probeDuration), because
// a 5 MB MP3 can be five minutes long and decoding that, only to refuse it, would take over 100 MB and a
// second or more of CPU.
export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
export const MAX_SAMPLE_SECONDS = 10;
// The length from a header is an estimate for some formats (an MP3 with no length in its header), so it is only
// a hint: a file is refused early when it is far over the limit, and decoding makes the exact call for the rest.
// A browser that never loads metadata for an element that is not on the page (some mobile Safari) costs a load
// this much waiting, then decoding goes on as if there were no probe.
export const PROBE_REFUSE_SECONDS = MAX_SAMPLE_SECONDS * 2;
const PROBE_TIMEOUT_MS = 1000;

// The short reasons are for the LCD, which is small.
export const REASONS = {
  empty: "EMPTY FILE",
  bytes: "FILE OVER 5 MB",
  notAudio: "NOT AUDIO",
  seconds: "OVER 10 SECONDS",
};

// The length of an audio file in seconds, read from its header by a media element without decoding it, or null
// when that cannot be told (a format the browser will not read, no metadata in time). Never throws or rejects.
// `env` is where the element and the object URLs come from, so a test can hand in stand-ins.
export function probeDuration(file, env = {}) {
  const {
    createAudio = () => new Audio(),
    createUrl = (blob) => URL.createObjectURL(blob),
    revokeUrl = (url) => URL.revokeObjectURL(url),
    timeoutMs = PROBE_TIMEOUT_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  } = env;
  return new Promise((resolve) => {
    let url = null;
    let audio = null;
    let timer = null;
    const finish = (seconds) => {
      clearTimer(timer);
      if (audio) {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        // Removing the source alone does not stop the element holding the file: load() with none does.
        audio.removeAttribute?.("src");
        audio.load?.();
      }
      if (url) revokeUrl(url);
      // Infinity and NaN are what a stream without a known length reports.
      resolve(Number.isFinite(seconds) && seconds >= 0 ? seconds : null);
    };
    try {
      url = createUrl(file);
      audio = createAudio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(null);
      timer = setTimer(() => finish(null), timeoutMs);
      audio.src = url;
    } catch {
      finish(null);
    }
  });
}

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
