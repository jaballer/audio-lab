// A project file: the whole beat and its samples in one file the person keeps, so that clearing the browser's cookies
// and site data does not take them. A zip (zip.js) named `.audiolab` with `project.json` (the song, and which pad has
// which sample) and the samples' original bytes as `samples/pad-NN.bin`. No DOM, and nothing at import time: the page
// passes in what to read and where to write, so it can be tested.
//
//   const blob = projectBlob({ song, samples: [{ pad, name, trim, bytes }] });      // song as sampler.getSong() gives it
//   const result = parseProject(await file.arrayBuffer(), { rows, steps, maxBars, sequenceCount });
//   // { ok: true, song, samples: [{ pad, name, trim, bytes }] }  or  { ok: false, reason, detail }
//   const { samples, missing } = await collectSamples({ map: loadJson(SAMPLES_KEY), store, padCount });   // what the page has kept, to save
//   projectFileName(new Date());   // "pad16-beat-2026-11-09.audiolab"
//   await installProject(result, { store, writeMap, writeSong, padCount });   // true when it is all kept
//
// What is read is checked as much as what the page itself keeps: the song goes through `parseSong` and is written again
// by `serializeSong` (so nothing in it that the page does not know is kept), and the samples through `parseSamples`.
// A file that is damaged, or that has a sample with the wrong size, is refused as a whole and not half-opened.
// The project's own `version` is for the file's layout; the song inside carries its own, and is upgraded as any saved
// song is. A project from a newer page is refused, as a newer song is.

import { MAX_SAMPLE_BYTES } from "./sample-voice.js";
import { MAX_TOTAL_BYTES, SAMPLES_VERSION, parseSamples, sampleKey } from "./samples.js";
import { pad2 } from "./format.js";
import { parseSong, serializeSong } from "./song.js";
import { isFullTrim } from "./trim.js";
import { readZip, zipParts } from "./zip.js";

export const PROJECT_FORMAT = "audio-lab-project";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".audiolab";
export const PROJECT_FILE = "project.json";

// The most a project file may be: all the samples that may be kept at once, and a little for the song and the zip's headers.
export const MAX_PROJECT_BYTES = MAX_TOTAL_BYTES + 1024 * 1024;

// What the LCD can say about a file that was not opened.
export const REASONS = {
  notProject: "NOT A PROJECT FILE",
  newer: "PROJECT IS FROM A NEWER PAGE",
  damaged: "PROJECT FILE DAMAGED",
  tooBig: "PROJECT TOO LARGE",
};

// Named after the pad as the page shows it (PAD 03 is `pad-03`), whatever format the bytes are in: the page decodes
// them by what they are, not by their name.
const sampleFile = (pad) => `samples/pad-${pad2(pad + 1)}.bin`;

const refuse = (reason, detail = reason) => ({ ok: false, reason, detail });
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// The files of a project: `song` is what `sampler.getSong()` gives and `samples` is a list of { pad, name, trim, bytes }
// (`bytes` an ArrayBuffer or typed array) for the pads that have one. `savedAt` is a Date, kept only to say when.
export function buildProject({ song, samples, savedAt = new Date() }) {
  const entries = {};
  const files = [];
  for (const { pad, name, trim, bytes } of samples) {
    entries[pad] = { name, bytes: bytes.byteLength };
    if (trim && !isFullTrim(trim)) entries[pad].trim = trim;
    files.push({ name: sampleFile(pad), data: bytes });
  }
  const manifest = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    song: serializeSong(song),
    samples: entries,
  };
  return [{ name: PROJECT_FILE, data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...files];
}

// Not `application/zip`: a browser can add `.zip` to the name of a file it believes is one.
export const projectBlob = (project, date) =>
  new Blob(zipParts(buildProject(project), date), { type: "application/octet-stream" });

export function parseProject(input, { rows, steps, maxBars, sequenceCount }) {
  if (input.byteLength > MAX_PROJECT_BYTES) return refuse(REASONS.tooBig);
  let files;
  try {
    files = readZip(input);
  } catch (error) {
    return refuse(REASONS.notProject, error.message);
  }
  const byName = new Map(files.map(({ name, data }) => [name, data]));
  const manifestBytes = byName.get(PROJECT_FILE);
  if (!manifestBytes) return refuse(REASONS.notProject, `This zip has no ${PROJECT_FILE}.`);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return refuse(REASONS.damaged, `${PROJECT_FILE} is not JSON.`);
  }
  if (!isObject(manifest) || manifest.format !== PROJECT_FORMAT)
    return refuse(REASONS.notProject, "Not an Audio Lab project.");
  if (!Number.isInteger(manifest.version) || manifest.version < 1)
    return refuse(REASONS.damaged, "The project has no usable version.");
  if (manifest.version > PROJECT_VERSION)
    return refuse(REASONS.newer, `Project version ${manifest.version} is newer than this page reads.`);

  const song = parseSong(manifest.song, { rows, steps, maxBars, sequenceCount });
  if (!song) return refuse(REASONS.damaged, "The beat in the project cannot be read.");

  if (!isObject(manifest.samples)) return refuse(REASONS.damaged, "The project's samples are not listed.");
  const kept = parseSamples({ version: SAMPLES_VERSION, pads: manifest.samples }, rows);
  // An entry the page cannot use (a pad it does not have, a size it would not accept) is a sample lost, not skipped.
  if (Object.keys(kept).length !== Object.keys(manifest.samples).length)
    return refuse(REASONS.damaged, "A sample in the project is not usable.");

  const samples = [];
  let total = 0;
  for (const [key, info] of Object.entries(kept)) {
    const pad = Number(key);
    const data = byName.get(sampleFile(pad));
    if (!data) return refuse(REASONS.damaged, `The file for pad ${pad2(pad + 1)} is missing.`);
    if (data.byteLength !== info.bytes || data.byteLength > MAX_SAMPLE_BYTES)
      return refuse(REASONS.damaged, `The file for pad ${pad2(pad + 1)} is not the size the project says.`);
    total += data.byteLength;
    // `data` was cut out of the archive on its own, so its buffer is exactly the file.
    samples.push({ pad, name: info.name, trim: info.trim, bytes: data.buffer });
  }
  if (total > MAX_TOTAL_BYTES) return refuse(REASONS.tooBig, "The samples are more than the page keeps.");
  return { ok: true, song: serializeSong(song), samples };
}

