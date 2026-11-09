// What an export can be told, and what the Export dialog says about the file before it is made: how many times
// the loop is repeated in the file, stereo or mono, and from those how long and how big the file will be. No DOM,
// and nothing at import time.
//
//   normalizeExportOptions(loadJson(KEY))                  // { loops: 1, channels: "stereo" }, whatever was saved
//   const info = exportInfo(song, options, 16, 44100);     // { frames, seconds, bytes, channels }
//   exportReadout(info)                                    // "4.8 s · mono · 413 KB"
//   exportFormat(44100)                                    // "16-bit 44.1 kHz"

import { stepSeconds } from "../../shared/tempo.js";
import { formatSize, pad2 } from "./format.js";

// 1 is the sequence as it is; the others repeat it back to back in one file. Powers of two, like the bar lengths.
export const LOOP_CHOICES = [1, 2, 4, 8];
export const CHANNEL_CHOICES = ["stereo", "mono"];
export const DEFAULT_EXPORT_OPTIONS = Object.freeze({ loops: 1, channels: "stereo" });

// Options from anywhere (saved by an older version, edited by hand, missing): each one that is not a choice we
// offer falls back to its default, and the other is kept.
export function normalizeExportOptions(raw) {
  return {
    loops: LOOP_CHOICES.includes(raw?.loops) ? raw.loops : DEFAULT_EXPORT_OPTIONS.loops,
    channels: CHANNEL_CHOICES.includes(raw?.channels) ? raw.channels : DEFAULT_EXPORT_OPTIONS.channels,
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

const SECONDS_PER_MINUTE = 60;

// "4.8 s" for a short file, "2 min 5 s" for a long one.
export function formatDuration(seconds) {
  const tenths = Math.round(seconds * 10) / 10; // rounded first, so 59.96 s is not "60.0 s"
  if (tenths < SECONDS_PER_MINUTE) return `${tenths.toFixed(1)} s`;
  const whole = Math.round(seconds); // rounded first, so 119.6 s is not "1 min 60 s"
  return `${Math.floor(whole / SECONDS_PER_MINUTE)} min ${whole % SECONDS_PER_MINUTE} s`;
}

// What the dialog says the file will be: "4.8 s · mono · 413 KB".
export function exportReadout(info) {
  return [formatDuration(info.seconds), info.channels, formatSize(info.bytes)].join(" · ");
}

// What every file is, on a line of its own: "16-bit 44.1 kHz".
export function exportFormat(sampleRate) {
  return `16-bit ${Number((sampleRate / 1000).toFixed(1))} kHz`;
}

// The dialog's heading: which sequence, how long, at what tempo ("SEQ 01 · 2 BARS · 100 BPM").
export function exportTitle(song) {
  const bars = song.sequences[song.current].bars;
  return `SEQ ${pad2(song.current + 1)} · ${bars} ${bars === 1 ? "BAR" : "BARS"} · ${Math.round(song.bpm)} BPM`;
}

// What the dialog says while it renders: how far it has got, in whole per cent, kept within 0 to 100, or only that
// it is working before the first report (it may be waiting for the saved samples, or the browser cannot say).
export function renderingLabel(fraction) {
  if (fraction === null || fraction === undefined) return "Rendering…";
  return `Rendering… ${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
