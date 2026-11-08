// Web MIDI connection shared by every app: permission, device scanning and
// status text. Each app supplies its own message handler.
//
//   const midi = createMidiAccess({
//     onMessage: (input, data, timeStamp) => {}, // every message from every input
//     onStatus: (text) => {},                    // "MIDI: <devices>" / error text
//     onChange: (access, inputs) => {},          // after each (re)scan, e.g. to find outputs
//     onLog: (text, level) => {},                // the detail: every input by name, plug and unplug,
//                                                // errors; level is "info" | "warn" | "error"
//     sysex: false,                              // true to also receive System Exclusive messages
//   });
//
// `onStatus` stays short enough for the device's header (see summarizeInputs); a browser can
// list dozens of ports (Firefox on Linux adds one for each connection it has opened), so the
// full list goes to `onLog`, where a console drawer can show it.
//
// `timeStamp` is when the system received the message (the page's
// performance.now() clock), not when this callback ran, so it stays accurate
// when the main thread is busy.
//
// `sysex` is off by default: the browser shows a stronger permission prompt
// for it, and only a page that wants to see raw sysex (the monitor) needs it.

const MAX_NAMED_INPUTS = 2; // more than this and the header says how many, not which

// The header's one-line status. Names while they fit, a count when they would not.
export function summarizeInputs(names) {
  if (!names.length) return "MIDI: no device";
  if (names.length <= MAX_NAMED_INPUTS) return `MIDI: ${names.join(", ")}`;
  return `MIDI: ${names.length} inputs`;
}

export function createMidiAccess({ onMessage, onStatus, onChange, onLog, sysex = false }) {
  let access = null;
  let known = null; // input names at the last scan, to log what was plugged in or removed

  function logScan(names) {
    if (!onLog) return;
    onLog(names.length ? `Inputs (${names.length}): ${names.join(", ")}` : "No MIDI inputs");
    // The first scan only lists them: calling each one "connected" would repeat that list.
    if (known) {
      for (const name of names) if (!known.includes(name)) onLog(`Connected: ${name}`);
      for (const name of known) if (!names.includes(name)) onLog(`Disconnected: ${name}`, "warn");
    }
    known = names;
  }

  function rescan() {
    const inputs = [...access.inputs.values()].filter((i) => i.state !== "disconnected" && !/through/i.test(i.name));
    inputs.forEach((input) => {
      input.onmidimessage = (e) => onMessage(input, e.data, e.timeStamp);
    });
    const names = inputs.map((i) => i.name);
    onStatus(summarizeInputs(names));
    logScan(names);
    onChange?.(access, inputs);
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      onStatus("MIDI: use Chrome or Edge");
      onLog?.("This browser has no Web MIDI (navigator.requestMIDIAccess is missing)", "error");
      return false;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex });
    } catch (error) {
      onStatus("MIDI: permission denied");
      onLog?.(`MIDI access refused: ${error?.name ?? "error"}${error?.message ? ` (${error.message})` : ""}`, "error");
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
