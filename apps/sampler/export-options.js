// What an export can be told, and what the Export dialog says about the file before it is made: how many times
// the loop is repeated in the file, stereo or mono, the mix as one file or a stem for each pad in a zip, and from those
// how long and how big the file will be. No DOM, and nothing at import time.
//
//   normalizeExportOptions(loadJson(KEY))                  // { loops: 1, channels: "stereo", files: "mix" }, whatever was saved
//   const info = exportInfo(song, options, 16, 44100);     // { frames, seconds, bytes, channels }
//   exportReadout(info)                                    // "4.8 s · mono · 413 KB"
//   stemsInfo(song, options, 16, 44100, 5)                 // the same for 5 stems in a zip: { frames, seconds, bytes, channels, stems }
//   exportFormat(44100)                                    // "16-bit 44.1 kHz"
//   largeExportNote(exportMemoryBytes(plan))               // "" or "Making this takes about 290 MB of memory, ..."

import { stepSeconds } from "../../shared/tempo.js";
import { formatSize, pad2 } from "./format.js";

// 1 is the sequence as it is; the others repeat it back to back in one file. Powers of two, like the bar lengths.
export const LOOP_CHOICES = [1, 2, 4, 8];
export const CHANNEL_CHOICES = ["stereo", "mono"];
// The mix is one file, as the export has always been; stems are a file for each pad that has steps, in a zip.
export const FILE_CHOICES = ["mix", "stems"];
export const DEFAULT_EXPORT_OPTIONS = Object.freeze({ loops: 1, channels: "stereo", files: "mix" });

// Options from anywhere (saved by an older version, edited by hand, missing): each one that is not a choice we
// offer falls back to its default, and the other is kept.
export function normalizeExportOptions(raw) {
  return {
    loops: LOOP_CHOICES.includes(raw?.loops) ? raw.loops : DEFAULT_EXPORT_OPTIONS.loops,
    channels: CHANNEL_CHOICES.includes(raw?.channels) ? raw.channels : DEFAULT_EXPORT_OPTIONS.channels,
    files: FILE_CHOICES.includes(raw?.files) ? raw.files : DEFAULT_EXPORT_OPTIONS.files,
  };
}

export const channelCount = (channels) => (channels === "mono" ? 1 : 2);

// How many frames the file has: `loops` times the sequence showing, rounded once, so eight loops are eight times
// the length and not eight roundings of it.
export function exportFrames(song, stepsPerBar, loops, sampleRate) {
  const sequence = song.sequences[song.current];
  const loopSeconds = sequence.bars * stepsPerBar * stepSeconds(song.bpm);
  return Math.round(loopSeconds * loops * sampleRate);
}

// The 44 bytes in front of the audio in the file (see encodeWav), and two bytes to a 16-bit sample.
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

export function exportInfo(song, options, stepsPerBar, sampleRate) {
  const { loops, channels } = normalizeExportOptions(options);
  const frames = exportFrames(song, stepsPerBar, loops, sampleRate);
  return {
    frames,
    seconds: frames / sampleRate,
    bytes: WAV_HEADER_BYTES + frames * channelCount(channels) * BYTES_PER_SAMPLE,
    channels,
  };
}

// What a zip adds to each file: a header before it and one in the directory (30 and 46 bytes) and its name in both, which is
// about 45 bytes here ("pad16-seq-01-100bpm-x4-mono-pad03-snare.wav"), and 22 bytes to end it (see zip.js).
export const ZIP_BYTES_PER_FILE = 170;
const ZIP_END_BYTES = 22;

// The same as exportInfo for `stems` stems in a zip: each stem is a file as long as the mix, and the zip is the files and
// its headers (nothing is compressed).
export function stemsInfo(song, options, stepsPerBar, sampleRate, stems) {
  const info = exportInfo(song, options, stepsPerBar, sampleRate);
  return { ...info, bytes: stems * (info.bytes + ZIP_BYTES_PER_FILE) + ZIP_END_BYTES, stems };
}

const SECONDS_PER_MINUTE = 60;

// "4.8 s" for a short file, "2 min 5 s" for a long one.
export function formatDuration(seconds) {
  const tenths = Math.round(seconds * 10) / 10; // rounded first, so 59.96 s is not "60.0 s"
  if (tenths < SECONDS_PER_MINUTE) return `${tenths.toFixed(1)} s`;
  const whole = Math.round(seconds); // rounded first, so 119.6 s is not "1 min 60 s"
  return `${Math.floor(whole / SECONDS_PER_MINUTE)} min ${whole % SECONDS_PER_MINUTE} s`;
}

// What the dialog says the file will be: "4.8 s · mono · 413 KB", or for stems (`info.stems`) "5 stems · 2.0 s each ·
// stereo · 1.7 MB zip".
export function exportReadout(info) {
  if (info.stems === 0) return "No stems"; // stems are chosen and no pad has a step
  if (info.stems) {
    return [
      `${info.stems} ${info.stems === 1 ? "stem" : "stems"}`,
      `${formatDuration(info.seconds)} each`,
      info.channels,
      `${formatSize(info.bytes)} zip`,
    ].join(" · ");
  }
  return [formatDuration(info.seconds), info.channels, formatSize(info.bytes)].join(" · ");
}

// What the dialog says about the choice of files, in the place of its hint about loops: nothing for the mix (the dialog's
// own words stay), and for stems what they are.
export function exportHint(files) {
  if (files !== "stems") return "";
  return "One file for each pad that has steps, in one zip. They are not clipped, and they add up to the mix.";
}

// What every file is, on a line of its own: "16-bit 44.1 kHz" (or 48: the rate is the page's, see exportSampleRate).
export function exportFormat(sampleRate) {
  return `16-bit ${Number((sampleRate / 1000).toFixed(1))} kHz`;
}

