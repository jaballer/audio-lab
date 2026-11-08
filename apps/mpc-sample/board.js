// What the MPC Sample's pads are doing, as the page shows it. Pure: no DOM.
//
// The device has several pad banks, each with the same 16 pads. The board keeps every
// bank's pads, and shows the bank that was last played: a hit moves the view to its bank,
// but a release or pressure that arrives late for another bank does not drag it back.
//
//   const board = createBoard();
//   board.apply(event);    // a padDown / padUp / padPressure event from devices.js
//   board.snapshot();      // { bank, pads, seen, last } for the views to draw

import { PADS_PER_BANK } from "../../shared/mpc-sample.js";

export const BANK_LETTERS = "ABCDEFGH";
export const bankLabel = (bank) => BANK_LETTERS[bank] ?? String(bank + 1);

const idlePad = () => ({ down: false, velocity: 0, pressure: 0, hits: 0 });

export function createBoard() {
  const banks = new Map(); // bank -> its 16 pads
  let current = 0; // the bank last played; bank A until a pad is hit
  let lastHit = null; // { index, bank, note } of the latest hit

  function padsOf(bank) {
    if (!banks.has(bank)) banks.set(bank, Array.from({ length: PADS_PER_BANK }, idlePad));
    return banks.get(bank);
  }

  return {
    apply(event) {
      const pad = padsOf(event.bank)[event.index];
      if (event.type === "padDown") {
        pad.down = true;
        pad.velocity = event.velocity;
        pad.pressure = 0;
        pad.hits += 1;
        current = event.bank;
        lastHit = { index: event.index, bank: event.bank, note: event.note };
      } else if (event.type === "padPressure") {
        pad.pressure = event.pressure;
      } else if (event.type === "padUp") {
        pad.down = false;
        pad.pressure = 0;
      }
    },

    snapshot() {
      const hitPad = lastHit && padsOf(lastHit.bank)[lastHit.index];
      return {
        bank: current,
        pads: padsOf(current).map((pad) => ({ ...pad })),
        seen: [...banks]
          .filter(([, pads]) => pads.some((pad) => pad.hits > 0))
          .map(([bank]) => bank)
          .sort((a, b) => a - b),
        last: lastHit && { ...lastHit, velocity: hitPad.velocity, pressure: hitPad.pressure, hits: hitPad.hits },
      };
    },
  };
}
