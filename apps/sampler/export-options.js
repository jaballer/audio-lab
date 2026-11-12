// What an export can be told, and what the Export dialog says about the file before it is made: the sequence showing or the
// song, how many times the loop is repeated in the file, stereo or mono, the mix as one file or a stem for each
// pad in a zip, and from those how long and how big the file will be. No DOM, and nothing at import time.
//
//   normalizeExportOptions(loadJson(KEY))                  // { loops: 1, channels: "stereo", files: "mix", scope: "sequence" }, whatever was saved
//   const info = exportInfo(song, options, 16, 44100);     // { frames, seconds, bytes, channels }
//   exportReadout(info)                                    // "4.8 s · mono · 413 KB"
//   stemsInfo(song, options, 16, 44100, 5)                 // the same for 5 stems in a zip: { frames, seconds, bytes, channels, stems }
//   exportFormat(44100)                                    // "16-bit 44.1 kHz"
//   largeExportNote(exportMemoryBytes(plan))               // "" or "Making this takes about 290 MB of memory, ..."

import { stepSeconds } from "../../shared/tempo.js";
import { cleanArrangement, passOrder, resolveArrangement } from "./arrangement.js";
import { formatSize, pad2 } from "./format.js";

// 1 is the sequence as it is; the others repeat it back to back in one file. Powers of two, like the bar lengths.
export const LOOP_CHOICES = [1, 2, 4, 8];
export const CHANNEL_CHOICES = ["stereo", "mono"];
// The mix is one file, as the export has always been; stems are a file for each pad that has steps, in a zip.
export const FILE_CHOICES = ["mix", "stems"];
// The sequence showing, looped as asked, as the export has always been; or the song, as the Song panel has it (every entry in order,
// each as often as it repeats, as Song mode plays it), with no loop to come round and a tail on the end for what rings on.
export const SCOPE_CHOICES = ["sequence", "song"];
export const DEFAULT_EXPORT_OPTIONS = Object.freeze({ loops: 1, channels: "stereo", files: "mix", scope: "sequence" });

// What an export of the song adds after the last step, for what is still ringing (a crash, a long sample): the file does
// not come round to be mixed into its own start, as a loop does. A fixed time, so that the dialog can say how long the file is
// without knowing the sounds; a sample longer than that is cut.
export const SONG_TAIL_SECONDS = 4;

// The longest file Export makes of a song, tail and all: about as large as the biggest export there was before there was a song
// to repeat (eight bars at 40 BPM, eight times over, is 388 s, and took about 260 MB over the page's own to make: the render is one
// buffer, and so is the file). The Song panel lets a song be 32 entries of 16 repeats, which is hours: past this the dialog says so
// and Export does not start, where for the sequence showing it only warns (its loops are a choice of a few, and it is short to
// begin with). Longer than this wants the render and the file made in pieces, not one buffer.
export const MAX_SONG_EXPORT_SECONDS = 400;

// Options from anywhere (saved by an older version, edited by hand, missing): each one that is not a choice we
// offer falls back to its default, and the other is kept.
export function normalizeExportOptions(raw) {
  // What the song was called here before it had an order of its own ("all" the sequences): a saved choice of it is the song now.
  const scope = raw?.scope === "all" ? "song" : raw?.scope;
  return {
    loops: LOOP_CHOICES.includes(raw?.loops) ? raw.loops : DEFAULT_EXPORT_OPTIONS.loops,
    channels: CHANNEL_CHOICES.includes(raw?.channels) ? raw.channels : DEFAULT_EXPORT_OPTIONS.channels,
    files: FILE_CHOICES.includes(raw?.files) ? raw.files : DEFAULT_EXPORT_OPTIONS.files,
    scope: SCOPE_CHOICES.includes(scope) ? scope : DEFAULT_EXPORT_OPTIONS.scope,
  };
}

export const channelCount = (channels) => (channels === "mono" ? 1 : 2);

// The song's arrangement as it plays (arrangement.js): a list of entries, or null for a song nobody has edited, which is every
// sequence once, in order. Read as the page reads a saved one, so an entry for a sequence there is not cannot reach the render.
const arrangementOf = (song) => cleanArrangement(song.arrangement, song.sequences.length);

// How many entries the song has: the Song panel's, or with no arrangement a sequence each.
export const songEntries = (song) => resolveArrangement(arrangementOf(song), song.sequences.length).length;

// The sequence of each pass of the song, in order, with every entry's repeats counted out ([2, 2, 2, 1]): what the render of it is
// made of, the one walk that playback and export share.
export const songPassOrder = (song) => passOrder(arrangementOf(song), song.sequences.length);

// How many steps the song plays between its first and its last, before the tail: every pass of it, a sequence that repeats as often
// as it does and one the song leaves out not at all.
export const songSteps = (song, stepsPerBar) =>
  songPassOrder(song).reduce((sum, index) => sum + song.sequences[index].bars * stepsPerBar, 0);

// How long the file of the song is, in seconds: its steps at the tempo and the tail.
export const songFileSeconds = (song, stepsPerBar) =>
  songSteps(song, stepsPerBar) * stepSeconds(song.bpm) + SONG_TAIL_SECONDS;

