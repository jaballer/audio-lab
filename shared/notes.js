// MIDI note numbers: 60 is middle C (C4).

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = [1, 3, 6, 8, 10]; // pitch classes of C#, D#, F#, G#, A#

export const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
export const isBlack = (n) => BLACK_KEYS.includes(n % 12);
