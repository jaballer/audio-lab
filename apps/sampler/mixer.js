// The mixer between the pads' voices and the output: one strip for each pad. No DOM, and nothing is built until it is asked
// for. A strip is neutral for now (a gain of one, which hands the signal on as it is); the effects the sampler is to get
// (a filter, a pan, drive, sends to a shared reverb and delay) are added to the strips and the mixer one at a time, so a
// hit is already routed the way they need it.
//
//   const mixer = createMixer(ctx, output, { pads: 16 });
//   mixer.padInput(3);                  // the node pad 3's voice connects to; the strip leads on to `output`
//
//   const live = createLiveMixer(audio, { pads: 16 });
//   live.padInput(3);                   // the same, on the page's audio engine: it follows `audio.master`
//
// The page's output is `audio.master`, which `audio.killSound()` replaces (and cuts off the old one), so a mixer built on
// the old master would lead into silence. `createLiveMixer` builds one on the master as it is when a hit asks, and
// another when the master has been replaced. The export builds its own `createMixer` on the offline context's master.

export function createMixer(ctx, output, { pads }) {
  const strips = Array.from({ length: pads }, () => {
    const input = ctx.createGain();
    input.connect(output);
    return input;
  });
  return {
    padInput: (pad) => strips[pad],
  };
}

export function createLiveMixer(audio, { pads }) {
  let mixer = null;
  let builtOn = null; // the master the mixer leads into
  return {
    padInput(pad) {
      const { ctx, master } = audio;
      // Not before the context has made a master (`audio.ensure()`): a hit is only played after it, and failing here says so.
      if (!master) throw new Error("the audio engine has no master yet: call audio.ensure() first");
      if (builtOn !== master) {
        // The old mixer is left as it is: its master is already fading out, and cutting its strips here instead would
        // end the fade with a step, which is a click.
        mixer = createMixer(ctx, master, { pads });
        builtOn = master;
      }
      return mixer.padInput(pad);
    },
  };
}
