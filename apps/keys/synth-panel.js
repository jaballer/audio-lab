// The synth's controls: a slider and readout for every range parameter, a select
// for every choice, grouped into sections. They are drawn from the PARAMS table
// (params.js), so a new parameter needs no markup. It only shows and reports.
//
//   const panel = createSynthPanel(element, { params, groups, onSlider, onChoice });
//   panel.showSlider(param, position, text);   // move a slider (0-100) and set its readout
//   panel.showChoice(param, choice);           // select a choice
//
// `onSlider(param, position)` and `onChoice(param, choice)` are called when the
// user moves a control.

import { choiceLabel, isChoice, labelFor } from "./params.js";

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createSynthPanel(root, { params, groups, onSlider, onChoice }) {
  const controls = new Map(); // param -> { control, output }

  function addControl(grid, param) {
    const label = element("label", "env-ctl");
    label.append(element("span", "small-label", labelFor(param)));

    if (isChoice(param)) {
      const select = element("select");
      select.id = `${param.group}-${param.name}`;
      for (const choice of param.choices) {
        const option = element("option", "", choiceLabel(choice));
        option.value = choice;
        select.append(option);
      }
      select.addEventListener("change", () => onChoice(param, select.value));
      label.append(select);
      controls.set(param, { control: select });
    } else {
      const input = element("input");
      input.id = `${param.group}-${param.name}`;
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "any";
      const output = element("output");
      output.id = `out-${param.name}`;
      input.addEventListener("input", () => onSlider(param, Number(input.value)));
      label.append(input, output);
      controls.set(param, { control: input, output });
    }
    grid.append(label);
  }

  for (const group of groups) {
    const section = element("section", "env");
    section.setAttribute("aria-label", group.label);
    const grid = element("div", "env-grid");
    section.append(element("div", "small-label env-title", group.title), grid);
    for (const param of params) if (param.group === group.id) addControl(grid, param);
    root.append(section);
  }

  return {
    showSlider(param, position, text) {
      const { control, output } = controls.get(param);
      control.value = position;
      output.textContent = text;
    },

    showChoice(param, choice) {
      controls.get(param).control.value = choice;
    },
  };
}
