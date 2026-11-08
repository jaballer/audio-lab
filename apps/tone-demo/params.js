// The tone demo's controls described once: range, default and how a value reads on screen.
// Plain data and pure functions, so the page wiring stays free of formulas.

export const formatPercent = (amount) => `${Math.round(amount * 100)}%`;

export const PARAMS = {
  delay: { min: 0, max: 1, step: 0.01, value: 0.3, format: formatPercent },
  volume: { min: 0, max: 1, step: 0.01, value: 0.5, format: formatPercent },
};
