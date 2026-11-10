// Starters: a few complete beats, one per style, to begin from (hip hop, techno, house, trap): tempo, patterns, and the
// pad settings that go with them (a choke group so an open hat is cut by the next closed one, colours that group the
// pads). Not a "preset" in the synth sense, which is one sound: the sounds on the pads are the same in every starter
// (the built-in ones are synthesized with fixed frequencies), so what a starter changes is the beat, not the kit.
// Plain data and pure functions: no DOM, nothing at import time. `starter-beat.js` is separate: the one beat a first
// visit starts with.
//
//   STARTERS                            // [{ id, name, description, bpm, swing?, sequences: [{ pads }], padSettings }]
//   starterSong(STARTERS[0], { rows: 16, steps: 16, maxBars: 8, sequenceCount: 8, volume: 80, keep: { 0: { gain: -6 } } })
//                                       // the song as song.js saves it, or null if it does not fit those limits
//
// `swing` (tempo.js: 50 straight to 75) is how much of each pair of steps the first takes; a starter that does not say is
// straight, and loading one sets the swing as it sets the tempo.
//
// A pattern is written as a grid of characters, 16 to a bar (spaces are ignored, so a beat can be written in groups):
// `X` is a hit at full velocity, `o` a soft one (a ghost note, an off-beat hat), `.` a rest. Every row of a sequence has
// the same length, and a sequence is 1, 2, 4 or 8 bars. Pad rows are the sampler's own kit: 0 kick, 1 snare, 2 closed
// hat, 3 open hat, 4 clap, 5 rim, 6 low tom, 7 high tom, 8 cowbell, 9 conga, 10 shaker, 11 bass, 12 crash, 13 ride,
// 14 zap, 15 blip (shared/sounds.js).

import { parseSong, serializeSong } from "./song.js";

const BAR = 16;
// A soft hit: audibly there, well under the accents.
export const SOFT_VELOCITY = 64;

const KICK = 0;
const SNARE = 1;
const HAT = 2;
const OPEN_HAT = 3;
const CLAP = 4;
const SHAKER = 10;
const BASS = 11;
const ZAP = 14;

// Closed and open hat share a group, so the next closed hat ends an open one, as on a drum machine. Pads of a group that
// hit on the same step cut each other and only the higher pad is heard (voices.js), so the two hat rows never share a step.
const HAT_CHOKE = 1;
// Colours (pad-colors.js): drums, hats, low end, and the rest.
const YELLOW = 1;
const GREEN = 2;
const BLUE = 3;
const PURPLE = 4;

