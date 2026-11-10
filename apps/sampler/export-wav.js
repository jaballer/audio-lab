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
// has got and can be cancelled (see WINDOW_SECONDS).
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

// The rate an export is made at when the page has no audio running to take it from.
export const EXPORT_SAMPLE_RATE = 44100;
// The rates an export follows the page to: a loaded sample is a buffer at its own rate, and the browser resamples it into
// a context at another one with a quick, rough resampler (about 5 dB down at 20 kHz from 48 down to 44.1 kHz, and aliasing),
// so a file at the rate the page plays at has what the page plays. A higher rate than 96 kHz only makes the file and the
// memory it takes larger; a lower one than 22.05 kHz is not an audio rate anyone means.
export const MIN_EXPORT_SAMPLE_RATE = 22050;
export const MAX_EXPORT_SAMPLE_RATE = 96000;

// The rate to export at, given the one the page's audio context runs at (undefined before it exists, or not a number).
export function exportSampleRate(contextRate) {
  const rate = typeof contextRate === "number" ? Math.round(contextRate) : NaN;
  return rate >= MIN_EXPORT_SAMPLE_RATE && rate <= MAX_EXPORT_SAMPLE_RATE ? rate : EXPORT_SAMPLE_RATE;
}
// The first step is not at time 0: a trimmed sample starts at least a few milliseconds into the context's time (see
// sample-voice.js), so every step is moved on by this much, which keeps every hit where it belongs.
export const LEAD_SECONDS = 0.01;
// How many passes may come before the one that is kept, at most: a 5 s release in a 1 s loop needs six; a longer one is
// cut short rather than render for ever (the oldest, quietest tails are left out).
export const MAX_WARM_UP_PASSES = 12;
// The render is scheduled this much audio at a time. Every node that is waiting for its start time is looked at by the
// audio thread in every block until it has started, so what costs is the nodes waiting times the length they wait: with
// the whole sequence scheduled before it begins, the work grows with the square of the length (a dense render of 18
// seconds took 24 and one of twice that took four times as long). Scheduled a window or two ahead, what waits is bounded.
// The render pauses at the end of each window to schedule the next, which also gives a progress report and a place to
// stop at, a window of audio apart.
export const WINDOW_SECONDS = 1;
// The audio engine moves in blocks of this many frames, and a pause lands on one of their edges.
const RENDER_QUANTUM = 128;

