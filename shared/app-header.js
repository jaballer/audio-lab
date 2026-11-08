// The machine's own header: its name (and a tagline), and the lights and readouts on the
// device itself. What belongs to the page, not the device (links, Connect MIDI, the Console),
// is in the site header above it (site-header.js). It draws into the <header> it is handed and
// decides nothing.
//
//   const header = createAppHeader(element, {
//     brand: { name: "PAD", accent: "16" },   // `accent` is drawn highlighted, after `name`
//     sub: "Digital Sampler & Sequencer",
//     powerLed: true,                         // optional: the sampler's red power light
//     audioStatus: true,                      // optional: a text slot for the audio state
//   });
//   header.setAudioStatus(text)  // only with `audioStatus: true`

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createAppHeader(root, { brand, sub, powerLed = false, audioStatus = false }) {
  const name = element("span", "brand-name", brand.name);
  if (brand.accent) name.append(element("b", "", brand.accent));

  const power = element("div", "power");

  const audio = audioStatus ? element("span", "small-label", "") : null;
  if (audio) {
    audio.id = "audio-status";
    audio.setAttribute("role", "status");
    power.append(audio);
  }

  if (powerLed) {
    const led = element("span", "power-led");
    led.setAttribute("aria-hidden", "true");
    power.append(led, element("span", "small-label", "Power"));
  }

  root.append(element("div", "brand"), power);
  root.firstElementChild.append(name, element("span", "brand-sub", sub));

  return {
    setAudioStatus: (text) => {
      if (audio) audio.textContent = text;
    },
  };
}
