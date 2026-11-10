// The light show's view: a fixed layer behind the page (so it never covers the machine) whose CSS variables are
// set every animation frame. It draws what it is handed and decides nothing.
//
//   const lights = createLightShow(element, {
//     read: () => ({ level, phase, playing, beat, timeMs, still, low, high }),   // what the lights show now (see light-show.js)
//   });
//   lights.flash({ x: 40, y: 70, color: "#ffe94a" })   // a burst of colour at a place (percent of the window); a pad hit
//   lights.setOn(true)                           // starts or stops the loop; off, the layer is hidden and nothing runs
//   lights.isOn
//
// The loop is only running while the lights are on and the page is visible.

import { ORBIT_LIGHTS, lightFrame, orbitPositions, sparkleOpacity } from "./light-show.js";

const SPARKLES = 12;
const MAX_FLASHES = 24; // a busy sequence hits several pads a step: the oldest burst goes when there are too many
const FLASH_MS = 700; // the CSS animation's length (light-show.css)

// Where the sparkles sit: scattered round the edges of the window, where the machine does not cover them. Fixed, so the
// same ones are always in the same place (a spread, not a random one that moves on each visit).
const sparkleSpot = (i) => {
  const along = (i * 0.618034) % 1; // the golden ratio spreads them evenly without a pattern
  const side = i % 3; // left, right, top
  if (side === 0) return { x: 2 + along * 10, y: 15 + along * 70 };
  if (side === 1) return { x: 88 + along * 10, y: 85 - along * 70 };
  return { x: 15 + along * 70, y: 3 + (i % 4) * 2 };
};

export function createLightShow(
  element,
  { read, raf = requestAnimationFrame, caf = cancelAnimationFrame, doc = document },
) {
  const sparkles = Array.from({ length: SPARKLES }, (_, i) => {
    const dot = doc.createElement("span");
    dot.className = "light-sparkle";
    const { x, y } = sparkleSpot(i);
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    element.append(dot);
    return dot;
  });
  let on = false;
  let handle = null;
  const written = {};
  let angle = 0;
  let lastTime = null; // the clock at the last frame; null after the loop was stopped, so a pause is not a jump

  // Only what changed is written, and rounded: sixty identical style writes a second are wasted work.
  const set = (name, value) => {
    if (written[name] === value) return;
    written[name] = value;
    element.style.setProperty(name, String(value));
  };

  function frame() {
    handle = null;
    const inputs = read();
    const { hue, glow, pulse, x, y, size, even, odd, spin, high } = lightFrame(inputs);
    set("--light-hue", hue);
    set("--light-glow", Math.round(glow * 100) / 100);
    set("--light-pulse", Math.round(pulse * 100) / 100);
    set("--light-x", `${x}%`);
    set("--light-y", `${y}%`);
    set("--light-size", `${size}%`);
    set("--light-even", even);
    set("--light-odd", odd);
    // The angle is the running total of the spin, not a function of the clock: a change of tempo changes the pace, and
    // the lights carry on from where they are instead of jumping to where the new pace would have put them.
    const dt = lastTime === null ? 0 : Math.min(100, Math.max(0, inputs.timeMs - lastTime));
    lastTime = inputs.timeMs;
    angle += (spin * dt) / 1000;
    orbitPositions(angle, ORBIT_LIGHTS).forEach((spot, k) => {
      set(`--light-o${k}x`, `${spot.x}%`);
      set(`--light-o${k}y`, `${spot.y}%`);
    });
    sparkles.forEach((dot, i) => {
      const opacity = String(sparkleOpacity(high, i, inputs.timeMs));
      if (dot.style.opacity !== opacity) dot.style.opacity = opacity;
    });
    schedule();
  }

  function schedule() {
    if (on && !doc.hidden && handle === null) handle = raf(frame);
  }

  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden && handle !== null) {
      caf(handle);
      handle = null;
    } else schedule();
  });

  function flash({ x, y, color }) {
    if (!on) return;
    const burst = doc.createElement("span");
    burst.className = "light-flash";
    burst.style.left = `${x}%`;
    burst.style.top = `${y}%`;
    burst.style.setProperty("--flash-color", color);
    element.append(burst);
    setTimeout(() => burst.remove(), FLASH_MS);
    const flashes = element.querySelectorAll(".light-flash");
    if (flashes.length > MAX_FLASHES) flashes[0].remove();
  }

  return {
    flash,
    get isOn() {
      return on;
    },
    setOn(value) {
      on = value;
      lastTime = null;
      element.hidden = !on;
      if (on) schedule();
      else if (handle !== null) {
        caf(handle);
        handle = null;
      }
    },
  };
}