// The dialog's heading: which sequence, how long, at what tempo ("SEQ 01 · 2 BARS · 100 BPM").
export function exportTitle(song) {
  const bars = song.sequences[song.current].bars;
  return `SEQ ${pad2(song.current + 1)} · ${bars} ${bars === 1 ? "BAR" : "BARS"} · ${Math.round(song.bpm)} BPM`;
}

// How much memory making the file takes at most, which is what a phone may run out of before it runs out of time. A render
// is two float channels (4 bytes each) over its whole length, the warm-up before the file included; then the file is made
// from it while it is still held: stereo holds the file's bytes and its Blob (4 bytes a frame each), mono holds the mix-down
// (4) and its file twice (2 each), which is the same 8. Measured in Chromium, a 384 s file made after a 48 s warm-up took
// 297 MB (stereo) and 312 MB (mono) over what the page already used, against the 275 MB this gives (at 44.1 kHz; it grows with the rate): a little low, which the threshold allows for. `plan` is what
// planRender gives (`total` is the render's length in frames and `frames` the file's).
const RENDER_BYTES_PER_FRAME = 8;
const FILE_BYTES_PER_FRAME = 8;
// For `stems` stems it is the render (one at a time, each let go of once its file is encoded) and the files: every stem's
// file is held until the zip is made, and the zip's Blob is a copy of them (two bytes a sample, a channel each, twice).
const STEM_FILE_COPIES = 2;
export function exportMemoryBytes({ total, frames }, { stems = 0, channels = "stereo" } = {}) {
  if (!stems) return RENDER_BYTES_PER_FRAME * total + FILE_BYTES_PER_FRAME * frames;
  const file = frames * channelCount(channels) * BYTES_PER_SAMPLE;
  return RENDER_BYTES_PER_FRAME * total + STEM_FILE_COPIES * stems * file;
}

// From here the dialog says what it costs. The biggest single export (8 bars at 40 BPM, 8 loops, a 6 minute file) is about
// 275 MB with the built-in sounds, and up to about 330 when a loaded sample has a long release (one more warm-up pass); one
// that fits, with 4 loops, is about 145. A phone's tab has a few hundred MB to spare on a good day. Not counted: the decoded
// samples the page already holds, and Firefox, which cannot pause a render and so starts every node up front.
const MEBIBYTE = 1024 * 1024;
export const LARGE_EXPORT_BYTES = 200 * MEBIBYTE;
const MEMORY_ROUNDING_MB = 10;

// What the dialog says about an export before it is made, as one line: the bars with no steps (`emptyBarNumbers`, from
// emptyBars) and a memory warning for the render `plan` (from planRender), when there is anything to say.
export function exportNote(plan, emptyBarNumbers, memory = {}) {
  return [emptyBarsNote(emptyBarNumbers), largeExportNote(exportMemoryBytes(plan, memory), memory)]
    .filter(Boolean)
    .join(" ");
}

// `{ stems }` says it is for stems, which can also be made smaller by being mono (and not by being a mix).
export function largeExportNote(bytes, { stems = 0 } = {}) {
  if (bytes < LARGE_EXPORT_BYTES) return "";
  const megabytes = Math.round(bytes / MEBIBYTE / MEMORY_ROUNDING_MB) * MEMORY_ROUNDING_MB;
  const smaller = stems ? "Fewer loops or mono make it smaller." : "Fewer loops make it smaller.";
  return `Making this takes about ${megabytes} MB of memory, which a phone may not have to spare. ${smaller}`;
}

// What the dialog says while it renders (and, for stems, which of them it is on: `{ number, count }`): how far it has got, in whole per cent, kept within 0 to 100, or only that it is
// working before the first report (it may be waiting for the saved samples, or the browser cannot say). Not how long is
// left: the windows of a render do not cost the same (a dense bar then sparse ones), so a rate so far is a poor guide:
// measured, it said "a few seconds" for eighteen.
export function renderingLabel(fraction, stem = null) {
  // Stems are many renders, and the percentage is of all of them: which one it is on is said as well (not for just one).
  const what = stem && stem.count > 1 ? `Rendering stem ${stem.number} of ${stem.count}…` : "Rendering…";
  if (fraction === null || fraction === undefined) return what;
  return `${what} ${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

// Runs of consecutive numbers as "2–8" (and a lone one as "3"): [1, 2, 4] is ["1–2", "4"].
function runsOf(numbers) {
  const runs = [];
  for (const number of numbers) {
    const last = runs[runs.length - 1];
    if (last && number === last.to + 1) last.to = number;
    else runs.push({ from: number, to: number });
  }
  return runs.map(({ from, to }) => (from === to ? String(from) : `${from}–${to}`));
}

// "A and B", "A, B and C".
const joinList = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// What the dialog says about bars with no steps, which are silent in the file ("Bars 2–8 have no steps: ..."), or
// nothing when there are none. Not "silent": a long sound from the bar before goes on ringing into the next.
export function emptyBarsNote(bars) {
  if (!bars.length) return "";
  const one = bars.length === 1;
  return `${one ? "Bar" : "Bars"} ${joinList(runsOf(bars))} ${one ? "has" : "have"} no steps: nothing plays in ${one ? "it" : "them"} but what is still ringing.`;
}

// Why the dialog's Export WAV is off, or nothing when it can be pressed. The browser comes first: there is no fixing
// an empty sequence in a browser that cannot render a file.
export function exportBlockedReason({ supported, hasSteps }) {
  if (!supported) return "This browser cannot render audio to a file, so Export is not available.";
  if (!hasSteps) return "This sequence has no steps yet, so there is nothing to export.";
  return "";
}
