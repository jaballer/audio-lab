// One voice at a time on each pad: a pad hit again cuts off what it was still playing, as a hardware sampler does,
// instead of layering a second copy over the first (a long sample would play over itself). No DOM, and nothing is
// built until a hit asks for it.
//
//   const voices = createVoices(16);
//   const { out, chokes } = voices.start(ctx, pad, destination, time);
//   //   `out` is a gain node to play the sound into; it is connected to `destination`. Whatever the pad was still
//   //   playing from before `time` is faded out from `time`. `chokes` says which, for undo().
//   voices.undo(chokes);   // the hit was cancelled before it began (Stop, a sequence switch): what it was going to
//                          // cut off carries on
//
// A voice is a gain node of its own in front of the sound, so cutting it is a fade on the audio clock (a few
// milliseconds, no click) and works for a sound scheduled ahead of time. A cut voice is disconnected a little after
// it is silent, so its nodes can be freed (a timer for that clean-up only: the cut itself is on the audio clock).

export const CHOKE_TIME_CONSTANT = 0.004; // seconds: fast, and still a fade
const CLEAN_UP_AFTER_S = 0.1; // after the cut, once it is far below hearing

export function createVoices(pads) {
  const lists = Array.from({ length: pads }, () => []); // per pad, the voices not yet cut off, oldest first

  return {
    start(ctx, pad, destination, time) {
      const out = ctx.createGain();
      out.connect(destination);
      const now = ctx.currentTime;
      const chokes = [];
      // Voices cut long ago are forgotten here; the rest of the pad's are the ones to cut.
      const list = lists[pad].filter((voice) => voice.cutAt === undefined || voice.cutAt > now - CLEAN_UP_AFTER_S);
      for (const voice of list) {
        // Only what starts before this hit is cut by it: a hit already queued for later is not.
        if (voice.cutAt !== undefined || voice.time >= time) continue;
        voice.out.gain.setTargetAtTime(0, time, CHOKE_TIME_CONSTANT);
        voice.cutAt = time;
        const wait = Math.max(0, time - now) + CLEAN_UP_AFTER_S;
        voice.timer = setTimeout(() => voice.out.disconnect(), wait * 1000);
        chokes.push(voice);
      }
      list.push({ out, time, cutAt: undefined, timer: null });
      lists[pad] = list;
      return { out, chokes };
    },

    undo(chokes) {
      for (const voice of chokes) {
        if (voice.cutAt === undefined) continue;
        voice.out.gain.cancelScheduledValues(voice.cutAt);
        clearTimeout(voice.timer);
        voice.cutAt = undefined;
      }
    },
  };
}