export const STARTERS = [
  {
    id: "hip-hop",
    name: "Hip hop",
    description: "90 BPM with a lazy swing, a kick that skips and a snare on 2 and 4, and ghost notes in the hats",
    bpm: 90,
    swing: 58,
    sequences: [
      {
        // Two bars: the second adds a kick to push into the repeat.
        pads: {
          [KICK]: "X......X..X..... X......X..X...X.",
          [SNARE]: "....X.......X... ....X.......X...",
          [HAT]: "XoXoXoXoXoXoX... XoXoXoXoXoXoXo..",
          [OPEN_HAT]: ".............o.. ..............X.",
        },
      },
      {
        // A bar with a clap on the snare, and the kick on the beat.
        pads: {
          [KICK]: "X..o..X...X.....",
          [SNARE]: "....X.......X...",
          [CLAP]: "....X.......X...",
          [HAT]: "XoXoXoXoXoXoXoXo",
        },
      },
    ],
    padSettings: {
      [KICK]: { color: YELLOW },
      [SNARE]: { color: YELLOW },
      [CLAP]: { color: YELLOW },
      [HAT]: { color: GREEN, choke: HAT_CHOKE },
      [OPEN_HAT]: { color: GREEN, choke: HAT_CHOKE },
    },
  },
  {
    id: "techno",
    name: "Techno",
    description: "130 BPM, four on the floor, open hats on the off-beat and a clap on 2 and 4",
    bpm: 130,
    sequences: [
      {
        pads: {
          [KICK]: "X...X...X...X...",
          [CLAP]: "....X.......X...",
          [HAT]: ".o.o.o.o.o.o.o.o",
          [OPEN_HAT]: "..X...X...X...X.",
          [SHAKER]: "oooooooooooooooo",
        },
      },
      {
        // Four bars: the bass comes in on the off-beat after two, and a zap marks the turn.
        pads: {
          [KICK]: "X...X...X...X... X...X...X...X... X...X...X...X... X...X...X...X...",
          [CLAP]: "....X.......X... ....X.......X... ....X.......X... ....X.......X...",
          [OPEN_HAT]: "..X...X...X...X. ..X...X...X...X. ..X...X...X...X. ..X...X...X...X.",
          [SHAKER]: "oooooooooooooooo oooooooooooooooo oooooooooooooooo oooooooooooooooo",
          [BASS]: "................ ................ ..X...X...X...X. ..X...X...X...X.",
          [ZAP]: "................ ................ ................ ..............X.",
        },
      },
    ],
    padSettings: {
      [KICK]: { color: YELLOW },
      [CLAP]: { color: YELLOW },
      [HAT]: { color: GREEN, choke: HAT_CHOKE },
      [OPEN_HAT]: { color: GREEN, choke: HAT_CHOKE },
      [BASS]: { color: BLUE },
      [SHAKER]: { color: PURPLE },
      [ZAP]: { color: PURPLE },
    },
  },
  {
    id: "house",
    name: "House",
    description:
      "124 BPM with a light swing, four on the floor, a clap on 2 and 4, open hats between the kicks and a bass line",
    bpm: 124,
    swing: 54,
    sequences: [
      {
        pads: {
          [KICK]: "X...X...X...X...",
          [CLAP]: "....X.......X...",
          [HAT]: "o...o...o...o...",
          [OPEN_HAT]: "..X...X...X...X.",
          [SHAKER]: ".o.o.o.o.o.o.o.o",
          [BASS]: "..X..X..X..X..X.",
        },
      },
    ],
    padSettings: {
      [KICK]: { color: YELLOW },
      [CLAP]: { color: YELLOW },
      [HAT]: { color: GREEN, choke: HAT_CHOKE },
      [OPEN_HAT]: { color: GREEN, choke: HAT_CHOKE },
      [BASS]: { color: BLUE },
      [SHAKER]: { color: PURPLE },
    },
  },
  {
    id: "trap",
    name: "Trap",
    description: "140 BPM counted in half time: snare and clap on 3, a sparse kick, and hats that roll",
    bpm: 140,
    sequences: [
      {
        // Two bars; the second ends in a hat roll.
        pads: {
          [KICK]: "X.........X..... X..o......X.....",
          [SNARE]: "........X....... ........X.......",
          [CLAP]: "........X....... ........X.......",
          [HAT]: "XoXoXoXoXoXoXo.o XoXoXoXoXoXoXXXX",
          [OPEN_HAT]: "..............X. ................",
          [BASS]: "X............... ..........X.....",
        },
      },
    ],
    padSettings: {
      [KICK]: { color: YELLOW },
      [SNARE]: { color: YELLOW },
      [CLAP]: { color: YELLOW },
      [HAT]: { color: GREEN, choke: HAT_CHOKE },
      [OPEN_HAT]: { color: GREEN, choke: HAT_CHOKE },
      [BASS]: { color: BLUE },
    },
  },
];

// How many bars a sequence's grid is: all of its rows are the same length, or it is not a pattern at all.
export function sequenceBars(pads) {
  const lengths = new Set(Object.values(pads).map((grid) => grid.replaceAll(" ", "").length));
  if (lengths.size !== 1) return 0;
  const [length] = lengths;
  return length % BAR === 0 ? length / BAR : 0;
}

// One sequence, in the shape song.js keeps: { bars, pattern: { row: [steps] }, velocities: { row: { step: velocity } } }.
function buildSequence({ pads }) {
  const pattern = {};
  const velocities = {};
  for (const [row, grid] of Object.entries(pads)) {
    const cells = [...grid.replaceAll(" ", "")];
    const on = [];
    cells.forEach((cell, step) => {
      if (cell === ".") return;
      on.push(step);
      if (cell === "o") (velocities[row] ??= {})[step] = SOFT_VELOCITY;
    });
    if (on.length) pattern[row] = on;
  }
  return { bars: sequenceBars(pads), pattern, velocities };
}

// The starter as the song the page saves, read back through `parseSong` so it is what a saved beat would be (the
// sequences the starter does not have are empty, and anything outside the limits is brought inside them). `volume` is the
// master volume the person has now: a starter is a beat, and does not move the level. `keep` is { pad: settings } for
// pads that are not on their built-in sound (a loaded sample): the settings the person gave it (gain, pitch, envelope...)
// stay, with only what the starter itself sets for that pad (a choke group, a colour) put over them. Null when a
// sequence's grid is not a whole number of bars, or does not fit.
export function starterSong(starter, { rows, steps, maxBars, sequenceCount, volume, keep = {} }) {
  const sequences = starter.sequences.map(buildSequence);
  if (sequences.some(({ bars }) => bars < 1 || bars > maxBars)) return null;
  const padSettings = { ...starter.padSettings };
  for (const [pad, settings] of Object.entries(keep)) padSettings[pad] = { ...settings, ...starter.padSettings[pad] };
  const raw = serializeSong({ bpm: starter.bpm, swing: starter.swing, volume, current: 0, sequences, padSettings });
  const song = parseSong(raw, { rows, steps, maxBars, sequenceCount });
  return song && serializeSong(song);
}
