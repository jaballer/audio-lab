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
//   samples.setTrim(3, { start, end }, "end");   // the part of pad 3's sample that plays; kept with the sample
//   await samples.restore();       // at the start of a visit: put back what was kept
//
// The file's original bytes are what is kept, not the decoded audio: they are smaller. They are decoded again
// at the start of each visit, with an offline context, because the real audio context only exists after the
// first click or key and a pad must not play its built-in sound until then. A decoded buffer is not tied to
// the context that made it, so the real one plays it (resampling to its own rate).
// Whatever storage does, the sample plays in this visit: a failed save only means it is gone next time.

import { formatSpace } from "../../shared/storage-budget.js";
import { DEFAULT_SETTINGS, SAMPLE_SETTING_NAMES } from "./pad-settings.js";
import { isFullTrim, parseTrim } from "./trim.js";
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

// A pad's entry in the saved map; the trim is only there when the sample is trimmed.
const entryFor = (name, bytes, trim) => (isFullTrim(trim) ? { name, bytes } : { name, bytes, trim });
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Is this a samples map this page can read? (The same test for a backup of what it cannot.)
export const isSamplesMap = (stored) => isObject(stored) && stored.version === SAMPLES_VERSION && isObject(stored.pads);

// What was stored, as { pad: { name, bytes, trim? } } for the pads that exist; anything unusable is left out.
// `trim` (trim.js) is only there for a sample that has been trimmed.
export function parseSamples(stored, padCount) {
  const pads = {};
  if (!isSamplesMap(stored)) return pads;
  for (const [key, info] of Object.entries(stored.pads)) {
    const pad = Number(key);
    if (!Number.isInteger(pad) || String(pad) !== key || pad < 0 || pad >= padCount) continue;
    // A real entry is a whole number of bytes no bigger than a file may be: anything else (negative, fractional,
    // absurd) cannot be one, and would throw off the count of what is stored.
    if (!isObject(info) || typeof info.name !== "string") continue;
    if (!Number.isInteger(info.bytes) || info.bytes < 0 || info.bytes > MAX_SAMPLE_BYTES) continue;
    pads[pad] = entryFor(info.name, info.bytes, parseTrim(info.trim));
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
  // The sound each pad's saved entry describes. A trim is written only to an entry that is its own sound's: while a
  // new sample is still being saved the pad already plays it, but the entry is still the old sample's.
  const owners = new Map();
  // Order of the requests on each pad. Every load and reset is numbered when it is made (`requested`), and what a
  // pad plays is decided when one INSTALLS (`installed` is the number of the newest to have done so, a reset
  // counting as one): a request that finishes after a newer one has installed gives way to it, but one whose newer
  // rival fails, or is refused, still stands. So two loads on a pad in quick succession end with the newer file if
  // it works and the older one if it does not, and never with neither.
  const requested = new Array(kit.length).fill(0);
  const installed = new Array(kit.length).fill(0);
  let restored = false;
  let persistAsked = false; // the browser is asked once per visit to keep the samples

  // What counts toward the total cap, kept in two parts so it can always be put right: `held` is what each pad
  // has now (a sample that is playing in this visit, or kept from an earlier one, as far as it has been seen), and
  // `reservations` are the loads on a pad that are accepted but have not finished, by request number. A pad counts
  // as the biggest of those, which is more than it will hold once they are done but never less, so loads that
  // overlap cannot together get past the cap. A load that ends any way at all drops its own reservation.
  // Not the same as `pads`, which is what was kept.
  const held = Object.fromEntries(Object.entries(pads).map(([pad, info]) => [pad, info.bytes]));
  const reservations = Array.from({ length: kit.length }, () => new Map());
  const countFor = (pad) => Math.max(held[pad] ?? 0, ...reservations[pad].values());
  const countedTotal = () => Array.from({ length: kit.length }, (_, pad) => countFor(pad)).reduce((a, b) => a + b, 0);
  const bytesElsewhere = (pad) => countedTotal() - countFor(pad);

  // Writes the map, with this pad's entry as this tab has it. The map is read again first and only this pad's entry
  // is changed in it, so a sample another tab kept since this one started is not lost. Whether it was written: the
  // localStorage write can fail (blocked, full) when the files' bytes did not.
  //
  // `sameSampleOnly` is for a change to the sample this tab already has on the pad (a trim): it is only written
  // onto the entry of that same sample. If another tab has since put a different sample on the pad (or taken it off),
  // the entry is theirs and the files' bytes are theirs, so this tab's trim must not be written over it.
  function persist(pad, { sameSampleOnly = false } = {}) {
    const stored = readMap();
    // A map that cannot be read (never saved, blocked, damaged) says nothing about the other pads, so this tab's own
    // are written; reading it as empty would drop them.
    const latest = isSamplesMap(stored) ? parseSamples(stored, kit.length) : { ...pads };
    if (pads[pad]) {
      const there = latest[pad];
      const same = there && there.name === pads[pad].name && there.bytes === pads[pad].bytes;
      if (sameSampleOnly && !same) return false;
      latest[pad] = pads[pad];
    } else {
      delete latest[pad];
    }
    return Boolean(writeMap({ version: SAMPLES_VERSION, pads: latest }));
  }

  // The settings only a sample has (pad-settings.js: pitch and the envelope) go with the sample.
  function resetSampleSettings(pad) {
    for (const name of SAMPLE_SETTING_NAMES) kit.setSetting(pad, name, DEFAULT_SETTINGS[name]);
  }

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
    // check and reserving the file below is awaited, so loads that overlap cannot together get past it.
    const limit = await budget.limit(maxTotalBytes);
    if (bytesElsewhere(pad) + bytes.byteLength > limit) return fail(pad, MEMORY_FULL);

    // From here the file is accepted and counted. It is counted until it ends, whichever way it ends.
    reservations[pad].set(request, bytes.byteLength);
    try {
      const result = await decode(audio.ensure(), bytes);
      if (request < installed[pad]) return false; // a newer one has installed, or a reset has come since: it stands
      if (!result.ok) return fail(pad, result.reason); // the pad is as it was, and an earlier load may still stand

      const name = sampleName(file.name);
      const sound = createSampleSound({ id: keyFor(pad), name, buffer: result.buffer, bytes: bytes.byteLength });
      installed[pad] = request;
      kit.set(pad, sound);
      resetSampleSettings(pad); // pitch and envelope shape a sample, so a new one starts as it is (gain is the pad's)
      touched.add(pad);
      held[pad] = bytes.byteLength;

      const bytesKept = await store.set(keyFor(pad), bytes);
      if (installed[pad] !== request) return true; // it played, but something newer has taken the pad since
      // Made from the sound as it is now: it may have been trimmed while it was being saved.
      pads[pad] = entryFor(name, bytes.byteLength, sound.trim);
      owners.set(pad, sound);
      if (bytesKept && persist(pad)) {
        onMessage(`PAD ${pad2(pad + 1)} LOADED ${formatSpace(countedTotal(), limit)}`);
      } else {
        // Not kept, in the files or in the map, so what was kept before for this pad is not what the pad plays
        // any more, and bytes with no map entry would only take up room.
        delete pads[pad];
        persist(pad);
        store.delete(keyFor(pad));
        onMessage(`PAD ${pad2(pad + 1)} LOADED, NOT SAVED`);
      }
      return true;
    } finally {
      reservations[pad].delete(request);
    }
  }

  async function reset(pad) {
    installed[pad] = ++requested[pad]; // a reset counts as an install: it overtakes every load made before it
    touched.add(pad);
    delete pads[pad];
    delete held[pad];
    owners.delete(pad);
    persist(pad);
    kit.reset(pad);
    resetSampleSettings(pad); // the built-in sound has none of them, so none is left behind to reappear with the next sample
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
        // A missing file leaves the entry alone (storage may only be unavailable for this visit) but it takes no
        // room that can be seen, so it does not count against the cap: the entry's own claim of its size is not
        // to be trusted over the bytes themselves.
        const bytes = await store.get(keyFor(pad));
        // Changed while the file was being read: what was read is the old sample's, and must not be counted again.
        if (touched.has(pad)) return;
        if (!bytes) {
          held[pad] = 0;
          return;
        }
        held[pad] = bytes.byteLength;
        const result = await decode(ctx, bytes);
        if (!result.ok || touched.has(pad)) return;
        const sound = createSampleSound({
          id: keyFor(pad),
          name: info.name,
          buffer: result.buffer,
          bytes: bytes.byteLength,
          trim: info.trim,
        });
        kit.set(pad, sound);
        owners.set(pad, sound);
      }),
    );
  }

  // Sets which part of the pad's sample plays, and keeps it with the sample. `moved` is the handle being dragged
  // (see trim.js). Gives back the trim it became, or null for a pad with no sample to trim. It is written for
  // every change, which is a small JSON; whether it could be kept is not reported, since the trim plays either way.
  function setTrim(pad, trim, moved) {
    const sound = kit.get(pad);
    if (typeof sound.setTrim !== "function") return null;
    const next = sound.setTrim(trim, moved);
    if (pads[pad] && owners.get(pad) === sound) {
      pads[pad] = entryFor(pads[pad].name, pads[pad].bytes, next);
      persist(pad, { sameSampleOnly: true });
    }
    return next;
  }

  // Is there a sample kept for this pad, whether or not it is playing (a restore that failed leaves the entry)?
  const isKept = (pad) => pad in pads;

  return { load, reset, restore, isKept, setTrim };
}
