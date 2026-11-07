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

// The first profile whose `match` accepts the input's name. Put a catch-all
// (one whose match is always true) last so every device gets something.
export function selectProfile(profiles, inputName = "") {
  return profiles.find((profile) => profile.match(inputName)) ?? null;
}
