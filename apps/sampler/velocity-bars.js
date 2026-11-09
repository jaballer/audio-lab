// A row of bars under the step keys, one per step, showing how hard each step of the selected pad
// plays and letting it be set by dragging. It reports; the sampler decides (setStepVelocity).
//
//   const bars = createVelocityBars(element, { steps: 16, group: 4, onChange });
//   bars.refresh({ on, velocities, soundName });           // on: booleans; velocities: 1-127 for every step
//   bars.refresh({ on, velocities, soundName, first: 16 }); // the bars are steps 17-32 of the sequence
//   // onChange(index, value) is called with the bar's place in the row and the new velocity, 1-127
//
// Press and drag along the row to paint: the bar under the pointer takes the height of the pointer.
// Each bar is also a slider for the keyboard (arrows, Page Up/Down, Home, End). A bar for a step that is
// off is shown dim and does nothing: a velocity belongs to a step that sounds.

import { FULL_VELOCITY, MIN_VELOCITY } from "../../shared/pattern.js";

const KEY_STEP = 1;
const PAGE_STEP = 16; // about an eighth of the range

// The velocity for a pointer `offset` pixels down a bar that is `height` pixels tall: the top of the bar is
// full velocity and the bottom is the softest, and a pointer beyond either end counts as that end.
export function velocityFromPosition(offset, height) {
  if (!(height > 0)) return FULL_VELOCITY;
  const fraction = Math.min(1, Math.max(0, 1 - offset / height));
  return Math.round(MIN_VELOCITY + fraction * (FULL_VELOCITY - MIN_VELOCITY));
}

// What a key does to a bar's velocity: the new value, or null for a key that is not for this.
export function velocityAfterKey(key, value) {
  const keyed = {
    ArrowUp: value + KEY_STEP,
    ArrowRight: value + KEY_STEP,
    ArrowDown: value - KEY_STEP,
    ArrowLeft: value - KEY_STEP,
    PageUp: value + PAGE_STEP,
    PageDown: value - PAGE_STEP,
    Home: MIN_VELOCITY,
    End: FULL_VELOCITY,
  }[key];
  return keyed === undefined ? null : Math.min(FULL_VELOCITY, Math.max(MIN_VELOCITY, keyed));
}

// The index of the bar the pointer is at, given every bar's rectangle ({ left, right, top, bottom }). The bars
// wrap into rows on a narrow screen, so the row is chosen first (the bar whose top-to-bottom span is nearest the
// pointer, 0 away when it is inside) and then the bar along that row nearest to it by its centre. That way a
// drag keeps going over the gaps between bars, and a pointer above or below a bar still counts as that bar.
export function nearestBar(rects, x, y) {
  let nearest = -1;
  let bestRow = Infinity;
  let bestAcross = Infinity;
  rects.forEach((rect, i) => {
    const row = Math.max(rect.top - y, y - rect.bottom, 0);
    const across = Math.abs(x - (rect.left + rect.right) / 2);
    if (row < bestRow || (row === bestRow && across < bestAcross)) {
      nearest = i;
      bestRow = row;
      bestAcross = across;
    }
  });
  return nearest;
}

export function createVelocityBars(element, { steps, group: groupSize = 4, onChange }) {
  const bars = [];
  element.classList.add("sampler-velocity");
  element.style.setProperty("--velocity-groups", String(steps / groupSize));

  let group = null;
  for (let i = 0; i < steps; i++) {
    if (i % groupSize === 0) {
      group = document.createElement("div");
      group.className = "sampler-velocity-group";
      group.style.setProperty("--velocity-group", String(groupSize));
      element.appendChild(group);
    }
    const bar = document.createElement("div");
    bar.className = "sampler-velocity-bar";
    bar.tabIndex = 0;
    bar.setAttribute("role", "slider");
    bar.setAttribute("aria-orientation", "vertical");
    bar.setAttribute("aria-valuemin", String(MIN_VELOCITY));
    bar.setAttribute("aria-valuemax", String(FULL_VELOCITY));
    const fill = document.createElement("span");
    fill.className = "sampler-velocity-fill";
    fill.setAttribute("aria-hidden", "true");
    bar.appendChild(fill);
    bar.addEventListener("keydown", (e) => {
      const state = bars[i];
      if (!state.on || e.altKey || e.ctrlKey || e.metaKey) return;
      const next = velocityAfterKey(e.key, state.value);
      if (next === null) return;
      e.preventDefault();
      if (next !== state.value) onChange(i, next);
    });
    group.appendChild(bar);
    bars.push({ bar, fill, on: false, value: FULL_VELOCITY });
  }

  function barAt(clientX, clientY) {
    return nearestBar(
      bars.map(({ bar }) => bar.getBoundingClientRect()),
      clientX,
      clientY,
    );
  }

  function paint(e) {
    const i = barAt(e.clientX, e.clientY);
    if (i < 0 || !bars[i].on) return;
    const rect = bars[i].bar.getBoundingClientRect();
    const value = velocityFromPosition(e.clientY - rect.top, rect.height);
    if (value !== bars[i].value) onChange(i, value);
  }

  let dragging = false;
  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const i = barAt(e.clientX, e.clientY);
    if (i < 0) return;
    dragging = true;
    element.setPointerCapture(e.pointerId);
    bars[i].bar.focus({ preventScroll: true });
    e.preventDefault(); // no text selection or scrolling while painting
    paint(e);
  });
  element.addEventListener("pointermove", (e) => {
    if (dragging) paint(e);
  });
  const stop = () => (dragging = false);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);

  return {
    refresh({ on, velocities, soundName, first = 0 }) {
      bars.forEach((state, i) => {
        state.on = on[i];
        state.value = velocities[i];
        state.bar.classList.toggle("on", on[i]);
        state.bar.setAttribute("aria-disabled", String(!on[i]));
        state.bar.setAttribute("aria-valuenow", String(velocities[i]));
        state.bar.setAttribute(
          "aria-label",
          `${soundName} step ${first + i + 1} velocity${on[i] ? "" : ", step is off"}`,
        );
        // A step that is off shows an empty bar: its velocity is not in use.
        state.fill.style.height = on[i] ? `${(velocities[i] / FULL_VELOCITY) * 100}%` : "0";
      });
    },
  };
}
