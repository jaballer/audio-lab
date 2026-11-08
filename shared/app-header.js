// The header every page shares: the brand, an optional link back to the sampler,
// the Connect MIDI button and the MIDI status text, plus a page's own extras.
// It draws into the <header> it is handed and decides nothing.
//
//   const header = createAppHeader(element, {
//     brand: { name: "PAD", accent: "16" },   // `accent` is drawn highlighted, after `name`
//     sub: "Digital Sampler & Sequencer",
//     back: { href: "./", label: "Sampler" }, // optional "back" link (not on the sampler itself)
//     powerLed: true,                         // optional: the sampler's red power light
//     audioStatus: true,                      // optional: a text slot for the audio state
//     console: false,                         // optional: leave out the Console button and drawer
//   });
//   header.midiButton            // pass to wireMidiButton()
//   header.setMidiStatus(text)   // pass as createMidiAccess's onStatus
//   header.setAudioStatus(text)  // only with `audioStatus: true`
//   header.log(text, level)      // pass as createMidiAccess's onLog; level "info" | "warn" | "error"
//
// The header holds the short status; whatever is long or only useful when something is wrong
// goes to the console drawer, opened from the Console button.

import { createConsoleDrawer } from "./console-drawer.js";
import { createConsoleLog } from "./console-log.js";

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function statusSlot(id, text) {
  const slot = element("span", "small-label", text);
  slot.id = id;
  slot.setAttribute("role", "status");
  return slot;
}

export function createAppHeader(
  root,
  { brand, sub, back, powerLed = false, audioStatus = false, console: withConsole = true },
) {
  const name = element("span", "brand-name", brand.name);
  if (brand.accent) name.append(element("b", "", brand.accent));

  const power = element("div", "power");

  if (back) {
    const link = element("a", "btn btn-small nav-link", `← ${back.label}`);
    link.href = back.href;
    power.append(link);
  }

  const midiButton = element("button", "btn btn-small", "Connect MIDI");
  midiButton.id = "midi-btn";
  midiButton.type = "button";
  const midiStatus = statusSlot("midi-status", "MIDI: off");
  power.append(midiButton, midiStatus);

  // Messages sent before the drawer is open are kept, so it shows them when it is.
  let drawer = null;
  const log = createConsoleLog({ onChange: () => drawer?.render() });
  if (withConsole) {
    const consoleButton = element("button", "btn btn-small", "Console");
    consoleButton.type = "button";
    consoleButton.setAttribute("aria-expanded", "false");
    const drawerEl = element("section");
    drawerEl.id = "console-drawer";
    consoleButton.setAttribute("aria-controls", drawerEl.id);
    drawer = createConsoleDrawer(drawerEl, {
      log,
      onToggle: (open) => consoleButton.setAttribute("aria-expanded", String(open)),
    });
    consoleButton.addEventListener("click", () => drawer.toggle());
    root.ownerDocument.body.append(drawerEl);
    power.append(consoleButton);
  }

  const audio = audioStatus ? statusSlot("audio-status", "") : null;
  if (audio) power.append(audio);

  if (powerLed) {
    const led = element("span", "power-led");
    led.setAttribute("aria-hidden", "true");
    power.append(led, element("span", "small-label", "Power"));
  }

  root.append(element("div", "brand"), power);
  root.firstElementChild.append(name, element("span", "brand-sub", sub));

  return {
    midiButton,
    setMidiStatus(text) {
      midiStatus.textContent = text;
      midiStatus.title = text; // the whole text, for when the slot cuts it short
    },
    log: (text, level) => log.add(text, level),
    setAudioStatus: (text) => {
      if (audio) audio.textContent = text;
    },
  };
}
