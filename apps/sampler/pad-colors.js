// The colours a pad can be given in the pad editor, to tell pads apart by your own grouping (drums, loops, bass,
// one-shots). A fixed set, not a free choice: each is picked to be easy to see against the dark face of a pad and to
// stay clear of the orange ring that marks the selected pad and the red a hit lights it with, and each has a name for a
// screen reader, since a colour alone should not carry the meaning. No DOM.
//
//   PAD_COLORS[1]            // { id: "yellow", name: "Yellow", css: "#ffe94a" }: swatch 1 (0 is none)
//   padColorName(0)          // "None"
//   padColorCss(2)           // "#52d65b", or null for none
//
// What is kept for a pad is the number: 0 for no colour, or 1 to the number of colours (the `color` setting in
// pad-settings.js). Adding to the end of the list is safe for saved songs; changing or reordering it is not.

export const PAD_COLORS = [
  { id: "none", name: "None", css: null },
  { id: "yellow", name: "Yellow", css: "#ffe94a" },
  { id: "green", name: "Green", css: "#52d65b" },
  { id: "blue", name: "Blue", css: "#4aa3ff" },
  { id: "purple", name: "Purple", css: "#b184ff" },
  { id: "pink", name: "Pink", css: "#ff80cc" },
  { id: "silver", name: "Silver", css: "#d6d6d6" },
];

export const COLOR_COUNT = PAD_COLORS.length - 1; // not counting none

export const padColorName = (index) => PAD_COLORS[index]?.name ?? PAD_COLORS[0].name;
export const padColorCss = (index) => PAD_COLORS[index]?.css ?? null;
