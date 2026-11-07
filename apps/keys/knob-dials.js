// The 4 x 2 grid of knob dials. The pointer sweeps 270 degrees as the value
// goes 0-127.
//
//   const dials = createKnobDials(element, { ccs, labels });
//   dials.turn(0, 64);   // point dial K1 at a 0-127 value
//
// `ccs[i]` is the controller number printed under knob i, and `labels[i]` is
// what it controls.

export function createKnobDials(element, { ccs, labels }) {
  const dialEls = [];

  for (let i = 0; i < ccs.length; i++) {
    const cell = document.createElement("div");
    cell.className = "knob-cell";
    cell.innerHTML =
      `<div class="dial"></div>` +
      `<span class="knob-name">K${i + 1}</span>` +
      `<span class="knob-cc">CC ${ccs[i]}</span>` +
      `<span class="knob-fn">${labels[i] ?? ""}</span>`;
    element.appendChild(cell);
    dialEls.push(cell.querySelector(".dial"));
  }

  function turn(index, value) {
    dialEls[index].style.setProperty("--a", `${-135 + (value / 127) * 270}deg`);
  }

  return { turn };
}
