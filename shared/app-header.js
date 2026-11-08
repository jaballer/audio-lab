// The machine's own header: its name (and a tagline), and the lights and readouts on the
// device itself. What belongs to the page, not the device (links, Connect MIDI, the Console),
// is in the site header above it (site-header.js). It draws into the <header> it is handed and
// decides nothing.
//
//   const header = createAppHeader(element, {
//     brand: { name: "PAD", accent: "16" },   // `accent` is drawn highlighted, after `name`
//     sub: "Digital Sampler & Sequencer",
//     onPower: () => {},                      // optional: draws the POWER switch and calls this when it is pressed
//   });
//   header.setPowered(true)                   // lights (or darkens) the switch's LED; the page decides when

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createAppHeader(root, { brand, sub, onPower = null }) {
  const name = element("span", "brand-name", brand.name);
  if (brand.accent) name.append(element("b", "", brand.accent));

  const power = element("div", "power");

  let powerSwitch = null;
  if (onPower) {
    powerSwitch = element("button", "power-switch");
    powerSwitch.type = "button";
    powerSwitch.setAttribute("aria-pressed", "false");
    const led = element("span", "power-led");
    led.setAttribute("aria-hidden", "true");
    powerSwitch.append(led, element("span", "small-label", "Power"));
    powerSwitch.addEventListener("click", onPower);
    power.append(powerSwitch);
  }

  root.append(element("div", "brand"), power);
  root.firstElementChild.append(name, element("span", "brand-sub", sub));

  return {
    setPowered(on) {
      powerSwitch?.setAttribute("aria-pressed", String(on));
    },
  };
}
