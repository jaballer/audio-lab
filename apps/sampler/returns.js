// The two effects every pad can send to, as nodes: one reverb and one delay, each with an input the pads' strips lead to and an
// output that goes to the mixer's output. No DOM, and nothing is built until it is asked for. The settings (effects.js) are
// read through `update`, and the mixer (mixer.js) says whether anything is sending.
//
//   const delay = createDelayReturn(ctx, output);
//   delay.input;                              // what the strips' sends connect to
//   delay.update(effects, bpm);               // at the start: the values are set. With `now`, they glide there.
//
//   const reverb = createReverbReturn(ctx, output, { defer });
//   reverb.input;
//   reverb.update(effects);
//   reverb.setActive(true);                   // some pad sends to it: the room is built and connected
//   reverb.setActive(false);                  // none does: when what is in the room has died away, it is let go
//
// The reverb is a convolver, the one expensive node in the mixer, so it costs nothing until a pad sends to it: the room is
// not made (a few thousand samples of seeded noise, effects.js) or connected until then, and is let go of again once every
// send is down to 0 and the sound that was in it has rung out. `defer(fn, ms)` runs `fn` later and gives back a way to cancel it
// (a timer: letting go of a node is housekeeping, not a sound, so it is not on the audio clock); without it nothing is ever
// let go of or replaced, which is what an export wants (it sets the room once and never changes it).
//
// A change of Size makes a new room, which is built beside the old one and faded to, so the swap is not a click, and only once
// the slider has stopped (a drag would otherwise make one room for every step of it).
//
// The delay is two delay lines with the feedback going round each (an echo) or across to the other (ping-pong). The wiring
// is the same either way, and the settings are only which gains are up, so a switch of Ping-Pong is a glide and not a
// rewire, and a sound that is echoing is never cut by it.

import { delayGain, delaySeconds, feedbackGain, reverbGain, reverbImpulse, reverbSeconds } from "./effects.js";
import { createStereoGain, setParam } from "./audio-nodes.js";

// The longest a delay line is, in seconds. `delaySeconds` is at most a second and a half (a quarter note at 40 BPM).
const MAX_DELAY_SECONDS = 2;
// How fast the delay moves to a new time when the tempo (or the division) changes: a glide, so there is no click, and the echoes
// bend in pitch for a moment, which is better than a jump and expected of a delay.
const DELAY_TIME_CONSTANT = 0.05;

// How long the pause after the last move of the Size slider is before the room is made again, and how long the old room is
// kept to fade out under the new one (the fade's time constant is a tenth of it, so it is well under by then).
const RESIZE_DELAY_MS = 150;
const CROSSFADE_TIME_CONSTANT = 0.04;
const CROSSFADE_KEEP_MS = 600;
// After the sends are all 0, the room is kept for as long as it rings (its own length) and a little more: for the fade of
// the sends themselves, and for a room that is being faded away from.
const RELEASE_MARGIN_MS = 750;

export function createDelayReturn(ctx, output) {
  const input = createStereoGain(ctx);
  const splitter = ctx.createChannelSplitter(2);
  // What goes into each delay line: the left and the right each into their own (an echo that stays where it was played), or both
  // mixed into the left one alone, which then passes it to the right (ping-pong).
  const leftToLeft = ctx.createGain();
  const rightToLeft = ctx.createGain();
  const rightToRight = ctx.createGain();
  const left = ctx.createDelay(MAX_DELAY_SECONDS);
  const right = ctx.createDelay(MAX_DELAY_SECONDS);
  // What comes back round: a line to itself, or to the other one.
  const leftAround = ctx.createGain();
  const rightAround = ctx.createGain();
  const leftAcross = ctx.createGain();
  const rightAcross = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const level = ctx.createGain();

  input.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(rightToLeft, 1);
  splitter.connect(rightToRight, 1);
  leftToLeft.connect(left);
  rightToLeft.connect(left);
  rightToRight.connect(right);
  left.connect(leftAround);
  leftAround.connect(left);
  right.connect(rightAround);
  rightAround.connect(right);
  left.connect(leftAcross);
  leftAcross.connect(right);
  right.connect(rightAcross);
  rightAcross.connect(left);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  merger.connect(level);
  level.connect(output);

  return {
    input,
    // `now` is not given when the nodes are made (everything is set at once) and is given after (everything glides).
    update(effects, bpm, now) {
      const pingPong = effects.pingPong === 1;
      const feedback = feedbackGain(effects.delayFeedback);
      const time = delaySeconds(effects.delayDivision, bpm);
      setParam(left.delayTime, time, now, { timeConstant: DELAY_TIME_CONSTANT });
      setParam(right.delayTime, time, now, { timeConstant: DELAY_TIME_CONSTANT });
      setParam(leftToLeft.gain, pingPong ? 0.5 : 1, now);
      setParam(rightToLeft.gain, pingPong ? 0.5 : 0, now);
      setParam(rightToRight.gain, pingPong ? 0 : 1, now);
      setParam(leftAround.gain, pingPong ? 0 : feedback, now);
      setParam(rightAround.gain, pingPong ? 0 : feedback, now);
      setParam(leftAcross.gain, pingPong ? feedback : 0, now);
      setParam(rightAcross.gain, pingPong ? feedback : 0, now);
      setParam(level.gain, delayGain(effects.delayLevel), now);
    },
  };
}

