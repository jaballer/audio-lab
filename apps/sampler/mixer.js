// The mixer between the pads' voices and the output: one strip for each pad. No DOM, and nothing is built until it is asked
// for. A strip is a filter (a dry path, a low-pass and a high-pass) and then a pan (a balance), so a pad's Filter and Pan settings (pad-settings.js) are heard on
// whatever it plays; the sends to a shared reverb and delay and the drive the sampler is to get are added to the strips and
// the mixer one at a time. With the settings at their defaults a strip hands the sound on as it is.
//
//   const mixer = createMixer(ctx, output, { pads: 16, settings: (pad) => ({ filter: 0, pan: 0 }) });
//   mixer.padInput(3);                  // the node pad 3's voice connects to; the strip leads on to `output`
//   mixer.update(3);                    // pad 3's settings have changed: the strip follows, without a click
//
//   const live = createLiveMixer(audio, { pads: 16, settings });
//   live.padInput(3);                   // the same, on the page's audio engine: it follows `audio.master`
//   live.update(3);
//
// The strip is
//
//   input ──┬── dry ─────────────────────┐
//           ├── low-pass ── low gain ────┼── splitter ──> left gain, right gain ──> merger ──> output
//           └── high-pass ─ high gain ───┘
//
// The Filter setting turns one of the three gains up and the other two down: off is the dry path alone (the sound as it is,
// exactly), and a low-pass or a high-pass is that filter alone. The two filters are never changed from what they were made
// as: changing the type of a filter that is playing resets its memory, which is heard as a tick on a sustained sound, and
// the setting crosses the middle every time it is moved from one kind to the other. A filter that is not in use waits at the
// end of its range (nearly out of the way), so it is already at work on the sound when it is turned up. The input is made
// two channels as speakers are (a mono sound is the same on both, as it is when it is heard), so the balance has a left and
// a right to turn down; a stereo sample keeps its own. A strip is wired once and only its settings change afterwards, so
// no sound playing through it is ever cut or rerouted by a change.
//
// The page's output is `audio.master`, which `audio.killSound()` replaces (and cuts off the old one), so a mixer built on
// the old master would lead into silence. `createLiveMixer` builds one on the master as it is when a hit asks, and
// another when the master has been replaced. The export builds its own `createMixer` on the offline context's master.

import { FILTER_Q_DB, HIGH_PASS_PARKED_HZ, LOW_PASS_PARKED_HZ, filterSpec, panGains } from "./pad-settings.js";

// How fast a changed setting is reached, as a time constant in seconds: slow enough that a slider dragged under a playing
// sound does not zipper or click, fast enough to feel immediate.
const SETTING_TIME_CONSTANT = 0.015;

// Gives a parameter its value: at once when the strip is built, and when `now` is given, by gliding to it, or by jumping
// when `jump` says a glide would pass through values that mean something else (a filter turned on at a cutoff it was not
// waiting at).
function setParam(param, value, now, jump = false) {
  if (now === undefined) {
    param.value = value;
  } else if (jump) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
  } else {
    param.setTargetAtTime(value, now, SETTING_TIME_CONSTANT);
  }
}

function createStrip(ctx, output) {
  // Made two channels as speakers are; the voices connect to it.
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const dry = ctx.createGain();
  const lowPass = ctx.createBiquadFilter();
  const highPass = ctx.createBiquadFilter();
  lowPass.type = "lowpass";
  highPass.type = "highpass";
  lowPass.Q.value = FILTER_Q_DB;
  highPass.Q.value = FILTER_Q_DB;
  lowPass.frequency.value = LOW_PASS_PARKED_HZ;
  highPass.frequency.value = HIGH_PASS_PARKED_HZ;
  const lowGain = ctx.createGain();
  const highGain = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const left = ctx.createGain();
  const right = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  input.connect(dry);
  input.connect(lowPass);
  input.connect(highPass);
  lowPass.connect(lowGain);
  highPass.connect(highGain);
  for (const path of [dry, lowGain, highGain]) path.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  merger.connect(output);
  return { input, dry, lowPass, highPass, lowGain, highGain, left, right, mode: "off" };
}

// Makes the strip match the settings: when it is built (`now` undefined) the values are simply set, and afterwards they
// are glided to.
function applySettings(strip, { filter = 0, pan = 0 }, now) {
  const spec = filterSpec(filter);
  // A filter that is turned on is set to its cutoff at once, from where it waited, and not glided there; one that is already
  // in use follows the slider.
  const entering = now !== undefined && strip.mode !== spec.type;
  if (spec.type === "lowpass") setParam(strip.lowPass.frequency, spec.frequency, now, entering);
  if (spec.type === "highpass") setParam(strip.highPass.frequency, spec.frequency, now, entering);
  setParam(strip.dry.gain, spec.type === "off" ? 1 : 0, now);
  setParam(strip.lowGain.gain, spec.type === "lowpass" ? 1 : 0, now);
  setParam(strip.highGain.gain, spec.type === "highpass" ? 1 : 0, now);
  strip.mode = spec.type;
  const { left, right } = panGains(pan);
  setParam(strip.left.gain, left, now);
  setParam(strip.right.gain, right, now);
}

export function createMixer(ctx, output, { pads, settings = () => ({}) }) {
  const strips = Array.from({ length: pads }, (_, pad) => {
    const strip = createStrip(ctx, output);
    applySettings(strip, settings(pad));
    return strip;
  });
  return {
    padInput: (pad) => strips[pad].input,
    update(pad) {
      if (strips[pad]) applySettings(strips[pad], settings(pad), ctx.currentTime);
    },
  };
}

export function createLiveMixer(audio, { pads, settings }) {
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
        mixer = createMixer(ctx, master, { pads, settings });
        builtOn = master;
      }
      return mixer.padInput(pad);
    },
    // Nothing to follow before a hit has built the strips: they read the settings when they are made.
    update(pad) {
      mixer?.update(pad);
    },
  };
}
