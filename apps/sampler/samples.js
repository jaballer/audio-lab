// Samples on the pads: loading a file onto a pad, putting the built-in sound back, and keeping the samples
// between visits. No DOM. The kit (kit.js) holds what each pad plays; this decides what goes in it.
//
//   const samples = createSamples({
//     kit, audio,
//     store,                 // shared/blob-store.js: where the files' bytes are kept
//     readMap, writeMap,     // () => stored map | null, and (map) => saved: which pads have a sample, by name
//     onMessage,             // (text) a short note for the LCD
//     restoreContext,        // () => an OfflineAudioContext to decode kept samples with, before any click
//     budget,                // shared/storage-budget.js: { limit(maxBytes), persist() }; optional
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

import { formatSpace } from "../../shared/storage-budget.js";
import { pad2, sampleName } from "./format.js";
import {
  MAX_SAMPLE_BYTES,
  PROBE_REFUSE_SECONDS,
  REASONS,
  createSampleSound,
  decodeSample,
  probeDuration,
} from "./sample-voice.js";

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
  budget = { limit: async (maxBytes) => maxBytes, persist: async () => false },
  decode = decodeSample,
  probe = probeDuration,
  maxTotalBytes = MAX_TOTAL_BYTES,
}) {
  const pads = parseSamples(readMap(), kit.length); // { pad: { name, bytes } }, the samples that are kept
  const touched = new Set(); // pads changed in this visit, which a restore must not overwrite
  // Order of the requests on each pad. Every load and reset is numbered when it is made (`requested`), and the
  // newest one to be accepted is the one that stands (`accepted`): an older request that is accepted after a
  // newer one, or overtaken while it works, gives way to it. A load that is refused is never accepted, so it
  // changes nothing and does not cancel an earlier load that is still working.
  const requested = new Array(kit.length).fill(0);
  const accepted = new Array(kit.length).fill(0);
  let restored = false;
  let persistAsked = false; // the browser is asked once per visit to keep the samples

  // What counts toward the total cap, kept in two parts so it can always be put right: `held` is what each pad
  // has now (a sample that is playing in this visit, or kept from an earlier one), and `reserved` is a load that
  // has been accepted but has not finished, which counts instead of what the pad holds while it works. A load
  // that fails or is overtaken only drops its own reservation, so the count falls back to what the pad holds.
  // Not the same as `pads`, which is what was kept.
  const held = Object.fromEntries(Object.entries(pads).map(([pad, info]) => [pad, info.bytes]));
  const reserved = {};
  const countFor = (pad) => reserved[pad] ?? held[pad] ?? 0;
  const countedTotal = () => Array.from({ length: kit.length }, (_, pad) => countFor(pad)).reduce((a, b) => a + b, 0);
  const bytesElsewhere = (pad) => countedTotal() - countFor(pad);

  // Whether the map was written: the localStorage write can fail (blocked, full) when the files' bytes did not.
  const persist = () => Boolean(writeMap({ version: SAMPLES_VERSION, pads }));

  function fail(pad, reason) {
    onMessage(reason === MEMORY_FULL ? reason : `PAD ${pad2(pad + 1)} ${reason}`);
    return false;
  }

  async function load(pad, file) {
    const request = ++requested[pad];
    if (file.size > MAX_SAMPLE_BYTES) return fail(pad, REASONS.bytes);
    // Asked here, at the start, because this runs in the click or drop the visitor made and nothing has been
    // awaited yet: Firefox only shows its permission prompt for a request made while that action is fresh, and
    // by the time a file is read, decoded and saved it is not. Once per visit, and only for a file worth
    // trying (not one refused above); the answer changes nothing here, so it is not waited for.
    if (!persistAsked) {
      persistAsked = true;
      budget.persist();
    }
    // Its length from the header, so a file that is far too long is refused without being read and decoded. A hint
    // only (see PROBE_REFUSE_SECONDS): null when the browser cannot tell, and decoding makes the exact call.
    const seconds = await probe(file);
    if (seconds > PROBE_REFUSE_SECONDS) return fail(pad, REASONS.seconds);
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return fail(pad, REASONS.notAudio);
    }
    // The most the samples may take: the cap, or less when the browser's quota is small. Nothing between this
    // check and counting the file below is awaited, so loads that overlap cannot together get past it.
    const limit = await budget.limit(maxTotalBytes);
    if (bytesElsewhere(pad) + bytes.byteLength > limit) return fail(pad, MEMORY_FULL);

    // From here the file is accepted: it takes the pad over from an earlier request still in progress, unless
    // a newer one has been accepted already (the quota lookup above can finish out of order). It is counted,
    // so loads that overlap cannot together go over the cap.
    if (request < accepted[pad]) return false;
    const previous = accepted[pad];
    accepted[pad] = request;
    reserved[pad] = bytes.byteLength;
    const result = await decode(audio.ensure(), bytes);
    if (accepted[pad] !== request) return false; // a newer file or a reset has taken the pad, and has its own count
    if (!result.ok) {
      // It did not work out, so it leaves the pad as it found it, and an earlier request still working may stand.
      delete reserved[pad];
      accepted[pad] = previous;
      return fail(pad, result.reason);
    }

    const name = sampleName(file.name);
    kit.set(pad, createSampleSound({ id: keyFor(pad), name, buffer: result.buffer }));
    touched.add(pad);
    held[pad] = bytes.byteLength;
    delete reserved[pad];

    const bytesKept = await store.set(keyFor(pad), bytes);
    if (accepted[pad] !== request) return true; // it played, but something newer has taken the pad since
    pads[pad] = { name, bytes: bytes.byteLength };
    if (bytesKept && persist()) {
      onMessage(`PAD ${pad2(pad + 1)} LOADED ${formatSpace(countedTotal(), limit)}`);
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
    accepted[pad] = ++requested[pad]; // a reset is always accepted: it overtakes any load made before it
    touched.add(pad);
    delete pads[pad];
    delete held[pad];
    delete reserved[pad];
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
    // All the pads at once, so the time before the last one is back is the slowest one's, not the sum.
    await Promise.all(
      Object.entries(pads).map(async ([key, info]) => {
        const pad = Number(key);
        if (touched.has(pad)) return;
        // A missing file leaves the entry alone: storage may only be unavailable for this visit.
        const bytes = await store.get(keyFor(pad));
        if (!bytes) return;
        const result = await decode(ctx, bytes);
        if (!result.ok || touched.has(pad)) return;
        kit.set(pad, createSampleSound({ id: keyFor(pad), name: info.name, buffer: result.buffer }));
      }),
    );
  }

  // Is there a sample kept for this pad, whether or not it is playing (a restore that failed leaves the entry)?
  const isKept = (pad) => pad in pads;

  return { load, reset, restore, isKept };
}
