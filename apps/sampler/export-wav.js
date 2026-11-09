// Exporting a sequence as an audio file: the sequence is played into an offline audio context, as fast as the
// computer can, with the same sounds, velocities, pad settings, retrigger cuts, master volume and clipper as the page
// plays them, and the result is written as a 16-bit WAV. No DOM, and nothing at import time.
//
//   const audio = await renderSequence({ song, kit, stepsPerBar: 16 });   // { sampleRate, channels: [Float32Array, ...] }
//   const bytes = encodeWav(audio.channels, audio.sampleRate);              // an ArrayBuffer: the .wav file
//   exportName(song)                                                        // "pad16-seq-01-100bpm.wav"
//
// `song` is what the sampler saves (controller.getSong()): the sequence exported is the one showing (`current`), and
// the file is exactly the length of its bars, so it loops. To make it loop cleanly the sequence is played more than
// once and the last pass is kept: what rings on from the end of the earlier passes (a crash, a long sample, a long
// Release) is in the start of it, as it is when the page loops, and a pad's last hit is cut by its first hit of the
// next pass. Two passes (one to warm up) are enough unless a pad's Release is longer than the loop: then each tail
// reaches into several passes, and there are enough before the kept one to cover the longest. The
// render does not depend on the power switch or on the audio context of the page. A long render reports how far it
// has got and can be cancelled (see PROGRESS_PAUSES).
//
// `loops` keeps the loop that many times in one file (the passes after the warm-up are all kept, and run on into
// each other as the page's loop does), and `channels: "mono"` mixes the two channels down to one. What the dialog
// offers is in export-options.js.

import { createClipper } from "../../shared/audio.js";
import { VOLUME_SCALE } from "./controller.js";
import { FULL_VELOCITY } from "../../shared/pattern.js";
import { withVelocity } from "../../shared/sounds.js";
import { stepSeconds } from "../../shared/tempo.js";
import { DEFAULT_EXPORT_OPTIONS, exportFrames, normalizeExportOptions } from "./export-options.js";
import { pad2 } from "./format.js";
import { createVoices } from "./voices.js";

export const EXPORT_SAMPLE_RATE = 44100;
// The first step is not at time 0: a trimmed sample starts at least a few milliseconds into the context's time (see
// sample-voice.js), so every step is moved on by this much, which keeps every hit where it belongs.
export const LEAD_SECONDS = 0.01;
// How many passes may come before the one that is kept, at most: a 5 s release in a 1 s loop needs six; a longer one is
// cut short rather than render for ever (the oldest, quietest tails are left out).
export const MAX_WARM_UP_PASSES = 12;
// The render is paused this many times along its length to say how far it has got, and to notice a cancel: a cancelled
// render stops at the next pause, so the computer is free again within a twentieth of the work.
export const PROGRESS_PAUSES = 20;
// The audio engine moves in blocks of this many frames, and a pause lands on one of their edges.
const RENDER_QUANTUM = 128;

// The frames to pause at, as a whole number of blocks: `count` of them spread over `total`, none at the very start or
// end and none twice (two pauses in one block are an error), so a short render has fewer.
export function pauseFrames(total, count = PROGRESS_PAUSES) {
  const frames = new Set();
  for (let i = 1; i <= count; i++) {
    const frame = Math.round((total * i) / (count + 1) / RENDER_QUANTUM) * RENDER_QUANTUM;
    if (frame > 0 && frame < total) frames.add(frame);
  }
  return [...frames];
}

const cancelled = () => new DOMException("Export cancelled", "AbortError");
export const wasCancelled = (error) => error?.name === "AbortError";

// Renders `ctx` (an OfflineAudioContext of `total` frames), reporting `onProgress(0..1)` at each pause. After `signal`
// aborts it ends with an AbortError once the render has really stopped: at its next pause, which it is not resumed
// from, or at its end, where it cannot pause (Firefox has no OfflineAudioContext.suspend) or has passed its last. Not
// sooner, so that an export is not over, and another cannot start beside it, while the first still renders.
async function renderWithProgress(ctx, total, sampleRate, { onProgress, signal }) {
  if (signal?.aborted) throw cancelled();
  // A pause that cannot be resumed would leave the render waiting for ever, so that fails the render with its error.
  let fail;
  const failed = new Promise((_, reject) => (fail = reject));
  const report = (fraction) => {
    try {
      onProgress?.(fraction);
    } catch (error) {
      console.error("Export progress failed:", error); // only for the eye: the render goes on
    }
  };
  if (typeof ctx.suspend === "function") {
    for (const frame of pauseFrames(total)) {
      // A quarter of a block early: the time is rounded to a block edge, up or to the nearest, and this lands on it either way.
      ctx
        .suspend((frame - RENDER_QUANTUM / 4) / sampleRate)
        .then(
          () => {
            if (signal?.aborted) return fail(cancelled()); // left paused for good: nothing more is rendered
            const resumed = ctx.resume(); // first: nothing in the report may keep the render waiting
            report(frame / total);
            return resumed;
          },
          () => {}, // a pause that could not be set only loses one progress report
        )
        .catch(fail);
    }
  }
  const rendered = await Promise.race([ctx.startRendering(), failed]);
  if (signal?.aborted) throw cancelled();
  report(1);
  return rendered;
}

