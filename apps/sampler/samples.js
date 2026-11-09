// Samples on the pads: loading a file onto a pad, putting the built-in sound back, and keeping the samples
// between visits. No DOM. The kit (kit.js) holds what each pad plays; this decides what goes in it.
//
//   const samples = createSamples({
//     kit, audio,
//     store,                 // shared/blob-store.js: where the files' bytes are kept
//     readMap, writeMap,     // () => stored map | null, and (map) => saved: which pads have a sample, by name
//     onMessage,             // (text) a short note for the LCD
//     restoreContext,        // () => an OfflineAudioContext to decode kept samples with, before any click
//   });
//   await samples.load(3, file);   // true when pad 3 plays the file now
//   await samples.reset(3);        // the built-in sound again
//   await samples.restore();       // at the start of a visit: put back what was kept
//
// The file's original bytes are what is kept, not the decoded audio: they are smaller. They are decoded again
// at the start of each visit, with an offline context, because the real audio context only exists after the
// first click or key and a pad must not play its built-in sound until then. A decoded buffer is not tied to
// the context that made it, so the real one plays it (resampling to its own rate).
// Whatever storage does, the sample plays in this visit: a failed save only means it is gone next time.

import { pad2, sampleName } from "./format.js";
import { MAX_SAMPLE_BYTES, REASONS, createSampleSound, decodeSample } from "./sample-voice.js";

export const SAMPLES_KEY = "pad-sampler:samples";
export const SAMPLES_VERSION = 1;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // across all the pads, so a full kit stays reasonable
export const MEMORY_FULL = "SAMPLE MEMORY FULL";

const keyFor = (pad) => `sample-${pad}`;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored, as { pad: { name, bytes } } for the pads that exist; anything unusable is left out.
export function parseSamples(stored, padCount) {
  const pads = {};
  if (!isObject(stored) || stored.version !== SAMPLES_VERSION || !isObject(stored.pads)) return pads;
  for (const [key, info] of Object.entries(stored.pads)) {
    const pad = Number(key);
    if (!Number.isInteger(pad) || String(pad) !== key || pad < 0 || pad >= padCount) continue;
    if (!isObject(info) || typeof info.name !== "string" || !Number.isFinite(info.bytes) || info.bytes < 0) continue;
    pads[pad] = { name: info.name, bytes: info.bytes };
  }
  return pads;
}

export function createSamples({
  kit,
  audio,
  store,
  readMap,
  writeMap,
  onMessage = () => {},
  restoreContext = () => audio.ensure(),
  decode = decodeSample,
  maxTotalBytes = MAX_TOTAL_BYTES,
}) {
  const pads = parseSamples(readMap(), kit.length); // { pad: { name, bytes } }, the samples that are kept
  const touched = new Set(); // pads changed in this visit, which a restore must not overwrite
  const latest = new Array(kit.length).fill(0); // a later load or reset of the same pad wins over an earlier one
  let restored = false;

  // What counts toward the total cap: every pad that has a sample, kept or only playing in this visit, and
  // a load that has been accepted but not finished. Not the same as `pads`, which is what was kept.
  const counted = Object.fromEntries(Object.entries(pads).map(([pad, info]) => [pad, info.bytes]));
  const bytesElsewhere = (pad) =>
    Object.entries(counted).reduce((sum, [key, bytes]) => (Number(key) === pad ? sum : sum + bytes), 0);

  // Whether the map was written: the localStorage write can fail (blocked, full) when the files' bytes did not.
  const persist = () => Boolean(writeMap({ version: SAMPLES_VERSION, pads }));

  function fail(pad, reason) {
    onMessage(reason === MEMORY_FULL ? reason : `PAD ${pad2(pad + 1)} ${reason}`);
    return false;
  }

  async function load(pad, file) {
    const ticket = ++latest[pad];
    if (file.size > MAX_SAMPLE_BYTES) return fail(pad, REASONS.bytes);
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return fail(pad, REASONS.notAudio);
    }
    if (bytesElsewhere(pad) + bytes.byteLength > maxTotalBytes) return fail(pad, MEMORY_FULL);

    // Counted from here, so loads that overlap cannot together go over the cap.
    const before = counted[pad];
    counted[pad] = bytes.byteLength;
    const result = await decode(audio.ensure(), bytes);
    if (ticket !== latest[pad]) return false; // another file or a reset came after this one, and has its own count
    if (!result.ok) {
      if (before === undefined) delete counted[pad];
      else counted[pad] = before;
      return fail(pad, result.reason);
    }

    const name = sampleName(file.name);
    kit.set(pad, createSampleSound({ id: keyFor(pad), name, buffer: result.buffer }));
    touched.add(pad);

    const bytesKept = await store.set(keyFor(pad), bytes);
    if (ticket !== latest[pad]) return true; // it played, but something newer has taken the pad since
    pads[pad] = { name, bytes: bytes.byteLength };
    if (bytesKept && persist()) {
      onMessage(`PAD ${pad2(pad + 1)} SAMPLE LOADED`);
    } else {
      // Not kept, in the files or in the map, so what was kept before for this pad is not what the pad plays
      // any more, and bytes with no map entry would only take up room.
      delete pads[pad];
      persist();
      store.delete(keyFor(pad));
      onMessage(`PAD ${pad2(pad + 1)} LOADED, NOT SAVED`);
    }
    return true;
  }

  async function reset(pad) {
    latest[pad]++;
    touched.add(pad);
    delete pads[pad];
    delete counted[pad];
    persist();
    kit.reset(pad);
    await store.delete(keyFor(pad));
    onMessage(`PAD ${pad2(pad + 1)} DEFAULT SOUND`);
  }

  // Only once: it is for the start of a visit. Without a way to decode before the audio context exists, call it
  // once the context is running instead.
  async function restore() {
    if (restored) return;
    restored = true;
    const ctx = restoreContext();
    if (!ctx) return;
    for (const [key, info] of Object.entries(pads)) {
      const pad = Number(key);
      if (touched.has(pad)) continue;
      // A missing file leaves the entry alone: storage may only be unavailable for this visit.
      const bytes = await store.get(keyFor(pad));
      if (!bytes) continue;
      const result = await decode(ctx, bytes);
      if (!result.ok || touched.has(pad)) continue;
      kit.set(pad, createSampleSound({ id: keyFor(pad), name: info.name, buffer: result.buffer }));
    }
  }

  // Is there a sample kept for this pad, whether or not it is playing (a restore that failed leaves the entry)?
  const isKept = (pad) => pad in pads;

  return { load, reset, restore, isKept };
}
