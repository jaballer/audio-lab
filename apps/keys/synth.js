// A simple polyphonic synth: one oscillator -> low-pass filter -> envelope gain
// per note, all feeding the audio engine's master gain. No DOM in here.
//
//   const synth = createSynth(audio);       // audio from shared/audio.js
//   synth.noteOn(60, 0.8);                  // note number, velocity 0-1
//   synth.noteOff(60);
//   synth.setSustain(true);                 // pedal: noteOff keeps notes alive
//   synth.setBend(-0.5);                    // -1 .. 1, scaled by BEND_RANGE
//   synth.set("cutoff", 2000);              // see DEFAULT_PARAMS for the names
//   synth.params.cutoff                     // read current values (use set() to change)
//   synth.bend, synth.sustain               // current pitch bend and pedal state
//
// Envelope values and the waveform are read as each note starts, so changing
// them only affects notes played afterwards. Cutoff, resonance and volume
// also move notes that are already sounding.

import { startEnvelope, releaseEnvelope } from "./envelope.js";

export const BEND_RANGE = 2; // semitones, at full bend
export const WAVES = ["sine", "triangle", "square", "sawtooth"];

// attack, decay, release: seconds. sustain: 0-1 fraction of the peak.
// cutoff: Hz. resonance: dB. volume: 0-1 gain.
export const DEFAULT_PARAMS = Object.freeze({
  attack: 0.01,
  decay: 0.3,
  sustain: 0.6,
  release: 0.25,
  wave: "triangle",
  cutoff: 16000,
  resonance: 0,
  volume: 0.5,
});

const freq = (note) => 440 * 2 ** ((note - 69) / 12);

export function createSynth(audio) {
  const params = { ...DEFAULT_PARAMS };
  const voices = new Map(); // note -> { osc, filter, gain }
  const sustained = new Set(); // released but kept alive by the pedal
  let bend = 0; // -1 .. 1
  let pedal = false;

  function startVoice(note, velocity) {
    const ctx = audio.ensure();
    stopVoice(note, 0.02);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = params.wave;
    osc.frequency.value = freq(note);
    osc.detune.value = bend * BEND_RANGE * 100;

    // Each voice has its own low-pass filter between the oscillator and its
    // envelope. Cutoff and resonance are changed live on all sounding voices.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = params.cutoff;
    filter.Q.value = params.resonance; // for a low-pass filter Q is in dB, not a plain ratio

    const gain = ctx.createGain();
    const peak = 0.15 + 0.5 * velocity;
    startEnvelope(gain.gain, t, params, peak);
    osc.connect(filter).connect(gain).connect(audio.master);
    osc.start(t);
    voices.set(note, { osc, filter, gain });
  }

  function stopVoice(note, release = params.release) {
    const v = voices.get(note);
    if (!v) return;
    voices.delete(note);
    const t = audio.ctx.currentTime;
    releaseEnvelope(v.gain.gain, t, release);
    v.osc.stop(t + release + 0.02);
  }

  function noteOn(note, velocity) {
    if (!audio.powered) return; // see playSound in shared/sounds.js
    sustained.delete(note);
    startVoice(note, velocity);
  }

  function noteOff(note) {
    if (pedal) sustained.add(note);
    else stopVoice(note);
  }

  function setSustain(on) {
    pedal = on;
    if (!on) {
      sustained.forEach((n) => stopVoice(n));
      sustained.clear();
    }
  }

  function setBend(value) {
    bend = value;
    if (audio.ctx) {
      voices.forEach((v) => v.osc.detune.setTargetAtTime(bend * BEND_RANGE * 100, audio.ctx.currentTime, 0.01));
    }
  }

  // Cutoff and resonance move smoothly (setTargetAtTime) instead of jumping,
  // which would click.
  function set(name, value) {
    if (!(name in params)) throw new Error(`Unknown synth parameter: ${name}`);
    params[name] = value;
    if (name === "volume") audio.setVolume(value); // fine before the context exists
    const ctx = audio.ctx;
    if (!ctx) return; // nothing is playing yet; new notes read `params`
    const t = ctx.currentTime;
    if (name === "cutoff") voices.forEach((v) => v.filter.frequency.setTargetAtTime(value, t, 0.01));
    if (name === "resonance") voices.forEach((v) => v.filter.Q.setTargetAtTime(value, t, 0.01));
  }

  return {
    noteOn,
    noteOff,
    setSustain,
    setBend,
    set,
    params,
    get bend() {
      return bend;
    },
    get sustain() {
      return pedal;
    },
  };
}
