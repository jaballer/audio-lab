// Exporting a sequence as an audio file: the sequence is played into an offline audio context, as fast as the
// computer can, with the same sounds, velocities, pad settings, retrigger cuts, master volume and clipper as the page
// plays them, and the result is written as a 16-bit WAV. No DOM, and nothing at import time.
//
//   const audio = await renderSequence({ song, kit, stepsPerBar: 16 });   // { sampleRate, channels: [Float32Array, ...] }
//   const bytes = encodeWav(audio.channels, audio.sampleRate);              // an ArrayBuffer: the .wav file
//   exportName(song)                                                        // "pad16-seq-01-100bpm.wav"
//
// `song` is what the sampler saves (controller.getSong()): the sequence exported is the one showing (`current`), and
// the file is exactly the length of its bars, so it loops. To make it loop cleanly the sequence is played twice and
// the second pass is kept: what rings on from the end of the first pass (a crash, a long sample) is in the start of
// the second, as it is when the page loops, and a pad's last hit is cut by its first hit of the next pass. The
// render does not depend on the power switch or on the audio context of the page.

import { createClipper } from "../../shared/audio.js";
import { VOLUME_SCALE } from "./controller.js";
import { FULL_VELOCITY } from "../../shared/pattern.js";
import { withVelocity } from "../../shared/sounds.js";
import { stepSeconds } from "../../shared/tempo.js";
import { pad2 } from "./format.js";
import { createVoices } from "./voices.js";

export const EXPORT_SAMPLE_RATE = 44100;
// The first step is not at time 0: a trimmed sample starts at least a few milliseconds into the context's time (see
// sample-voice.js), so every step is moved on by this much, which keeps every hit where it belongs.
export const LEAD_SECONDS = 0.01;

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
}) {
  const sequence = song.sequences[song.current];
  const hits = hitsOf(sequence, stepsPerBar);
  const length = sequence.bars * stepsPerBar; // steps in one pass
  const stepLength = stepSeconds(song.bpm);
  // The second pass is the file: from the end of the first (and the lead) for the length of one pass.
  const first = Math.round((LEAD_SECONDS + length * stepLength) * sampleRate);
  const frames = Math.round(length * stepLength * sampleRate);
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

  const voices = createVoices(kit.length, { cleanUp: false, groupOf: (pad) => kit.settings(pad).choke });
  for (const pass of [0, 1]) {
    for (const { step, row, velocity } of hits) {
      const time = LEAD_SECONDS + (pass * length + step) * stepLength;
      const { out } = voices.start(ctx, row, master, time);
      kit.voice(row).play(ctx, withVelocity(ctx, out, velocity / FULL_VELOCITY), time);
    }
  }

  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
    rendered.getChannelData(i).slice(first, first + frames),
  );
  return { sampleRate: rendered.sampleRate, channels };
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

export const exportName = (song) => `pad16-seq-${pad2(song.current + 1)}-${Math.round(song.bpm)}bpm.wav`;

// Is there anything in the sequence showing to export (in the bars it has)?
export const hasSteps = (song, stepsPerBar) => hitsOf(song.sequences[song.current], stepsPerBar).length > 0;

// What the Export button does: checks there is something to export, renders it, and hands the file to `save`
// (shared/download.js). Says how it went on the LCD through `onMessage`. Whether a file was saved.
export async function exportSequence({
  song,
  kit,
  stepsPerBar,
  onMessage,
  save,
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
  onMessage("EXPORTING...");
  try {
    const audio = await render({ song, kit, stepsPerBar });
    const name = exportName(song);
    save(new Blob([encodeWav(audio.channels, audio.sampleRate)], { type: "audio/wav" }), name);
    onMessage(`EXPORTED ${name}`);
    return true;
  } catch (error) {
    console.error("Export failed:", error);
    onMessage("EXPORT FAILED");
    return false;
  }
}

export const READY_WAIT_MS = 5000; // how long a click waits for the saved samples to be back before giving up

// What pressing the Export button does around exportSequence: one export at a time (a press while one runs says so,
// instead of being dropped), `onBusy(true/false)` so the button can show it is working (the LCD's message is gone
// after a moment, and a long export takes longer), and a wait for `ready` (the saved samples being restored, so the
// file does not hold the built-in sounds where a sample is about to be) that gives up after READY_WAIT_MS with a
// message rather than leave the button dead: a restore that never settles or fails is not something to render over.
//
//   const press = createExportAction({ ready: () => restoring, run: () => exportSequence({ ... }), onMessage, onBusy });
//   button.addEventListener("click", press);
export function createExportAction({
  ready,
  run,
  onMessage,
  onBusy = () => {},
  waitMs = READY_WAIT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let busy = false;
  return async function press() {
    if (busy) {
      onMessage("ALREADY EXPORTING");
      return false;
    }
    busy = true;
    onBusy(true);
    try {
      let timer;
      const timedOut = new Promise((resolve) => (timer = setTimer(() => resolve("late"), waitMs)));
      const outcome = await Promise.race([Promise.resolve(ready()).then(() => "ready"), timedOut]);
      clearTimer(timer);
      if (outcome === "late") {
        onMessage("SAMPLES STILL LOADING");
        return false;
      }
      return await run();
    } catch (error) {
      console.error("Export failed:", error);
      onMessage("EXPORT FAILED");
      return false;
    } finally {
      busy = false;
      onBusy(false);
    }
  };
}
