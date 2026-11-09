// A loaded sample as a pad sound, and the decoding that makes one. No DOM, and nothing at import time.
//
//   const seconds = await probeDuration(file);            // a file's length from its header, or null: before decoding
//   const result = await decodeSample(ctx, arrayBuffer);   // { ok: true, buffer } or { ok: false, reason }
//   const sound = createSampleSound({ id, name, buffer, bytes }); // the shape of the built-in sounds: play(ctx, out, t)
//
// A sample plays once, to its end; hitting the pad again cuts the earlier hit off (voices.js), so a pad plays one
// copy at a time. The decoded buffer is shared; each hit makes a source of its own (they are
// single-use).

import { envelopeShape } from "./pad-envelope.js";
import { FULL_TRIM, clampTrim, isFullTrim, parseTrim, trimWindow } from "./trim.js";
import { computePeaks } from "./waveform.js";

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

// Where a trimmed sample starts and stops it is faded over this long, so cutting it mid-wave does not click.
export const EDGE_FADE_SECONDS = 0.003;
// A trimmed sample's window is counted from the time it is told to start. A hit at the clock's "now" is already a
// little late by the time the audio thread gets it, and a window that has started in the past is cut off at the
// front (a 5 ms window 10 ms late was silent, in Chrome). So a trimmed hit starts at least this far ahead of the
// clock: a few milliseconds of delay, which is under the output's own, for a window that always plays whole.
export const TRIM_LEAD_SECONDS = 0.005;
const PEAK_COLUMNS = 400; // the outline is made once, at a width the view can draw at any size

// A gain stage in front of `out`, ramped through the envelope from `start` for `heard` seconds: what to play into.
function envelopeStage(ctx, out, start, envelope, heard) {
  const stage = ctx.createGain();
  const shape = envelopeShape(envelope, heard);
  stage.gain.setValueAtTime(shape[0][1], start + shape[0][0]);
  for (const [time, level] of shape.slice(1)) stage.gain.linearRampToValueAtTime(level, start + time);
  stage.connect(out);
  return stage;
}

// `bytes` is the size of the file it came from. `info` is what the pad editor shows about it: not the sample
// rate, which the decoded buffer reports as the audio context's and not the file's. `trim` is the part that
// plays (trim.js): all of it unless given.
export function createSampleSound({ id, name, buffer, bytes, trim = FULL_TRIM }) {
  let current = clampTrim(parseTrim(trim), buffer.duration);
  let peaks = null;
  return {
    id,
    name,
    info: { seconds: buffer.duration, channels: buffer.numberOfChannels, bytes },
    duration: buffer.duration,
    get trim() {
      return current;
    },
    // Sets the part that plays and gives back what it became (kept possible: see clampTrim). `moved` is the
    // handle being dragged.
    setTrim(next, moved) {
      current = clampTrim(next, buffer.duration, moved);
      return current;
    },
    // The sample's outline, for drawing: made the first time it is asked for.
    peaks() {
      peaks ??= computePeaks(buffer, PEAK_COLUMNS);
      return peaks;
    },
    // `options.rate` is the playbackRate (2 is an octave up); left out, the sample plays at its own pitch.
    // `options.envelope` is { attack, decay, sustain, release } (pad-envelope.js): a gain stage of its own, ramped through
    // the shape over the time the sample is heard for, between the sample and `out`; left out, there is no such stage.
    play(ctx, out, t, { rate = 1, envelope = null } = {}) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      const trimmed = !isFullTrim(current);
      // Only the trimmed part, faded in where it starts if that is not the start of the file and out where
      // it stops if that is not the end. `length` is in the sample's own time: the rate shortens it when played.
      // `t` is moved on to the lead where it is already behind it, and the fades and the start use the moved time.
      const { offset, length } = trimmed
        ? trimWindow(current, buffer.duration)
        : { offset: 0, length: buffer.duration };
      if (trimmed) t = Math.max(t, (ctx.currentTime ?? 0) + TRIM_LEAD_SECONDS);
      const heard = length / rate;
      if (envelope) out = envelopeStage(ctx, out, t, envelope, heard);
      if (!trimmed) {
        source.connect(out);
        source.start(t);
        return;
      }
      const fade = Math.min(EDGE_FADE_SECONDS, heard / 2);
      const stage = ctx.createGain();
      stage.gain.setValueAtTime(current.start > 0 ? 0 : 1, t);
      if (current.start > 0) stage.gain.linearRampToValueAtTime(1, t + fade);
      if (current.end < 1) {
        stage.gain.setValueAtTime(1, t + heard - fade);
        stage.gain.linearRampToValueAtTime(0, t + heard);
      }
      source.connect(stage);
      stage.connect(out);
      source.start(t, offset, length);
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
