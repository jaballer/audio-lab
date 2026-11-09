// Small text helpers for the sampler's display and messages. No DOM.

export const pad2 = (n) => String(n).padStart(2, "0");

const NAME_LENGTH = 12; // what fits on a pad and the LCD

// A pad's name for a loaded file: the file's name without its extension, kept short.
export function sampleName(fileName) {
  const name = String(fileName ?? "")
    .replace(/\.[^./\\]*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_LENGTH)
    .trim();
  return name || "Sample";
}