// The frames to pause at: one at the end of each window, as a whole number of blocks, none at the very start or end and
// none twice (two pauses in one block are an error).
export function windowPauses(total, sampleRate, windowSeconds = WINDOW_SECONDS) {
  const frames = new Set();
  for (let window = 1; window * windowSeconds * sampleRate < total; window++) {
    const frame = Math.round((window * windowSeconds * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM;
    if (frame > 0 && frame < total) frames.add(frame);
  }
  return [...frames];
}

const cancelled = () => new DOMException("Export cancelled", "AbortError");
export const wasCancelled = (error) => error?.name === "AbortError";

// Renders `ctx` (an OfflineAudioContext of `plan.total` frames) a window at a time: `schedule(until)` starts every hit that
// sounds before `until` seconds, once before it begins (two windows) and again at the end of each window, always two
// windows ahead of where the render is (so no hit is started closer than about a window, to the nearest block, to the moment
// it sounds, where a sample's start would be moved on by the clock). Reports `onProgress(0..1)` at each pause. After `signal`
// aborts it ends with an AbortError at its next pause, a window of audio on at most; then `abandon()` lets go of the
// render, and what is left of it runs out unheard in the background (a few tens of milliseconds, measured, for a render of
// three minutes), so another export may begin while it does. Where it cannot pause (Firefox has no
// OfflineAudioContext.suspend: there everything is scheduled before it starts, and it renders in one go) it ends at the end
// of the render, so that an export is not over, and another does not start beside it, while the first still renders.
// `abandon()` also lets go of a render that failed: a render must not be left paused for good, which a browser never frees.
async function renderInWindows(ctx, plan, { windowSeconds, schedule, abandon, onProgress, signal }) {
  if (signal?.aborted) throw cancelled();
  // A pause that cannot be set, or reached, or resumed, would leave the rest of the sequence unscheduled (silence in the
  // file) or the render waiting for ever, so any of them fails the render with its error.
  let broken = false;
  let rejectFailed;
  const failed = new Promise((_, reject) => (rejectFailed = reject));
  const fail = (error) => {
    broken = true; // the pauses that are still to come only resume: nothing more is scheduled for a render that is lost
    rejectFailed(error);
  };
  const report = (fraction) => {
    try {
      onProgress?.(fraction);
    } catch (error) {
      console.error("Export progress failed:", error); // only for the eye: the render goes on
    }
  };
  const ahead = (seconds) => seconds + 2 * windowSeconds;
  if (typeof ctx.suspend === "function") {
    schedule(ahead(0));
    for (const frame of windowPauses(plan.total, plan.sampleRate, windowSeconds)) {
      // A quarter of a block early: the time is rounded to a block edge, up or to the nearest, and this lands on it either way.
      ctx
        .suspend((frame - RENDER_QUANTUM / 4) / plan.sampleRate)
        .then(() => {
          if (broken) return ctx.resume();
          if (signal?.aborted) {
            fail(cancelled());
            return ctx.resume(); // nothing more is scheduled, and the end of the render is silent and quick
          }
          schedule(ahead(frame / plan.sampleRate));
          const resumed = ctx.resume(); // before the report: nothing in it may keep the render waiting
          report(frame / plan.total);
          return resumed;
        })
        .catch(fail);
    }
  } else {
    schedule(Infinity);
  }
  let rendered;
  try {
    rendered = await Promise.race([ctx.startRendering(), failed]);
  } catch (error) {
    abandon();
    throw error;
  }
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

// What a render is made of, worked out before any audio is made (so it can be tested without a context): the hits, how
// many passes there are and where the kept window sits in them. The last `copies` passes are the file; the passes
// before it are warm-up: a voice rings on after it is cut, for the pad's Release, and a Release longer than the loop
// leaves tails from several passes back in the loop's steady state, so there are enough passes before the file to
// cover the longest (one, with no release).
export function planRender({
  song,
  kit,
  stepsPerBar,
  sampleRate = EXPORT_SAMPLE_RATE,
  loops = DEFAULT_EXPORT_OPTIONS.loops,
}) {
  const copies = Math.max(1, Math.floor(loops) || 1);
  const sequence = song.sequences[song.current];
  const hits = hitsOf(sequence, stepsPerBar);
  const length = sequence.bars * stepsPerBar; // steps in one pass
  const stepLength = stepSeconds(song.bpm);
  const loopSeconds = length * stepLength;
  const longestRelease = Math.max(0, ...hits.map(({ row }) => kit.envelope(row)?.release ?? 0));
  const warmUp = Math.min(MAX_WARM_UP_PASSES, 1 + Math.ceil(longestRelease / loopSeconds));
  const first = Math.round((LEAD_SECONDS + warmUp * loopSeconds) * sampleRate);
  const frames = exportFrames(song, stepsPerBar, copies, sampleRate);
  return {
    hits,
    copies,
    length,
    stepLength,
    warmUp,
    passes: warmUp + copies,
    first,
    frames,
    total: first + frames,
    sampleRate,
  };
}

// The render's output chain: the master gain at the page's volume, into the clipper, into the speakers.
function connectOutput(ctx, volume) {
  const master = ctx.createGain();
  master.gain.value = volume / VOLUME_SCALE;
  const clipper = createClipper(ctx);
  if (clipper) {
    master.connect(clipper.input);
    clipper.output.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return master;
}

// The hits that have yet to start, in the order they sound: `take(until)` gives those that sound before `until` seconds
// (the last of the first pass is followed by the first of the second, and so on through the warm-up and the loops).
function createHitFeeder(plan) {
  let pass = 0;
  let index = 0;
  return function take(until) {
    const taken = [];
    while (pass < plan.passes && index < plan.hits.length) {
      const hit = plan.hits[index];
      const time = LEAD_SECONDS + (pass * plan.length + hit.step) * plan.stepLength;
      if (time >= until) break;
      taken.push({ row: hit.row, velocity: hit.velocity, time });
      if (++index === plan.hits.length) {
        index = 0;
        pass++;
      }
    }
    return taken;
  };
}

// Starts one hit through the voices, so that it cuts the pad's earlier one and the pads of its choke group, as it does on
// the page; a sound that gives back a way to stop its source has it stopped when the hit is cut.
function startHit(ctx, { voices, kit, master }, { row, velocity, time }) {
  const started = voices.start(ctx, row, master, time);
  const played = kit.voice(row).play(ctx, withVelocity(ctx, started.out, velocity / FULL_VELOCITY), time);
  started.stopWith(played?.stop);
}

// The file out of the render: the kept window, as views of the render and not copies (a long render is hundreds of
// megabytes, and a copy of each channel is as much again at the moment the most is held: stereo, or both channels and
// then the mono mix), mixed down to one channel if asked.
function keptWindow(rendered, plan, channelMode) {
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
    rendered.getChannelData(i).subarray(plan.first, plan.first + plan.frames),
  );
  return { sampleRate: rendered.sampleRate, channels: channelMode === "mono" ? [toMono(channels)] : channels };
}

export async function renderSequence({
  song,
  kit,
  stepsPerBar,
  sampleRate = EXPORT_SAMPLE_RATE,
  createContext = (length, rate) => new OfflineAudioContext(2, length, rate),
  loops = DEFAULT_EXPORT_OPTIONS.loops,
  channels = DEFAULT_EXPORT_OPTIONS.channels,
  windowSeconds = WINDOW_SECONDS,
  onProgress,
  signal,
}) {
  const plan = planRender({ song, kit, stepsPerBar, sampleRate, loops });
  const ctx = createContext(plan.total, sampleRate);
  const master = connectOutput(ctx, song.volume);
  const voices = createVoices(kit.length, {
    cleanUp: false,
    stopCut: true,
    groupOf: (pad) => kit.settings(pad).choke,
    releaseOf: (pad) => kit.envelope(pad)?.release ?? 0,
  });
  const take = createHitFeeder(plan);
  const schedule = (until) => {
    for (const hit of take(until)) startHit(ctx, { voices, kit, master }, hit);
  };
  // A render that will not be used is let go of: nothing it still has to play is heard, and it runs on to its end quickly.
  // Left suspended it is never freed (Chromium keeps the whole graph and the output buffer): a cancel cost about 90 MB.
  const abandon = () => {
    try {
      master.disconnect();
    } catch {
      /* already gone */
    }
    Promise.resolve(ctx.resume?.()).catch(() => {});
  };

  const rendered = await renderInWindows(ctx, plan, { windowSeconds, schedule, abandon, onProgress, signal });
  return keptWindow(rendered, plan, channels);
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

// The bars of the sequence showing that have no steps, counting from 1: a file is as long as all its bars, so a bar with
// nothing in it is a stretch of silence in the file (apart from what is still ringing from the bar before).
export function emptyBars(song, stepsPerBar) {
  const sequence = song.sequences[song.current];
  const filled = new Set(hitsOf(sequence, stepsPerBar).map(({ step }) => Math.floor(step / stepsPerBar)));
  return Array.from({ length: sequence.bars }, (_, bar) => bar)
    .filter((bar) => !filled.has(bar))
    .map((bar) => bar + 1);
}

// Can this browser render audio to a file at all? Firefox, Chrome and current Safari can; the dialog asks before it offers
// an export, and exportSequence asks again before it starts one.
export const canRenderOffline = () => typeof OfflineAudioContext === "function";

// Is there anything in the sequence showing to export (in the bars it has)?
export const hasSteps = (song, stepsPerBar) => hitsOf(song.sequences[song.current], stepsPerBar).length > 0;

// What the Export button does: checks there is something to export, renders it, and hands the file to `save`
// (shared/download.js). Says how it went on the LCD through `onMessage`. `onProgress(0..1)` is how far the render
// has got, aborting `signal` cancels it (nothing is saved), and `options` ({ loops, channels }, see export-options.js)
// say what the file is. `sampleRate` is the rate it is made at (`exportSampleRate`). Whether a file was saved.
export async function exportSequence({
  song,
  kit,
  stepsPerBar,
  onMessage,
  save,
  options = DEFAULT_EXPORT_OPTIONS,
  sampleRate = EXPORT_SAMPLE_RATE,
  onProgress,
  signal,
  render = renderSequence,
  supported = canRenderOffline(),
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
    const audio = await render({ song, kit, stepsPerBar, sampleRate, loops, channels, onProgress, signal });
    const name = exportName(song, { loops, channels });
    const wav = encodeWav(audio.channels, audio.sampleRate);
    // Encoding is one long task (seconds, for a long file), in which a press on Cancel cannot be handled; it waits its
    // turn at the end of it. So give the event loop one before the file is saved, and honour what it brings.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw cancelled();
    save(new Blob([wav], { type: "audio/wav" }), name);
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
//     snapshot: () => ({ song: getSong(), options }),     // taken as it is pressed, and handed to `run`
//     ready: () => restoring,
//     run: ({ signal, onProgress, snapshot }) => exportSequence({ song: snapshot.song, ..., signal, onProgress }),
//     onMessage, onBusy, onProgress,
//   });
//   button.addEventListener("click", press);
export function createExportAction({
  snapshot = () => undefined,
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
      // pressed again while it works: cancel (a second press while it stops does nothing more). The render stops at its next
      // pause, a window of audio on; one that cannot be stopped (see renderInWindows) goes on to its end first, so
      // `onCancel` lets the button say it is stopping.
      if (!controller.signal.aborted) {
        controller.abort();
        onCancel();
      }
      return false;
    }
    controller = new AbortController();
    const { signal } = controller;
    let timer;
    try {
      // What is being exported is what there was when it was pressed: the wait for the samples can be long, and the song
      // can move in it (a tempo knob on a controller), so it is not read again after. All of this is inside the try, so
      // that a callback that throws cannot leave `controller` set with nothing running (every press would then only
      // "cancel" an export that never started).
      const taken = snapshot();
      onBusy(true);
      const timedOut = new Promise((resolve) => (timer = setTimer(() => resolve("late"), waitMs)));
      const stopped = new Promise((resolve) => signal.addEventListener("abort", () => resolve("cancelled")));
      // `new Promise` so that a `ready` that throws is a failed restore too, and not an export that failed.
      const restored = new Promise((resolve) => resolve(ready())).then(
        () => "ready",
        (error) => {
          console.error("Saved samples did not come back:", error);
          return "failed";
        },
      );
      const outcome = await Promise.race([restored, timedOut, stopped]);
      clearTimer(timer);
      if (outcome === "late") {
        onMessage("SAMPLES STILL LOADING");
        return false;
      }
      if (outcome === "failed") {
        onMessage("SAMPLES FAILED TO LOAD");
        return false;
      }
      if (outcome === "cancelled") {
        onMessage("EXPORT CANCELLED");
        return false;
      }
      return await run({ signal, onProgress, snapshot: taken });
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
