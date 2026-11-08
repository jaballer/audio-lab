// Device profiles: how one kind of MIDI controller maps onto an app.
//
// A profile is a plain object:
//
//   {
//     id: "mpk-mini",
//     match(inputName) { return /mpk\s*mini/i.test(inputName); },
//     translate(msg) { return [event, ...]; },  // msg comes from parseMidi()
//   }
//
// `translate` returns the app's own semantic events (an array, possibly empty),
// so the app reacts to "knob 3 turned" or "pad hit" and never has to know which
// controller number or channel the hardware uses. The event vocabulary belongs
// to each app: see apps/keys/devices.js. Supporting another controller means
// adding a profile, not editing the app's handlers.

import { parseMidi } from "./midi-messages.js";

// What may follow a model name in a MIDI port name, for a `match` that must not be
// anchored to the end: ALSA appends an instance number, Firefox on Linux reports ports as
// "client:port MIDI 1 28:0", and Windows adds a "2- " prefix. Use it as a lookahead right
// after the model, so a longer model name ("... Pro") does not match the shorter one.
export const PORT_DECORATION = String.raw`(?=\s*$|[:)\]]|\s+(?:midi\b|\d+:\d+\b|[(\[]))`;

// The first profile whose `match` accepts the input's name. Put a catch-all
// (one whose match is always true) last so every device gets something.
export function selectProfile(profiles, inputName = "") {
  return profiles.find((profile) => profile.match(inputName)) ?? null;
}

// A message handler for createMidiAccess's `onMessage`: finds the profile for the
// input a message came from, has it translate the message, and hands each event
// to `handlers[event.type](event, input, timeStamp)`. `timeStamp` is when the system received
// the message (see midi-access.js), for a handler that cares about timing, such as a tempo
// read from clock ticks.
//
//   const onMessage = createMidiRouter(PROFILES, { pad: (e, input) => {}, knob: (e) => {} });
//
// An event with no handler is a mismatch between a profile and the app, so it
// throws rather than being dropped without a trace.
export function createMidiRouter(profiles, handlers) {
  return function route(input, data, timeStamp) {
    const profile = selectProfile(profiles, input.name);
    if (!profile) return;
    for (const event of profile.translate(parseMidi(data))) {
      const handle = handlers[event.type];
      if (!handle) throw new Error(`No handler for MIDI event "${event.type}"`);
      handle(event, input, timeStamp);
    }
  };
}
