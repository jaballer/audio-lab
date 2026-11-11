// The level meter's view: a vertical bar for each side of the output, drawn into the element it is handed. It draws what it
// is given and decides nothing: the maths is in level-meter.js.
//
//   const meter = createLevelMeter(element, { bars: 2 });
//   meter.render([{ level, clip }, { level, clip }]);   // what level-meter.js reads, once a frame
//   meter.clear();                                      // every cell dark (nothing can be heard)
//
// A bar is METER_SEGMENTS cells for the loudness and one more on top for the clip lamp, side by side in the element. Only
// the cells that changed are written: it is drawn on every animation frame while there is sound.

import { METER_SEGMENTS, cellStates } from "./level-meter.js";

const DARK = Object.freeze({ level: 0, clip: false });

export function createLevelMeter(element, { bars = 2, segments = METER_SEGMENTS } = {}) {
  const columns = Array.from({ length: bars }, () => {
    const bar = document.createElement("div");
    bar.className = "lcd-meter-bar";
    const cells = Array.from({ length: segments + 1 }, (_, i) => {
      const cell = document.createElement("span");
      cell.className = i === segments ? "lcd-meter-cell lcd-meter-clip" : "lcd-meter-cell";
      bar.appendChild(cell);
      return cell;
    });
    element.appendChild(bar);
    return { cells, lit: new Array(segments + 1).fill(false) };
  });

  function draw(column, states) {
    states.forEach((on, i) => {
      if (column.lit[i] === on) return;
      column.lit[i] = on;
      column.cells[i].classList.toggle("on", on);
    });
  }

  return {
    render(frames) {
      columns.forEach((column, i) => draw(column, cellStates(frames[i] ?? DARK, segments)));
    },
    clear() {
      columns.forEach((column) => draw(column, cellStates(DARK, segments)));
    },
  };
}
