// The LCD under the pads: whether the device is there, the last hit in numbers, and the
// transport.
//
//   formatLcd({ connected, last })     // three lines of text; `last` is board.snapshot().last
//   formatTransport({ state, bpm })    // one line; transport.snapshot()
//   const lcd = createLcd([lineEl, lineEl, lineEl, lineEl]);
//   lcd.render({ connected, last, transport });

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

const STATE_LABELS = { playing: "PLAYING", stopped: "STOPPED", unknown: "TRANSPORT --" };

export function formatTransport({ state, bpm }) {
  return `${STATE_LABELS[state]}  BPM ${bpm === null ? "--" : bpm.toFixed(1)}`;
}

export function createLcd(lines) {
  return {
    render({ connected, last, transport }) {
      [...formatLcd({ connected, last }), formatTransport(transport)].forEach((text, i) => {
        lines[i].textContent = text;
      });
    },
  };
}