// The steps that are on, as { step, row, velocity }, in the order they sound (and per step by pad). Only the steps of
// the bars the sequence has: a sequence made shorter keeps the steps of the bars it dropped (for when they come
// back), and the page does not play them.
export function hitsOf(sequence, stepsPerBar) {
  const hits = [];
  const length = sequence.bars * stepsPerBar;
  for (const [rowKey, on] of Object.entries(sequence.pattern)) {
    const row = Number(rowKey);
    for (const step of on) {
      if (step >= length) continue;
      hits.push({ step, row, velocity: sequence.velocities?.[rowKey]?.[step] ?? FULL_VELOCITY });
    }
  }
  return hits.sort((a, b) => a.step - b.step || a.row - b.row);
}

export async function renderSequence({
  song,
  kit,
  stepsPerBar,
  sampleRate = EXPORT_SAMPLE_RATE,
  createContext = (length, rate) => new OfflineAudioContext(2, length, rate),
  loops = DEFAULT_EXPORT_OPTIONS.loops,
  channels: channelMode = DEFAULT_EXPORT_OPTIONS.channels,
  onProgress,
  signal,
}) {
  const copies = Math.max(1, Math.floor(loops) || 1);
  const sequence = song.sequences[song.current];
  const hits = hitsOf(sequence, stepsPerBar);
  const length = sequence.bars * stepsPerBar; // steps in one pass
  const stepLength = stepSeconds(song.bpm);
  // The last pass is the file. The passes before it are warm-up: a voice rings on after it is cut, for the pad's Release,
  // and a Release longer than the loop leaves tails from several passes back in the loop's steady state, so there are
  // enough passes before the one kept to cover the longest (one, with no release).
  const loopSeconds = length * stepLength;
  const longestRelease = Math.max(0, ...hits.map(({ row }) => kit.envelope(row)?.release ?? 0));
  const warmUp = Math.min(MAX_WARM_UP_PASSES, 1 + Math.ceil(longestRelease / loopSeconds));
  const first = Math.round((LEAD_SECONDS + warmUp * loopSeconds) * sampleRate);
  const frames = exportFrames(song, stepsPerBar, copies, sampleRate);
  const ctx = createContext(first + frames, sampleRate);

  const master = ctx.createGain();
  master.gain.value = song.volume / VOLUME_SCALE;
  const clipper = createClipper(ctx);
  if (clipper) {
    master.connect(clipper.input);
    clipper.output.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }

  const voices = createVoices(kit.length, {
    cleanUp: false,
    groupOf: (pad) => kit.settings(pad).choke,
    releaseOf: (pad) => kit.envelope(pad)?.release ?? 0,
  });
  for (let pass = 0; pass < warmUp + copies; pass++) {
    for (const { step, row, velocity } of hits) {
      const time = LEAD_SECONDS + (pass * length + step) * stepLength;
      const { out } = voices.start(ctx, row, master, time);
      kit.voice(row).play(ctx, withVelocity(ctx, out, velocity / FULL_VELOCITY), time);
    }
  }

  const rendered = await renderWithProgress(ctx, first + frames, sampleRate, { onProgress, signal });
  // Views of the kept window, not copies: a long render is hundreds of megabytes, and a copy of each channel is as
  // much again at the moment the most is held (stereo, or both channels and then the mono mix).
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
    rendered.getChannelData(i).subarray(first, first + frames),
  );
  return { sampleRate: rendered.sampleRate, channels: channelMode === "mono" ? [toMono(channels)] : channels };
}

// The channels as one: at each frame, the mean of them (so identical channels come out unchanged).
export function toMono(channels) {
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (let frame = 0; frame < mono.length; frame++) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame];
    mono[frame] = sum / channels.length;
  }
  return mono;
}

// A 16-bit PCM WAV file: the channels interleaved, each sample clamped to full scale and rounded.
export function encodeWav(channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // the size of this part
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); // bytes a second
  view.setUint16(32, count * 2, true); // bytes a frame
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      offset += 2;
    }
  }
  return bytes;
}

