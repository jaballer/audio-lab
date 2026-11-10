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
  let known = null; // the inputs at the last scan as id -> name, to log what was plugged in or removed

  // Two units of one model share a name, so inputs are told apart by the port's own id; the name
  // is only for display. A port without an id falls back to its name.
  const keyOf = (input) => input.id ?? input.name;

  function logScan(inputs) {
    if (!onLog) return;
    const names = inputs.map((i) => i.name);
    onLog(names.length ? `Inputs (${names.length}): ${names.join(", ")}` : "No MIDI inputs");
    const now = new Map(inputs.map((i) => [keyOf(i), i.name]));
    // The first scan only lists them: calling each one "connected" would repeat that list.
    if (known) {
      for (const [key, name] of now) if (!known.has(key)) onLog(`Connected: ${name}`);
      for (const [key, name] of known) if (!now.has(key)) onLog(`Disconnected: ${name}`, "warn");
    }
    known = now;
  }

  function rescan() {
    const inputs = [...access.inputs.values()].filter((i) => i.state !== "disconnected" && !/through/i.test(i.name));
    inputs.forEach((input) => {
      input.onmidimessage = (e) => onMessage(input, e.data, e.timeStamp);
    });
    const names = inputs.map((i) => i.name);
    onStatus(summarizeInputs(names));
    logScan(inputs);
    onChange?.(access, inputs);
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      onStatus("MIDI: not supported in this browser");
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

  // A page cannot revoke the browser's permission, so "off" means it stops listening: no message reaches the app and
  // plugging a device in or out is not followed, until connect() runs again.
  function disconnect() {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = null;
    access.onstatechange = null;
    known = null;
    // Tell the app as an unplug of every device would, so held notes are released and its outputs let go. The
    // access it is handed has no ports left: it is a view of what is still being listened to.
    onChange?.({ inputs: new Map(), outputs: new Map() }, []);
    onStatus(""); // the switch's lamp says it is off
    onLog?.("MIDI off: no longer listening to inputs");
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

  return { connect, disconnect, autoConnect };
}

// Hook up the MIDI switch: it stays on the device, like a real switch, and shows whether the page is listening
// (aria-pressed). Pressing it connects, or stops listening; a failed connect leaves it off for another try. It
// reconnects silently on later visits if permission was already granted.
export function wireMidiButton(button, midi) {
  let on = false;
  let pending = false; // a connect is waiting on the permission prompt: another press must not start a second
  let touched = false; // the person pressed the switch: a slower silent reconnect must not override that
  const show = (value) => {
    on = value;
    button.setAttribute("aria-pressed", String(on));
  };
  show(false);
  button.addEventListener("click", async () => {
    if (pending) return;
    touched = true;
    if (on) {
      midi.disconnect();
      show(false);
      return;
    }
    pending = true;
    try {
      show(await midi.connect());
    } finally {
      pending = false;
    }
  });
  midi.autoConnect().then((connected) => {
    if (!touched) return show(connected);
    // The silent reconnect finished after the person pressed the switch, and it restored the listeners: if they left
    // it off, put that back. (A connect they started is still pending and will say so itself.)
    if (connected && !on && !pending) midi.disconnect();
  });
}
