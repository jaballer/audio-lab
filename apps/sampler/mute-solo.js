// Which pads are muted and which are soloed, and from those which are heard. No DOM, and nothing at import time.
//
//   const muteSolo = createMuteSolo(16, { onChange: (pad) => … });   // onChange(pad) after a pad's mute or solo flips
//   muteSolo.toggleMute(3); muteSolo.toggleSolo(5);
//   muteSolo.isMuted(3); muteSolo.isSoloed(5);
//   muteSolo.isAudible(3);     // false: pad 3 is muted, and so is every pad that is not soloed while pad 5 is
//
// The state is for the visit and is not saved with the beat or a project (issue 196): a beat must never open silent because a
// pad was left soloed. A solo is not a mute of the others: it leaves their own mutes as they were, so clearing the last solo
// brings the pads back as they were before it. A pad that is both muted and soloed is silent: the mute wins, as on a mixing desk.

// Whether a pad is heard, from the flags: not muted, and soloed if any pad is.
export function isAudible(pad, { muted, soloed }) {
  if (muted.has(pad)) return false;
  return soloed.size === 0 || soloed.has(pad);
}

export function createMuteSolo(count, { onChange = () => {} } = {}) {
  const muted = new Set();
  const soloed = new Set();
  const valid = (pad) => Number.isInteger(pad) && pad >= 0 && pad < count;

  // The audibility of every pad changes with a solo, so a solo says so for each pad whose answer changed.
  const heard = () => Array.from({ length: count }, (_, pad) => isAudible(pad, { muted, soloed }));
  function flip(set, pad) {
    if (!valid(pad)) return;
    const before = heard();
    if (set.has(pad)) set.delete(pad);
    else set.add(pad);
    const after = heard();
    // The pad itself always reports (its button changed), and so does any pad whose sound was switched on or off by it.
    for (let i = 0; i < count; i++) if (i === pad || before[i] !== after[i]) onChange(i);
  }

  return {
    toggleMute: (pad) => flip(muted, pad),
    toggleSolo: (pad) => flip(soloed, pad),
    isMuted: (pad) => muted.has(pad),
    isSoloed: (pad) => soloed.has(pad),
    isAudible: (pad) => valid(pad) && isAudible(pad, { muted, soloed }),
  };
}
