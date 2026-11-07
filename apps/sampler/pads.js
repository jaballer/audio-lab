// The 4 x 4 grid of pads, and the computer keys that mirror it.
//
//   const grid = createPadGrid(element, { sounds, onTrigger });
//   grid.flash(0);    // light a pad briefly
//   grid.select(0);   // mark the selected pad
//   padForKey("q")    // which pad a key plays (8), or -1

// Keyboard rows mirror the pad grid: top row of keys = top row of pads.
export const KEY_ROWS = ["1234", "qwer", "asdf", "zxcv"];

// Pad 1 sits bottom-left, so the top key row plays the top pad row (pads 13-16).
export function padForKey(key) {
  for (let row = 0; row < 4; row++) {
    const col = KEY_ROWS[row].indexOf(key);
    if (col !== -1) return (3 - row) * 4 + col;
  }
  return -1;
}

const FLASH_MS = 110;

// `sounds` is a list of { name }; `onTrigger(index)` is called for a pointer
// press or a keyboard activation (Enter/Space on a focused pad).
export function createPadGrid(element, { sounds, onTrigger }) {
  const padEls = [];

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const idx = (3 - row) * 4 + col;
      const key = KEY_ROWS[row][col];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pad";
      btn.setAttribute("aria-label", `Pad ${idx + 1}, ${sounds[idx].name}, key ${key.toUpperCase()}`);
      btn.innerHTML =
        `<span class="num">${idx + 1}</span>` +
        `<span class="key">${key}</span>` +
        `<span class="name">${sounds[idx].name}</span>`;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onTrigger(idx);
      });
      // Keyboard activation (Enter/Space on a focused pad) fires click with detail 0.
      btn.addEventListener("click", (e) => {
        if (e.detail === 0) onTrigger(idx);
      });
      element.appendChild(btn);
      padEls[idx] = btn;
    }
  }

  return {
    flash(idx) {
      const el = padEls[idx];
      el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), FLASH_MS);
    },

    select(idx) {
      padEls.forEach((el, i) => el.classList.toggle("selected", i === idx));
    },
  };
}
