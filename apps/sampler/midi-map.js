// Which MIDI knob controls which setting, as the person assigned it (#194). A controller's knobs send Control Changes (a channel, a
// controller number and a value from 0 to 127), and which number a knob sends is a fact about the hardware that this page does
// not know, so the person teaches it: press Learn beside a setting, turn a knob, and that channel and controller number, on that
// controller's input, are the setting's from then on (two controllers that send the same number are not the same knob). The assignment is the person's controller setup and not part of the music, so it is kept on its own
// (the page saves it with shared/storage.js) and not in the beat or a project file. No DOM, and plain data and functions, so the
// same code is what the page runs and what the tests run.
//
//   const mapping = createMidiMapping({ load, save, setEffect, getEffect, onChange, onMessage });
//   mapping.toggleLearn("masterFilter");       // the next knob turned is the Master Filter's (again: stop waiting)
//   mapping.handleCc({ channel: 0, controller: 21, value: 64, input: "MPK mini 3" });   // `input`: the port it came from
//   mapping.getState();                        // { learning: null, assigned: { masterFilter: "CH 1 CC 21" } }
//   mapping.clear("masterFilter");
//
// Only the Master Filter is a target so far. A target is an entry of TARGETS, so another effect later is a line there.

import { detented } from "../../shared/scales.js";
import { clampEffect } from "./effects.js";

// A Control Change value is 0 to 127.
export const CC_MAX = 127;

// The knob's middle is the filter off. A knob has 128 positions and no middle one (63.5), so a filter that was off only when a
// knob sat on exactly one position would be on, a little, nearly always. The middle of the travel is therefore a detent
// (`detented` in shared/scales.js): positions within DETENT per cent of the middle (a per cent of half the travel) all give off, and
// the rest of the travel is spread over what is left, so the setting is continuous at the edge of the detent and still reaches
// -100 and +100 at the ends.
export const DETENT = 6;
const FILTER_KNOB = detented(-100, 100, DETENT);

// The settings a knob can be assigned to: which effect (effects.js) it sets and how a value from 0 to 127 becomes that effect's setting.
export const TARGETS = Object.freeze({
  masterFilter: Object.freeze({
    effect: "masterFilter",
    label: "Master Filter",
    lcd: "MASTER FILTER",
    // The knob's 0 to 127 as a position along the travel, 0 to 100.
    toSetting: (value) => Math.round(FILTER_KNOB.toValue((value / CC_MAX) * 100)),
  }),
});

export const TARGET_NAMES = Object.keys(TARGETS);

// Controllers that are not knobs, which Learn does not take: a sustain pedal sends controller 64 every time it is pressed, Bank
// Select is 0 and 32 and comes with a program change, and 120 and up are channel mode messages (all sound off and the like) that
// controllers send on their own. A knob that is any of these is not assignable, which is a limit of the first version.
const NOT_KNOBS = new Set([0, 32, 64, 120, 121, 122, 123, 124, 125, 126, 127]);

// Whether a Control Change can be learned: a real controller number that is not one of the above.
export const isAssignableCc = (channel, controller) =>
  Number.isInteger(channel) &&
  channel >= 0 &&
  channel <= 15 &&
  Number.isInteger(controller) &&
  controller >= 0 &&
  controller <= CC_MAX &&
  !NOT_KNOBS.has(controller);

// The port a Control Change came from, by the name the browser gives it (the same name a device profile matches): a controller is
// not another controller that happens to send the same numbers. A name is a non-empty string of a sane length.
const MAX_INPUT_NAME = 200;
export const isInputName = (input) => typeof input === "string" && input !== "" && input.length <= MAX_INPUT_NAME;

// What to show for an assignment: channels are counted from 1 as a controller's own display counts them, `channel` here from 0.
export const formatAssignment = ({ channel, controller }) => `CH ${channel + 1} CC ${controller}`;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// What was stored, as a map of target name to { channel, controller, input }: anything that is not a known target, not an assignable
// controller or has no input name is left out, and two targets with the same controller on the same input are not both kept (the
// first one is). Never throws.
export function parseMidiMap(stored) {
  const map = {};
  if (!isObject(stored)) return map;
  const taken = new Set();
  for (const name of TARGET_NAMES) {
    const entry = stored[name];
    if (!isObject(entry) || !isAssignableCc(entry.channel, entry.controller) || !isInputName(entry.input)) continue;
    const key = JSON.stringify([entry.input, entry.channel, entry.controller]);
    if (taken.has(key)) continue;
    taken.add(key);
    map[name] = { channel: entry.channel, controller: entry.controller, input: entry.input };
  }
  return map;
}

