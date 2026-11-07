// Pad notes are not known in advance, so the page learns them: the first 8 pad
// notes you hit fill pads 1-8 in order, and are remembered between visits.
//
//   const pads = createPadLearner({ load, save });  // load() -> saved data or null, save(data)
//   pads.slotFor(36)   // 0-7 for a known or newly learned note, -1 when all 8 slots are taken
//   pads.notes         // the learned notes, indexed by slot
//
// The saved shape is { pads: [note, ...] }.

export const PAD_SLOTS = 8;
const BANK_OFFSET = 8; // pad bank B usually sends notes 8 away from bank A

export function createPadLearner({ load, save }) {
  const saved = load();
  const notes = Array.isArray(saved?.pads) ? saved.pads.filter(Number.isInteger).slice(0, PAD_SLOTS) : [];

  function slotFor(note) {
    // Bank B notes count as the same pad as their bank A twin.
    for (const n of [note, note - BANK_OFFSET, note + BANK_OFFSET]) {
      const slot = notes.indexOf(n);
      if (slot >= 0) return slot;
    }
    if (notes.length >= PAD_SLOTS) return -1;
    notes.push(note);
    save({ pads: notes });
    return notes.length - 1;
  }

  return {
    slotFor,
    get notes() {
      return [...notes];
    },
  };
}
