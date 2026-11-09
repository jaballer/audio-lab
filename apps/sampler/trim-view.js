// The waveform of the selected pad's sample, with its Start and End, drawn into an element it is handed. It
// shows and reports; the sampler decides (samples.setTrim). The maths is in trim.js.
//
//   const view = createTrimView(element, { onChange });   // onChange(trim, moved): moved is "start" or "end"
//   view.refresh(sound);                                   // a sample (trim, duration, peaks()), or null for none
//
// The two sliders are native range inputs, so the keyboard and a screen reader have the whole of it (arrows,
// Home, End; Delete or a double-click puts one back); the picture can also be pressed and dragged, which moves
// the nearer handle. With no sample (a built-in sound has no waveform) the whole thing is hidden.

import { formatTime } from "./format.js";
import { FULL_TRIM, nearestHandle } from "./trim.js";

const STEPS = 1000; // slider positions along the sample: 1 ms in a 1 s sample, 10 ms in a 10 s one
const HEIGHT = 64; // css pixels
const SOUND = "#cfe3a8";
const SHADE = "rgba(15, 15, 14, 0.62)";
const HANDLE = "#ffb347";
const BACKGROUND = "#1c1b19";

export function createTrimView(element, { onChange }) {
  element.classList.add("sampler-trim");
  const idBase = `trim-${element.id || "view"}`;
  let sound = null;

  const canvas = document.createElement("canvas");
  canvas.className = "sampler-trim-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Waveform of the sample, with the part that plays");
  element.appendChild(canvas);

  const rows = {};
  for (const [name, label] of [
    ["start", "Start"],
    ["end", "End"],
  ]) {
    const id = `${idBase}-${name}`;
    const row = document.createElement("div");
    row.className = "sampler-setting";
    const text = document.createElement("label");
    text.className = "small-label";
    text.htmlFor = id;
    text.textContent = label;
    const input = document.createElement("input");
    input.id = id;
    input.type = "range";
    input.className = "fader";
    input.min = "0";
    input.max = String(STEPS);
    input.step = "1";
    const output = document.createElement("output");
    output.className = "small-label sampler-setting-value";
    output.htmlFor = id;
    output.setAttribute("aria-hidden", "true"); // the slider says its value itself (aria-valuetext)
    row.append(text, input, output);
    element.appendChild(row);
    rows[name] = { input, output };

    const reset = () => report({ ...sound.trim, [name]: FULL_TRIM[name] }, name);
    input.addEventListener("input", () => report({ ...sound.trim, [name]: Number(input.value) / STEPS }, name));
    input.addEventListener("dblclick", reset);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      reset();
    });
  }

  function report(trim, moved) {
    if (sound) onChange(trim, moved);
  }

  // Press and drag on the picture: the handle nearer the press follows the pointer.
  let dragging = null;
  const fractionAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!sound || event.button !== 0) return;
    const fraction = fractionAt(event);
    dragging = nearestHandle(sound.trim, fraction);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    report({ ...sound.trim, [dragging]: fraction }, dragging);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (dragging) report({ ...sound.trim, [dragging]: fractionAt(event) }, dragging);
  });
  const stop = () => (dragging = null);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  // Redrawn only when something it shows has changed: the page redraws on every step while playing.
  let drawn = null;
  function draw() {
    const width = canvas.clientWidth;
    if (!sound || width === 0) return;
    const { start, end } = sound.trim;
    if (drawn && drawn.sound === sound && drawn.start === start && drawn.end === end && drawn.width === width) return;
    drawn = { sound, start, end, width };
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, HEIGHT);

    const peaks = sound.peaks();
    const columns = peaks.length / 2;
    const middle = HEIGHT / 2;
    ctx.fillStyle = SOUND;
    for (let x = 0; x < width; x++) {
      const column = Math.min(columns - 1, Math.floor((x / width) * columns));
      const low = peaks[column * 2];
      const high = peaks[column * 2 + 1];
      const top = middle - high * (middle - 2);
      const bottom = middle - low * (middle - 2);
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    // What does not play is dimmed, and the two handles are lines.
    ctx.fillStyle = SHADE;
    ctx.fillRect(0, 0, start * width, HEIGHT);
    ctx.fillRect(end * width, 0, width - end * width, HEIGHT);
    ctx.fillStyle = HANDLE;
    ctx.fillRect(Math.min(width - 2, start * width), 0, 2, HEIGHT);
    ctx.fillRect(Math.max(0, end * width - 2), 0, 2, HEIGHT);
  }

  // The picture is drawn at the size it has on the page, so it is drawn again when that changes (the drawer
  // moving beside the machine, a window resize).
  if (typeof ResizeObserver === "function") new ResizeObserver(draw).observe(canvas);

  return {
    refresh(next) {
      sound = next ?? null;
      element.hidden = !sound;
      if (!sound) {
        drawn = null;
        return;
      }
      const { start, end } = sound.trim;
      const values = { start, end };
      for (const name of ["start", "end"]) {
        const { input, output } = rows[name];
        const text = formatTime(values[name] * sound.duration);
        input.value = String(Math.round(values[name] * STEPS));
        input.setAttribute("aria-valuetext", text);
        output.textContent = text;
      }
      draw();
    },
  };
}
