// One voice at a time on each pad: a pad hit again cuts off what it was still playing, as a hardware sampler does,
// instead of layering a second copy over the first (a long sample would play over itself). No DOM, and nothing is
// built until a hit asks for it.
//
//   const voices = createVoices(16);
//   const { out, chokes } = voices.start(ctx, pad, destination, time);
//   //   `out` is a gain node to play the sound into; it is connected to `destination`. Whatever the pad was still
//   //   playing from before `time` is faded out from `time`. `chokes` says which, for undo().
//   voices.undo(chokes);   // the hit was cancelled before it began (Stop, a sequence switch): what it was going to
//                          // cut off carries on, unless another hit cuts it too
//
// A voice is a gain node of its own in front of the sound, so cutting it is a fade on the audio clock (a few
// milliseconds, no click) and works for a sound scheduled ahead of time. A voice can be asked to be cut by more than
// one hit (a queued step, and then a live tap before it): each request is kept, the earliest one is the cut, and
// cancelling a hit takes back only its own request. A cut voice is disconnected a little after it is silent, so its
// nodes can be freed (a timer for that clean-up only: the cut itself is on the audio clock).

export const CHOKE_TIME_CONSTANT = 0.004; // seconds: fast, and still a fade
const CLEAN_UP_AFTER_S = 0.1; // after the cut, once it is far below hearing

const cutTime = (voice) => (voice.cuts.length ? Math.min(...voice.cuts.map((cut) => cut.time)) : undefined);

export function createVoices(pads) {
  const lists = Array.from({ length: pads }, () => []); // per pad, the voices that have not been cut off long ago

  // Makes the voice's gain and its clean-up match its cut requests: the earliest one is the cut.
  function apply(ctx, voice) {
    clearTimeout(voice.timer);
    voice.out.gain.cancelScheduledValues(0);
    const at = cutTime(voice);
    if (at === undefined) return;
    voice.out.gain.setTargetAtTime(0, at, CHOKE_TIME_CONSTANT);
    const wait = Math.max(0, at - ctx.currentTime) + CLEAN_UP_AFTER_S;
    voice.timer = setTimeout(() => voice.out.disconnect(), wait * 1000);
  }

  return {
    start(ctx, pad, destination, time) {
      const out = ctx.createGain();
      out.connect(destination);
      const now = ctx.currentTime;
      const chokes = [];
      // Voices cut long ago are forgotten here.
      const list = lists[pad].filter((voice) => {
        const at = cutTime(voice);
        return at === undefined || at > now - CLEAN_UP_AFTER_S;
      });
      for (const voice of list) {
        // Only what starts no later than this hit is cut by it: a hit already queued for after it is not. And a
        // voice already cut at or before this hit needs nothing more.
        if (voice.time > time) continue;
        const at = cutTime(voice);
        if (at !== undefined && at <= time) continue;
        const cut = { time };
        voice.cuts.push(cut);
        apply(ctx, voice);
        chokes.push({ voice, cut, ctx });
      }
      list.push({ out, time, cuts: [], timer: null });
      lists[pad] = list;
      return { out, chokes };
    },

    undo(chokes) {
      for (const { voice, cut, ctx } of chokes) {
        const at = voice.cuts.indexOf(cut);
        if (at === -1) continue;
        voice.cuts.splice(at, 1);
        apply(ctx, voice);
      }
    },
  };
}
