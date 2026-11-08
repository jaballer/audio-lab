// A row of step keys for one pad, in groups (a beat of 16ths, four keys, by default). Shared by the
// pages that have a step sequencer; its styles are in shared/step-keys.css, which the page imports.
//
//   const keys = createStepKeys(element, { steps: 16, group: 4, onToggle });
//   keys.refresh({ on, soundName });     // show which steps are on (on: booleans)
//   keys.paintPlayhead(playing, step);   // light the step the playhead is on

export function createStepKeys(element, { steps, group: groupSize = 4, onToggle }) {
  const cells = [];
  element.classList.add("step-keys");
  element.style.setProperty("--step-groups", String(steps / groupSize));

  let group = null;
  for (let i = 0; i < steps; i++) {
    if (i % groupSize === 0) {
      group = document.createElement("div");
      group.className = "step-keys-group";
      group.style.setProperty("--step-group", String(groupSize));
      element.appendChild(group);
    }
    const cell = document.createElement("div");
    cell.className = "step-keys-cell";
    const led = document.createElement("span");
    led.className = "step-keys-led";
    led.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "step-keys-key";
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
