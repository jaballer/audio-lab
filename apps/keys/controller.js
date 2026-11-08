// The keys page's state and the things that can happen to it. No DOM.
//
// Notes, the pedal, the joystick, the CC and pad readouts, and the synth
// parameters all change from several places (the page, a MIDI keyboard, the
// computer keyboard, a hardware knob). They change here, so the synth, the
// controls and the display cannot disagree.
//
//   const keys = createKeysController({
//     synth, params,
//     onChange,                      // the LCD or joystick is out of date: read getState()
//     onNoteDown, onNoteUp,          // (note) light / un-light the piano key
//     onSlider, onChoice,            // (param, position, text) / (param, choice): show a control's value
//   });
//
//   keys.noteOn(60, 100, "midi-1")   // velocity 0-127; `source` says who is holding it
//   keys.noteOff(60, "midi-1")
//   keys.releaseSource("midi-1")     // let go of all of a source's notes at once
//   keys.setSustain(true); keys.setBend(-0.5); keys.setMod(64)
//   keys.showCc(74, 100); keys.showPad({ note, velocity, channel })
//   keys.setSlider(param, 40)        // slider position 0-100
//   keys.setChoice(param, "square")
//   keys.applyKnob(0, 127)           // hardware knob index, value 0-127
//   keys.syncParams()                // show the synth's current values on the controls
//   keys.getState()                  // what formatLcd and the joystick draw

import { createHolds } from "./holds.js";
import { isChoice, knobChoice, knobPosition } from "./params.js";

const noop = () => {};

export function createKeysController({
  synth,
  params,
  onChange = noop,
  onNoteDown = noop,
  onNoteUp = noop,
  onSlider = noop,
  onChoice = noop,
}) {
  // A note can be held from the MIDI keyboard, the computer keyboard and each
  // finger on the piano at once, and sounds until the last of them lets go.
  const holds = createHolds();
  let mod = 0;
  let last = null; // { note, velocity }
  let lastCc = null;
  let lastPad = null; // { note, velocity, channel }

  // ---------- Notes ----------
  function noteOn(note, velocity, source) {
    holds.press(note, source);
    last = { note, velocity };
    onNoteDown(note);
    synth.noteOn(note, velocity / 127);
    onChange();
  }

  function noteOff(note, source) {
    if (!holds.release(note, source)) return; // not held by this source, or others still hold it
    onNoteUp(note);
    synth.noteOff(note);
  }

  // A source that goes away without letting go (a window that lost focus, a MIDI
  // device that was unplugged) ends all its notes at once.
  function releaseSource(source) {
    for (const note of holds.releaseAll(source)) {
      onNoteUp(note);
      synth.noteOff(note);
    }
  }

  // ---------- Wheels, pedal and readouts ----------
  function setSustain(on) {
    synth.setSustain(on);
    onChange();
  }

  function setBend(value) {
    synth.setBend(value);
    onChange();
  }

  function setMod(value) {
    mod = value;
    onChange();
  }

  function showCc(controller, value) {
    lastCc = { cc: controller, value };
    onChange();
  }

  function showPad(pad) {
    lastPad = pad;
    onChange();
  }

  // ---------- Parameters ----------
  // The one place a parameter changes, whether it came from the page, a knob or
  // the defaults. `position` is the slider position, 0-100.
  function setSlider(param, position) {
    const value = param.toValue(position);
    synth.set(param.name, value);
    onSlider(param, position, param.format(value));
  }

  function setChoice(param, choice) {
    synth.set(param.name, choice);
    onChoice(param, choice);
  }

  function applyKnob(index, midiValue) {
    const param = params[index];
    if (!param) return; // more knobs than parameters
    if (isChoice(param)) setChoice(param, knobChoice(midiValue, param.choices));
    else setSlider(param, knobPosition(midiValue));
  }

  function syncParams() {
    for (const param of params) {
      const current = synth.params[param.name];
      if (isChoice(param)) setChoice(param, current);
      else setSlider(param, param.toSlider(current));
    }
  }

  return {
    noteOn,
    noteOff,
    releaseSource,
    setSustain,
    setBend,
    setMod,
    showCc,
    showPad,
    setSlider,
    setChoice,
    applyKnob,
    syncParams,

    getState: () => ({ last, bend: synth.bend, mod, sustain: synth.sustain, lastCc, lastPad }),
  };
}