// "pad16-seq-01-100bpm.wav", with "-x4" for four loops and "-mono" for mono when they are asked for, so exports of the same
// sequence made differently do not overwrite each other in the downloads folder.
export function exportName(song, options = DEFAULT_EXPORT_OPTIONS) {
  const { loops, channels } = normalizeExportOptions(options);
  const loopPart = loops > 1 ? `-x${loops}` : "";
  const channelPart = channels === "mono" ? "-mono" : "";
  return `pad16-seq-${pad2(song.current + 1)}-${Math.round(song.bpm)}bpm${loopPart}${channelPart}.wav`;
}

// Is there anything in the sequence showing to export (in the bars it has)?
export const hasSteps = (song, stepsPerBar) => hitsOf(song.sequences[song.current], stepsPerBar).length > 0;

// What the Export button does: checks there is something to export, renders it, and hands the file to `save`
// (shared/download.js). Says how it went on the LCD through `onMessage`. `onProgress(0..1)` is how far the render
// has got, aborting `signal` cancels it (nothing is saved), and `options` ({ loops, channels }, see export-options.js)
// say what the file is. Whether a file was saved.
export async function exportSequence({
  song,
  kit,
  stepsPerBar,
  onMessage,
  save,
  options = DEFAULT_EXPORT_OPTIONS,
  onProgress,
  signal,
  render = renderSequence,
  supported = typeof OfflineAudioContext === "function",
}) {
  if (!supported) {
    onMessage("EXPORT NOT SUPPORTED");
    return false;
  }
  if (!hasSteps(song, stepsPerBar)) {
    onMessage("NOTHING TO EXPORT");
    return false;
  }
  const { loops, channels } = normalizeExportOptions(options);
  onMessage("EXPORTING...");
  try {
    const audio = await render({ song, kit, stepsPerBar, loops, channels, onProgress, signal });
    const name = exportName(song, { loops, channels });
    save(new Blob([encodeWav(audio.channels, audio.sampleRate)], { type: "audio/wav" }), name);
    onMessage(`EXPORTED ${name}`);
    return true;
  } catch (error) {
    if (wasCancelled(error)) {
      onMessage("EXPORT CANCELLED");
      return false;
    }
    console.error("Export failed:", error);
    onMessage("EXPORT FAILED");
    return false;
  }
}

export const READY_WAIT_MS = 5000; // how long a click waits for the saved samples to be back before giving up

// What pressing the Export button does around exportSequence: one export at a time, and a press while one runs cancels
// it (the render stops at its next pause, or where it cannot pause at its end, and nothing is saved; the export is busy until then, and `onCancel()` says it was asked to). `onBusy(true/false)` lets the button show it is
// working (the LCD's message is gone after a moment, and a long export takes longer), and `onProgress(0..1)` how far
// it has got. It waits for `ready` (the saved samples being restored, so the file does not hold the built-in sounds
// where a sample is about to be) and gives up after READY_WAIT_MS with a message rather than leave the button dead: a
// restore that never settles or fails is not something to render over. A cancel during that wait ends it too.
//
//   const press = createExportAction({
//     ready: () => restoring,
//     run: ({ signal, onProgress }) => exportSequence({ ..., signal, onProgress }),
//     onMessage, onBusy, onProgress,
//   });
//   button.addEventListener("click", press);
export function createExportAction({
  ready,
  run,
  onMessage,
  onBusy = () => {},
  onProgress = () => {},
  onCancel = () => {},
  waitMs = READY_WAIT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let controller = null;
  return async function press() {
    if (controller) {
      // pressed again while it works: cancel (a second press while it stops does nothing more). A render that cannot be
      // stopped (see renderWithProgress) goes on to its end first, so `onCancel` lets the button say it is stopping.
      if (!controller.signal.aborted) {
        controller.abort();
        onCancel();
      }
      return false;
    }
    controller = new AbortController();
    const { signal } = controller;
    onBusy(true);
    try {
      let timer;
      const timedOut = new Promise((resolve) => (timer = setTimer(() => resolve("late"), waitMs)));
      const stopped = new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled")));
      const outcome = await Promise.race([Promise.resolve(ready()).then(() => "ready"), timedOut, stopped]);
      clearTimer(timer);
      if (outcome === "late") {
        onMessage("SAMPLES STILL LOADING");
        return false;
      }
      if (outcome === "cancelled") {
        onMessage("EXPORT CANCELLED");
        return false;
      }
      return await run({ signal, onProgress });
    } catch (error) {
      console.error("Export failed:", error);
      onMessage("EXPORT FAILED");
      return false;
    } finally {
      controller = null;
      onBusy(false);
    }
  };
}