// Is the song longer than Export makes (MAX_SONG_EXPORT_SECONDS)?
export const songTooLong = (song, stepsPerBar) => songFileSeconds(song, stepsPerBar) > MAX_SONG_EXPORT_SECONDS;

// How many frames the file has: `loops` times the sequence showing, rounded once, so eight loops are eight times
// the length and not eight roundings of it; or for `scope` "song" the song once through, and the tail (loops are not counted).
export function exportFrames(song, stepsPerBar, loops, sampleRate, scope = "sequence") {
  if (scope === "song") return Math.round(songFileSeconds(song, stepsPerBar) * sampleRate);
  const sequence = song.sequences[song.current];
  const loopSeconds = sequence.bars * stepsPerBar * stepSeconds(song.bpm);
  return Math.round(loopSeconds * loops * sampleRate);
}

// The 44 bytes in front of the audio in the file (see encodeWav), and two bytes to a 16-bit sample.
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

export function exportInfo(song, options, stepsPerBar, sampleRate) {
  const { loops, channels, scope } = normalizeExportOptions(options);
  const frames = exportFrames(song, stepsPerBar, loops, sampleRate, scope);
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

// What the dialog says about the choice of files and of scope, in the place of its hint about loops: nothing for the mix of the
// sequence showing (the dialog's own words stay), for stems what they are, and for the song what the file is.
export function exportHint(files, scope = "sequence") {
  return [
    files === "stems" &&
      "One file for each pad that has steps, in one zip. They are not clipped, and they add up to the mix.",
    scope === "song" &&
      `Each entry of the song, in order, as many times as it repeats, then ${SONG_TAIL_SECONDS} s for what rings on (a longer sound is cut). There is no loop to come round, so loops are not offered.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// What every file is, on a line of its own: "16-bit 44.1 kHz" (or 48: the rate is the page's, see exportSampleRate).
export function exportFormat(sampleRate) {
  return `16-bit ${Number((sampleRate / 1000).toFixed(1))} kHz`;
}

// The dialog's heading: which sequence, how long, at what tempo ("SEQ 01 · 2 BARS · 100 BPM"), or for the song how many entries
// it has ("SONG · 3 ENTRIES · 100 BPM"): its length is the readout's to say, with the repeats in it.
export function exportTitle(song, scope = "sequence") {
  if (scope === "song") {
    const count = songEntries(song);
    return `SONG · ${count} ${count === 1 ? "ENTRY" : "ENTRIES"} · ${Math.round(song.bpm)} BPM`;
  }
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
// For the song it is the sequences it plays that have no steps (`emptySequenceNumbers`) in place of the bars.
export function exportNote(plan, emptyBarNumbers, memory = {}, emptySequenceNumbers = []) {
  return [
    emptyBarsNote(emptyBarNumbers),
    emptySequencesNote(emptySequenceNumbers),
    largeExportNote(exportMemoryBytes(plan, memory), memory),
  ]
    .filter(Boolean)
    .join(" ");
}

// `{ stems }` says it is for stems, which can also be made smaller by being mono (and not by being a mix). `{ scope }` "song" says it
// is for the song, which has no loops to make fewer: what makes it smaller is a shorter song (fewer entries or repeats), or one
// sequence at a time.
export function largeExportNote(bytes, { stems = 0, scope = "sequence" } = {}) {
  if (bytes < LARGE_EXPORT_BYTES) return "";
  const megabytes = Math.round(bytes / MEBIBYTE / MEMORY_ROUNDING_MB) * MEMORY_ROUNDING_MB;
  const song = scope === "song";
  const smaller = song
    ? stems
      ? "Mono, a shorter song, or one sequence at a time, makes it smaller."
      : "A shorter song, or one sequence at a time, makes it smaller."
    : stems
      ? "Fewer loops or mono make it smaller."
      : "Fewer loops make it smaller.";
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

// What the dialog says about the sequences with no steps that the song plays: they are in the file, as the silence a pass of them
// is ("Sequences 2–3 and 5 have no steps: ..."), or nothing when there are none.
export function emptySequencesNote(numbers) {
  if (!numbers.length) return "";
  const one = numbers.length === 1;
  return `${one ? "Sequence" : "Sequences"} ${joinList(runsOf(numbers))} ${one ? "has" : "have"} no steps: nothing plays in ${one ? "it" : "them"} but what is still ringing.`;
}

// Why the dialog's Export WAV is off, or nothing when it can be pressed. The browser comes first: there is no fixing
// an empty sequence in a browser that cannot render a file. Then nothing to export, then a song too long (`seconds` is the length of
// its file, for the song only: the sequence showing is made longer by its loops, which the memory note is for).
export function exportBlockedReason({ supported, hasSteps, scope = "sequence", seconds = 0 }) {
  if (!supported) return "This browser cannot render audio to a file, so Export is not available.";
  if (!hasSteps) {
    return scope === "song"
      ? "No sequence has any steps yet, so there is nothing to export."
      : "This sequence has no steps yet, so there is nothing to export.";
  }
  if (scope === "song" && seconds > MAX_SONG_EXPORT_SECONDS) {
    return `This song is ${formatDuration(seconds)} long, and Export makes at most ${formatDuration(MAX_SONG_EXPORT_SECONDS)}. Fewer repeats or entries make it shorter, or export one sequence at a time.`;
  }
  return "";
}