// What the page keeps, as the list `projectBlob` takes: each pad in the saved map with its bytes read from `store`.
// `missing` lists the pads the map has but whose bytes are not there (storage the browser has cleared in part), which a
// project cannot hold. Reading goes by the map, so a pad's entry and its bytes agree on the size or it is `missing` too.
export async function collectSamples({ map, store, padCount }) {
  const kept = parseSamples(map, padCount);
  const samples = [];
  const missing = [];
  for (const [key, info] of Object.entries(kept)) {
    const pad = Number(key);
    const bytes = await store.get(sampleKey(pad));
    if (!bytes || bytes.byteLength !== info.bytes) missing.push(pad);
    else samples.push({ pad, name: info.name, trim: info.trim, bytes });
  }
  return { samples, missing };
}

// The name a saved project gets, with the local date so that projects saved on different days sort apart.
export function projectFileName(date) {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0"));
  return `pad16-beat-${day[0]}-${day[1]}-${day[2]}${PROJECT_EXTENSION}`;
}

// The first sample in a parsed project that this browser cannot decode, as { pad, reason }, or null. A file can pass every
// check on bytes and the zip's CRC and still hold audio this browser does not read (a codec the one that saved it had),
// and a pad that cannot be decoded plays its built-in sound after the page starts again, so Open asks before anything is
// replaced. `decode(bytes)` gives { ok, reason } as `decodeSample` does.
export async function undecodableSample(project, decode) {
  for (const { pad, bytes } of project.samples) {
    let result;
    try {
      result = await decode(bytes);
    } catch {
      result = { ok: false, reason: "NOT AUDIO" };
    }
    if (!result.ok) return { pad, reason: result.reason };
  }
  return null;
}

// The pads that would not come back as they sound in this tab: one that plays a sample the file does not hold, or holds
// differently (another tab put a different one in storage, a trim could not be kept), and the pads whose bytes were
// `missing` from storage. `playing` is [{ pad, name, bytes (a size), trim }] for the pads on a sample, `samples` is what
// `collectSamples` gave. Sorted, one of each.
export function padsNotSaved({ playing, samples, missing }) {
  const lost = new Set(missing);
  const sameTrim = (a, b) => (a?.start ?? 0) === (b?.start ?? 0) && (a?.end ?? 1) === (b?.end ?? 1);
  for (const one of playing) {
    const saved = samples.find((sample) => sample.pad === one.pad);
    const same =
      saved && saved.name === one.name && saved.bytes.byteLength === one.bytes && sameTrim(saved.trim, one.trim);
    if (!same) lost.add(one.pad);
  }
  return [...lost].sort((a, b) => a - b);
}

// Puts a parsed project where the page keeps its own: each pad's bytes in `store`, the map of which pad has which with
// `writeMap` (`readMap` gives what is there now), and the song with `writeSong` (the page then starts again, and reads
// them as it does on any visit). A browser's quota can be too small for the old samples and the new ones together, so
// the pads the project does not use are emptied first; every pad's old bytes are read before anything is changed, so
// that a failed write, map or song puts all of it back and gives false: the page is as it was, not half a project. Putting
// back frees what this call wrote before it returns the old bytes, so that they have the room they had.
export async function installProject(project, { store, readMap, writeMap, writeSong, padCount }) {
  const oldMap = readMap();
  const old = new Map(); // pad -> the bytes it had (null for none)
  const mapped = parseSamples(oldMap, padCount);
  for (let pad = 0; pad < padCount; pad++) {
    let bytes = await store.get(sampleKey(pad));
    // The store gives null both for no record and for a read that failed. A pad the map lists is read a second time, so
    // a read that failed once is not taken for no sample (which would leave nothing to put back).
    if (!bytes && pad in mapped) bytes = await store.get(sampleKey(pad));
    old.set(pad, bytes);
  }
  const used = new Set(project.samples.map(({ pad }) => pad));
  const written = [];

  const rollBack = async () => {
    for (const pad of written) await store.delete(sampleKey(pad));
    for (const [pad, bytes] of old) {
      if (bytes) await store.set(sampleKey(pad), bytes);
      else if (used.has(pad)) await store.delete(sampleKey(pad));
    }
  };

  for (const [pad, bytes] of old) if (bytes && !used.has(pad)) await store.delete(sampleKey(pad));
  const pads = {};
  for (const sample of project.samples) {
    if (!(await store.set(sampleKey(sample.pad), sample.bytes))) {
      await rollBack();
      return false;
    }
    written.push(sample.pad);
    pads[sample.pad] = { name: sample.name, bytes: sample.bytes.byteLength };
    if (sample.trim && !isFullTrim(sample.trim)) pads[sample.pad].trim = sample.trim;
  }
  if (!writeMap({ version: SAMPLES_VERSION, pads })) {
    await rollBack();
    return false;
  }
  if (!writeSong(project.song)) {
    writeMap(oldMap);
    await rollBack();
    return false;
  }
  return true;
}
