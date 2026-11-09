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

const KB = 1024;
const MB = KB * 1024;

// A file's size for a small display: "812 B", "22 KB", "1.4 MB".
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${Number((bytes / MB).toFixed(1))} MB`;
}

// What the pad editor says about a pad's sound: "Built-in sound" for none, otherwise a sample's length, channels
// and size ("0.40 s, mono, 22 KB"). Whatever is not known is left out.
export function formatSampleInfo(info) {
  if (!info) return "Built-in sound";
  const parts = [];
  if (Number.isFinite(info.seconds)) parts.push(info.seconds < 0.01 ? "<0.01 s" : `${info.seconds.toFixed(2)} s`);
  if (info.channels === 1) parts.push("mono");
  else if (info.channels === 2) parts.push("stereo");
  else if (info.channels > 2) parts.push(`${info.channels} channels`);
  const size = formatSize(info.bytes);
  if (size) parts.push(size);
  return parts.length ? parts.join(", ") : "Sample";
}
