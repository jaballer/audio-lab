// A row of bank letters: the bank last played is lit, and banks that have had a hit are
// marked, so the page shows which banks the device sent anything for.
//
//   const strip = createBankStrip(element);
//   strip.render({ bank, seen });   // from board.snapshot()

import { BANK_LETTERS } from "./board.js";

export function createBankStrip(element) {
  const chips = [...BANK_LETTERS].map((letter) => {
    const chip = document.createElement("span");
    chip.className = "mpc-bank";
    chip.textContent = letter;
    element.append(chip);
    return chip;
  });

  return {
    render({ bank, seen }) {
      chips.forEach((chip, index) => {
        chip.classList.toggle("current", index === bank);
        chip.classList.toggle("seen", seen.includes(index));
      });
    },
  };
}