const sameKnob = (entry, channel, controller, input) =>
  entry?.channel === channel && entry?.controller === controller && entry?.input === input;

// The target a Control Change, from an input, is assigned to, if any.
export const targetForCc = (map, channel, controller, input) =>
  TARGET_NAMES.find((name) => sameKnob(map[name], channel, controller, input)) ?? null;

// A new map with the knob assigned to the target. A knob is one target's, so it is taken from any other that had it.
export function assignCc(map, name, channel, controller, input) {
  const next = {};
  for (const other of TARGET_NAMES) {
    const entry = map[other];
    if (!entry) continue;
    if (other !== name && sameKnob(entry, channel, controller, input)) continue;
    next[other] = entry;
  }
  next[name] = { channel, controller, input };
  return next;
}

// A new map without the target.
export function clearCc(map, name) {
  const next = { ...map };
  delete next[name];
  return next;
}

// The assignments and Learn for a page. `load()` gives what was stored (or anything), `save(map)` keeps the map, `setEffect(name,
// value)` and `getEffect(name)` are the sampler's, `onChange()` says the state has changed (for the view), and `onMessage(text)` is
// the display.
export function createMidiMapping({ load, save, setEffect, getEffect, onChange = () => {}, onMessage = () => {} }) {
  let map = parseMidiMap(load());
  let learning = null; // the target the next knob is for, or null

  // Keeps the map, and says whether it was kept: storage can be blocked or full, and then the assignment lasts until the page is
  // closed, which the person is told (`save` returns false).
  function persist(next) {
    map = next;
    const kept = save(map) !== false;
    onChange();
    return kept;
  }

  function startLearn(name) {
    if (!TARGETS[name]) return;
    learning = name;
    onMessage(`MOVE A KNOB FOR ${TARGETS[name].lcd}`);
    onChange();
  }

  function cancelLearn() {
    if (learning === null) return;
    learning = null;
    onMessage("LEARN CANCELLED");
    onChange();
  }

  return {
    startLearn,
    cancelLearn,
    // The Learn key: it waits for a knob, and pressed again it stops waiting. The view does not need to know which it is.
    toggleLearn(name) {
      if (learning === name) cancelLearn();
      else startLearn(name);
    },
    clear(name) {
      if (!map[name]) return;
      // Clear ends a Learn that was waiting too: pressing it is the person saying this knob is not wanted.
      learning = null;
      const kept = persist(clearCc(map, name));
      onMessage(`${TARGETS[name].lcd} KNOB CLEARED${kept ? "" : " (NOT SAVED)"}`);
    },
    // A Control Change from a controller (the `cc` event, midi.js). While Learn waits it is the assignment, when it can be one;
    // otherwise, when it is assigned, it moves the setting.
    handleCc({ channel, controller, value, input }) {
      if (!isInputName(input)) return; // not from a port: nothing to tell one controller from another by
      if (learning !== null) {
        if (!isAssignableCc(channel, controller)) {
          // A pedal or a channel message is not a knob, and Learn goes on waiting: the display says why nothing happened.
          onMessage(`CC ${controller} IS NOT A KNOB`);
          return;
        }
        const name = learning;
        learning = null;
        const kept = persist(assignCc(map, name, channel, controller, input));
        onMessage(`${TARGETS[name].lcd} ${formatAssignment({ channel, controller })}${kept ? "" : " (NOT SAVED)"}`);
        return;
      }
      const name = targetForCc(map, channel, controller, input);
      if (name === null) return;
      const { effect, toSetting } = TARGETS[name];
      const setting = clampEffect(effect, toSetting(value));
      // A knob sends a message for every position it passes, and the detent a run of the same: only a change is a change.
      if (getEffect(effect) !== setting) setEffect(effect, setting);
    },
    getState() {
      const assigned = {};
      for (const name of TARGET_NAMES) assigned[name] = map[name] ? formatAssignment(map[name]) : null;
      return { learning, assigned };
    },
  };
}
