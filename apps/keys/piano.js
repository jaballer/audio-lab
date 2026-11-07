// The on-screen piano: draws the keys, lights the ones that are down, scrolls
// to keep a played note in view, and turns mouse/touch on the keys into notes.
//
//   const piano = createPiano(element, { onNoteOn, onNoteOff });
//   piano.press(60);    // light the key, scrolling the view if it is off screen
//   piano.release(60);  // un-light it; returns false if it was not down
//   piano.base          // lowest note currently shown
//
// It only shows and reports: sound is the caller's job, from onNoteOn/onNoteOff
// (called for pointer presses with velocity 100).

import { isBlack, noteName } from "./notes.js";

const SPAN = 24; // 25 keys: two octaves plus the top C
const MAX_BASE = 96; // the highest C the view will scroll to
const POINTER_VELOCITY = 100;

export function createPiano(element, { onNoteOn, onNoteOff, base: initialBase = 48 }) {
  let base = initialBase; // lowest note shown (a C)
  const down = new Set(); // notes currently held
  const keyEls = new Map();

  function render() {
    element.textContent = "";
    keyEls.clear();
    const whiteCount = Array.from({ length: SPAN + 1 }, (_, i) => base + i).filter((n) => !isBlack(n)).length;
    const w = 100 / whiteCount;
    let whiteIndex = 0;

    for (let i = 0; i <= SPAN; i++) {
      const note = base + i;
      const el = document.createElement("div");
      el.dataset.note = note;
      if (isBlack(note)) {
        el.className = "key-black";
        el.style.width = `${w * 0.62}%`;
        el.style.left = `${whiteIndex * w - w * 0.31}%`;
      } else {
        el.className = "key-white";
        if (note % 12 === 0) el.innerHTML = `<span class="label">${noteName(note)}</span>`;
        whiteIndex++;
      }
      el.classList.toggle("down", down.has(note));
      element.appendChild(el);
      keyEls.set(note, el);
    }
  }

  function scrollTo(note) {
    if (note >= base && note <= base + SPAN) return; // already visible
    const next = Math.min(Math.floor(note / 12) * 12, MAX_BASE);
    if (next === base) return;
    base = next;
    render();
  }

  function press(note) {
    down.add(note);
    scrollTo(note);
    keyEls.get(note)?.classList.add("down");
  }

  function release(note) {
    if (!down.delete(note)) return false;
    keyEls.get(note)?.classList.remove("down");
    return true;
  }

  // Mouse / touch on the keys. The release listens on the window so letting go
  // anywhere ends the note.
  let pointerNote = null;
  element.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("[data-note]");
    if (!el) return;
    e.preventDefault();
    pointerNote = Number(el.dataset.note);
    onNoteOn(pointerNote, POINTER_VELOCITY);
  });
  window.addEventListener("pointerup", () => {
    if (pointerNote !== null) onNoteOff(pointerNote);
    pointerNote = null;
  });

  render();

  return {
    press,
    release,
    get base() {
      return base;
    },
  };
}
