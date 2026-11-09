// The waveform of the selected pad's sample, with its Start and End, drawn into an element it is handed. It
// shows and reports; the sampler decides (samples.setTrim). The maths is in trim.js.
//
//   const view = createTrimView(element, { onChange, fallbackFocus });   // onChange(trim, moved): moved is "start" or "end"
//                                                          // fallbackFocus: where focus goes when the view is hidden under it
//   view.refresh(sound, { envelope, rate });               // a sample (trim, duration, peaks()), or null for none
//
// The two sliders are native range inputs, so the keyboard and a screen reader have the whole of it (arrows,
// Home, End; Delete or a double-click puts one back); the picture can also be pressed and dragged, which moves
// the nearer handle. The pad's envelope, when it has one, is drawn on the waveform (pad-envelope.js). With no sample
// (a built-in sound has no waveform) the whole thing is hidden.

import { setAttr, setHidden, setText } from "../../shared/dom-updates.js";
import { curveLevelAt, envelopeCurve } from "./pad-envelope.js";
import { formatTime } from "./format.js";
import { FULL_TRIM, nearestHandle } from "./trim.js";

const STEPS = 1000; // slider positions along the sample: 1 ms in a 1 s sample, 10 ms in a 10 s one
const HEIGHT = 64; // css pixels
const SOUND = "#cfe3a8";
const SOUND_UNSHAPED = "rgba(207, 227, 168, 0.28)"; // the waveform as it is, behind the one the envelope shapes
const ENVELOPE = "#7fd1ff";
const SHADE = "rgba(15, 15, 14, 0.62)";
const HANDLE = "#ffb347";
const BACKGROUND = "#1c1b19";

export function createTrimView(element, { onChange, fallbackFocus = null }) {
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
  let dragging = null; // { handle, sound }: a drag belongs to the sound it began on
  const fractionAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!sound || event.button !== 0) return;
    const fraction = fractionAt(event);
    dragging = { handle: nearestHandle(sound.trim, fraction), sound };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    report({ ...sound.trim, [dragging.handle]: fraction }, dragging.handle);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    // Another pad's sound has come in under the pointer (a pad hit, a sample finishing): the drag is over.
    if (dragging.sound !== sound) {
      dragging = null;
      return;
    }
    report({ ...sound.trim, [dragging.handle]: fractionAt(event) }, dragging.handle);
  });
  const stop = () => (dragging = null);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  // Redrawn only when something it shows has changed: the page redraws on every step while playing.
  let drawn = null;
  let curve = null; // the pad's envelope over the sample, [[x, level], ...], or null for none
  function draw() {
    const width = canvas.clientWidth;
    if (!sound || width === 0) return;
    const { start, end } = sound.trim;
    const ratio = window.devicePixelRatio || 1; // part of what is drawn: it changes on another screen
    const curveKey = curve
      ? JSON.stringify(curve.map(([x, level]) => [Number(x.toFixed(4)), Number(level.toFixed(3))]))
      : "";
    if (
      drawn &&
      drawn.sound === sound &&
      drawn.start === start &&
      drawn.end === end &&
      drawn.width === width &&
      drawn.ratio === ratio &&
      drawn.curveKey === curveKey
    ) {
      return;
    }
    drawn = { sound, start, end, width, ratio, curveKey };
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, HEIGHT);

    const peaks = sound.peaks();
    const columns = peaks.length / 2;
    const middle = HEIGHT / 2;
    // With an envelope the waveform is drawn twice: as it is, faint, and scaled by the envelope, bright: what it
    // would sound like. Without one, as it always was.
    for (const shaped of curve ? [false, true] : [true]) {
      ctx.fillStyle = shaped ? SOUND : SOUND_UNSHAPED;
      for (let x = 0; x < width; x++) {
        const column = Math.min(columns - 1, Math.floor((x / width) * columns));
        const level = shaped && curve ? curveLevelAt(curve, x / width) : 1;
        const low = peaks[column * 2] * level;
        const high = peaks[column * 2 + 1] * level;
        const top = middle - high * (middle - 2);
        const bottom = middle - low * (middle - 2);
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }

    // What does not play is dimmed.
    ctx.fillStyle = SHADE;
    ctx.fillRect(0, 0, start * width, HEIGHT);
    ctx.fillRect(end * width, 0, width - end * width, HEIGHT);

    // The envelope itself, as a line above the middle and its mirror below, over the part that plays. Under the handles,
    // which stay the top thing, and with round joins so a sharp peak (a short attack) does not spike past the picture.
    if (curve) {
      ctx.strokeStyle = ENVELOPE;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        curve.forEach(([x, level], i) => {
          const px = x * width;
          const py = middle + side * level * (middle - 2);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    }

    // The two handles are lines.
    ctx.fillStyle = HANDLE;
    ctx.fillRect(Math.min(width - 2, start * width), 0, 2, HEIGHT);
    ctx.fillRect(Math.max(0, end * width - 2), 0, 2, HEIGHT);
  }

  // The picture is drawn at the size it has on the page, so it is drawn again when that changes (the drawer
  // moving beside the machine, a window resize).
  if (typeof ResizeObserver === "function") new ResizeObserver(draw).observe(canvas);

  return {
    // `envelope` is the pad's ({ attack, decay, sustain, release } in seconds, pad-settings.js padEnvelope) or null, and
    // `rate` its playback rate (pitch): they decide the curve drawn over the waveform.
    refresh(next, { envelope = null, rate = 1 } = {}) {
      sound = next ?? null;
      curve = sound && envelope ? envelopeCurve(envelope, { trim: sound.trim, duration: sound.duration, rate }) : null;
      setAttr(
        canvas,
        "aria-label",
        curve
          ? "Waveform of the sample, with the part that plays and its envelope"
          : "Waveform of the sample, with the part that plays",
      );
      setHidden(element, !sound, fallbackFocus);
      if (!sound) {
        drawn = null;
        return;
      }
      const { start, end } = sound.trim;
      const values = { start, end };
      for (const name of ["start", "end"]) {
        const { input, output } = rows[name];
        const text = formatTime(values[name] * sound.duration);
        const position = String(Math.round(values[name] * STEPS));
        if (input.value !== position) input.value = position;
        setAttr(input, "aria-valuetext", text);
        setText(output, text);
      }
      draw();
    },
  };
}