export function createReverbReturn(ctx, output, { defer = null } = {}) {
  const input = createStereoGain(ctx);
  const level = ctx.createGain();
  level.connect(output);
  let wanted = null; // the Size the settings ask for
  let room = null; // { convolver, gain, size } of the room that is heard, or null while there is none (nothing sends)
  let cancelRelease = null;
  let cancelResize = null;

  // `start` is the room's own gain when it is connected: a room made to be faded in is silent from the first moment, since the
  // input is carrying sound by then, and a browser may take the connection before a change to the gain made after it.
  function build(size, start = 1) {
    const [leftSide, rightSide] = reverbImpulse(size, ctx.sampleRate);
    const buffer = ctx.createBuffer(2, leftSide.length, ctx.sampleRate);
    buffer.getChannelData(0).set(leftSide);
    buffer.getChannelData(1).set(rightSide);
    const convolver = ctx.createConvolver();
    convolver.normalize = true; // so the room's loudness does not depend on how long it is
    convolver.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = start;
    input.connect(convolver);
    convolver.connect(gain);
    gain.connect(level);
    return { convolver, gain, size };
  }

  function drop(old) {
    input.disconnect(old.convolver);
    old.convolver.disconnect();
    old.gain.disconnect();
  }

  // The new room fades in as the old one fades out, so the sound that is in the old one does not stop at once.
  function crossfadeTo(size) {
    if (!room || room.size === size) return;
    const old = room;
    const now = ctx.currentTime;
    room = build(size, 0);
    setParam(room.gain.gain, 1, now, { timeConstant: CROSSFADE_TIME_CONSTANT });
    setParam(old.gain.gain, 0, now, { timeConstant: CROSSFADE_TIME_CONSTANT });
    defer?.(() => drop(old), CROSSFADE_KEEP_MS);
  }

  return {
    input,
    update(effects, now) {
      setParam(level.gain, reverbGain(effects.reverbLevel), now);
      wanted = effects.reverbSize;
      if (!room || room.size === wanted) return;
      if (!defer) return crossfadeTo(wanted);
      cancelResize?.();
      cancelResize = defer(() => {
        cancelResize = null;
        crossfadeTo(wanted);
      }, RESIZE_DELAY_MS);
    },
    // Whether any pad sends to the reverb. Turning it on builds the room if there is none; turning it off lets go of the
    // room, but not until what is in it has rung out.
    setActive(on) {
      if (on) {
        cancelRelease?.();
        cancelRelease = null;
        if (!room) room = build(wanted);
        return;
      }
      if (!room || cancelRelease || !defer) return;
      cancelRelease = defer(
        () => {
          cancelRelease = null;
          cancelResize?.();
          cancelResize = null;
          drop(room);
          room = null;
        },
        reverbSeconds(room.size) * 1000 + RELEASE_MARGIN_MS,
      );
    },
    // For the tests: whether there is a room connected.
    get hasRoom() {
      return room !== null;
    },
  };
}
