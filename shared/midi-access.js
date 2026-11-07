// Web MIDI connection shared by every app: permission, device scanning and
// status text. Each app supplies its own message handler.
//
//   const midi = createMidiAccess({
//     onMessage: (input, data, timeStamp) => {}, // every message from every input
//     onStatus: (text) => {},                    // "MIDI: <devices>" / error text
//     onChange: (access, inputs) => {},          // after each (re)scan, e.g. to find outputs
//     sysex: false,                              // true to also receive System Exclusive messages
//   });
//
// `timeStamp` is when the system received the message (the page's
// performance.now() clock), not when this callback ran, so it stays accurate
// when the main thread is busy.
//
// `sysex` is off by default: the browser shows a stronger permission prompt
// for it, and only a page that wants to see raw sysex (the monitor) needs it.

export function createMidiAccess({ onMessage, onStatus, onChange, sysex = false }) {
  let access = null;

  function rescan() {
    const inputs = [...access.inputs.values()].filter((i) => i.state !== "disconnected" && !/through/i.test(i.name));
    inputs.forEach((input) => {
      input.onmidimessage = (e) => onMessage(input, e.data, e.timeStamp);
    });
    onStatus(inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(", ")}` : "MIDI: no device");
    onChange?.(access, inputs);
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      onStatus("MIDI: use Chrome or Edge");
      return false;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex });
    } catch {
      onStatus("MIDI: permission denied");
      return false;
    }
    access.onstatechange = rescan;
    rescan();
    return true;
  }

  // Reconnect silently on later visits if permission was already granted.
  async function autoConnect() {
    try {
      const p = await navigator.permissions.query({ name: "midi", sysex });
      if (p.state === "granted") return await connect();
    } catch {
      /* permissions API may not know about "midi" */
    }
    return false;
  }

  return { connect, autoConnect };
}

// Hook up a "Connect MIDI" button: connect on click, and reconnect silently
// when permission was already granted. The button hides once connected.
export function wireMidiButton(button, midi) {
  button.addEventListener("click", async () => {
    if (await midi.connect()) button.hidden = true;
  });
  midi.autoConnect().then((connected) => {
    if (connected) button.hidden = true;
  });
}
