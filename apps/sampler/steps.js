// The row of step keys for the selected pad, in groups of four.
//
//   const keys = createStepKeys(element, { steps: 16, onToggle });
//   keys.refresh({ on, soundName });     // show which steps are on (on: booleans)
//   keys.paintPlayhead(playing, step);   // light the step the playhead is on

export function createStepKeys(element, { steps, onToggle }) {
  const cells = [];

  let group = null;
  for (let i = 0; i < steps; i++) {
    if (i % 4 === 0) {
      group = document.createElement("div");
      group.className = "step-group";
      element.appendChild(group);
    }
    const cell = document.createElement("div");
    cell.className = "cell";
    const led = document.createElement("span");
    led.className = "led";
    led.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "step";
    btn.textContent = String(i + 1);
    btn.addEventListener("click", () => onToggle(i));
    cell.append(led, btn);
    group.appendChild(cell);
    cells.push({ cell, btn });
  }

  return {
    refresh({ on, soundName }) {
      cells.forEach(({ cell, btn }, i) => {
        cell.classList.toggle("on", on[i]);
        btn.setAttribute("aria-pressed", String(on[i]));
        btn.setAttribute("aria-label", `${soundName} step ${i + 1}${on[i] ? ", on" : ", off"}`);
      });
    },

    paintPlayhead(playing, playheadStep) {
      cells.forEach(({ cell }, i) => cell.classList.toggle("now", playing && i === playheadStep));
    },
  };
}
