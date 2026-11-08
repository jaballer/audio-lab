// The tone demo's controls described once: range, default and how a value reads on screen.
// Plain data and pure functions, so the page wiring stays free of formulas.

import { exp } from "../../shared/scales.js";

export const formatPercent = (amount) => `${Math.round(amount * 100)}%`;

export const formatSeconds = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);

// How long a note fades after its key is let go. Equal slider steps are equal ratios, so the
// short tails (where the ear is most sensitive) get as much travel as the long ones.
const RELEASE = exp(0.05, 4);

// Tone's note-value times: the echo stays in time with the transport's tempo.
export const ECHO_TIMES = [
  { value: "16n", label: "1/16" },
  { value: "8n", label: "1/8" },
  { value: "4n", label: "1/4" },
  { value: "2n", label: "1/2" },
];

export const DEFAULT_ECHO_TIME = "8n";

export const PARAMS = {
  delay: { min: 0, max: 1, step: 0.01, value: 0.3, format: formatPercent },
  volume: { min: 0, max: 1, step: 0.01, value: 0.5, format: formatPercent },
  // The slider is 0-100 and `toValue` gives seconds.
  release: {
    min: 0,
    max: 100,
    step: 1,
    value: RELEASE.toSlider(0.3),
    toValue: RELEASE.toValue,
    format: formatSeconds,
  },
  // Capped below 1: at 1 each repeat is as loud as the last and the echo never dies away.
  feedback: { min: 0, max: 0.9, step: 0.01, value: 0.4, format: formatPercent },
};
