// Turns a raw MIDI message into the pieces the monitor shows. Pure: no DOM.
//
//   describeMessage([0x90, 36, 127]) ->
//     { kind: "note", name: "Note On", channel: 1, detail: "C2 (36)  vel 127", hex: "90 24 7F" }
//
// `kind` is what the page's filters group by. `channel` is 1-16 as printed on
// controllers (parseMidi counts from 0), or null for system messages.

import { parseMidi } from "../../shared/midi-messages.js";
import { noteName } from "../../shared/notes.js";

export const KINDS = ["note", "cc", "bend", "pressure", "program", "system"];

// A sysex dump can be thousands of bytes; the first few say what it is.
const MAX_HEX_BYTES = 16;

const SYSTEM_NAMES = {
  0xf0: "SysEx",
  0xf1: "MTC Quarter Frame",
  0xf2: "Song Position",
  0xf3: "Song Select",
  0xf6: "Tune Request",
  0xf8: "Clock",
  0xfa: "Start",
  0xfb: "Continue",
  0xfc: "Stop",
  0xfe: "Active Sensing",
  0xff: "Reset",
};

const pad2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

export function toHex(data) {
  const shown = [...data].slice(0, MAX_HEX_BYTES).map(pad2).join(" ");
  return data.length > MAX_HEX_BYTES ? `${shown} ... (${data.length} bytes)` : shown;
}

const noteLabel = (note) => `${noteName(note)} (${note})`;

export function describeMessage(data) {
  const msg = parseMidi(data);
  const hex = toHex(data);
  const channel = msg.channel + 1;

  switch (msg.type) {
    case "noteOn":
      return {
        kind: "note",
        name: "Note On",
        channel,
        detail: `${noteLabel(msg.note)}  vel ${msg.velocity}`,
        hex,
        hit: { note: msg.note, velocity: msg.velocity }, // what log.js tallies
      };
    case "noteOff":
      return { kind: "note", name: "Note Off", channel, detail: `${noteLabel(msg.note)}  vel ${msg.velocity}`, hex };
    case "cc":
      return { kind: "cc", name: "Control", channel, detail: `CC ${msg.controller}  value ${msg.value}`, hex };
    case "pitchBend":
      return { kind: "bend", name: "Pitch Bend", channel, detail: msg.value.toFixed(3), hex };
    case "polyAftertouch":
      return {
        kind: "pressure",
        name: "Key Pressure",
        channel,
        detail: `${noteLabel(msg.note)}  pressure ${msg.pressure}`,
        hex,
      };
    case "channelPressure":
      return { kind: "pressure", name: "Channel Pressure", channel, detail: `pressure ${msg.pressure}`, hex };
    case "programChange":
      return { kind: "program", name: "Program Change", channel, detail: `program ${msg.program}`, hex };
    default:
      return systemMessage(msg, data, hex);
  }
}

// Anything parseMidi does not decode. A status byte 0xF0 or above has no
// channel; a stray data byte (running status with no status) lands here too.
function systemMessage(msg, data, hex) {
  const name = SYSTEM_NAMES[msg.status] ?? `Unknown 0x${pad2(msg.status)}`;
  const detail = msg.status === 0xf0 ? `${data.length} bytes` : "";
  return { kind: "system", name, channel: null, detail, hex };
}

// One line of plain text for copying into a bug report or a chat.
export function formatLine(entry) {
  const seconds = (entry.time / 1000).toFixed(3).padStart(9);
  const channel = entry.channel === null ? "  " : String(entry.channel).padStart(2);
  return `${seconds}s  ch${channel}  ${entry.name.padEnd(16)} ${entry.detail.padEnd(26)} ${entry.hex}`.trimEnd();
}
