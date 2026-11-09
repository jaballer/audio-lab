// The sounds on the pads, one per pad: the built-in ones, each of which can be swapped for another (a
// loaded sample) and put back. No DOM. A sound is { id, name, play(ctx, out, t) }, as in shared/sounds.js.
//
//   const kit = createKit(SOUNDS, { onChange });
//   kit.length;               // how many pads
//   kit.get(3);               // the sound pad 3 plays now
//   kit.set(3, sound);        // pad 3 plays `sound` from now on
//   kit.reset(3);             // back to the built-in one
//   kit.isDefault(3);         // is it the built-in one?
//
// `onChange(index)` is called when a pad's sound actually changes, so views can show the new name. The
// sequencer and the pads read the kit each time they play, so a swapped sound is heard at the next hit.

export function createKit(defaults, { onChange } = {}) {
  const current = [...defaults];

  return {
    length: defaults.length,
    get: (index) => current[index],
    isDefault: (index) => current[index] === defaults[index],
    set(index, sound) {
      if (current[index] === sound) return;
      current[index] = sound;
      onChange?.(index);
    },
    reset(index) {
      if (current[index] === defaults[index]) return;
      current[index] = defaults[index];
      onChange?.(index);
    },
  };
}
