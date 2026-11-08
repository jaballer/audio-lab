// The LCD under the pads: whether the device is there, and the last hit in numbers.
//
//   formatLcd({ connected, last })   // three lines of text; `last` is board.snapshot().last
//   const lcd = createLcd([lineEl, lineEl, lineEl]);
//   lcd.render({ connected, last });

import { bankLabel } from "./board.js";

const num = (value, width) => String(value).padStart(width, "0");

export function formatLcd({ connected, last }) {
  const status = connected ? "MPC SAMPLE: READY" : "MPC SAMPLE: NOT FOUND";
  if (!last) return [status, connected ? "HIT A PAD" : "CONNECT MIDI AND PLUG IT IN", ""];
  return [
    status,
    `PAD ${num(last.index + 1, 2)}  BANK ${bankLabel(last.bank)}  NOTE ${last.note}`,
    `VEL ${num(last.velocity, 3)}  PRESS ${num(last.pressure, 3)}  HITS ${last.hits}`,
  ];
}

export function createLcd(lines) {
  return {
    render(state) {
      formatLcd(state).forEach((text, i) => {
        lines[i].textContent = text;
      });
    },
  };
}
