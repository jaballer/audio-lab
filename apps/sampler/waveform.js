// The outline of a sample for drawing: for each of `columns` slices of it, the lowest and highest value in it.
// No DOM, so it can be tested; a view draws the columns.
//
//   const peaks = computePeaks(buffer, 400);   // Float32Array of 2 * 400: min, max, min, max, ...
//
// All channels count (a sound that is loud in one ear is loud). Values are the buffer's own, -1 to 1. A column
// of a sample with fewer samples than columns still has at least one sample in it.

export function computePeaks(buffer, columns) {
  const peaks = new Float32Array(columns * 2);
  const length = buffer.length;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let column = 0; column < columns; column++) {
    const from = Math.min(length - 1, Math.floor((column * length) / columns));
    const to = Math.max(from + 1, Math.floor(((column + 1) * length) / columns));
    let min = Infinity;
    let max = -Infinity;
    for (const data of channels) {
      for (let i = from; i < to && i < length; i++) {
        const value = data[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    peaks[column * 2] = Number.isFinite(min) ? min : 0;
    peaks[column * 2 + 1] = Number.isFinite(max) ? max : 0;
  }
  return peaks;
}
