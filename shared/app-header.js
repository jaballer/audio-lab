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
//   });
//   header.midiButton            // pass to wireMidiButton()
//   header.setMidiStatus(text)   // pass as createMidiAccess's onStatus
//   header.setAudioStatus(text)  // only with `audioStatus: true`

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

export function createAppHeader(root, { brand, sub, back, powerLed = false, audioStatus = false }) {
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
    setMidiStatus: (text) => (midiStatus.textContent = text),
    setAudioStatus: (text) => {
      if (audio) audio.textContent = text;
    },
  };
}
