// Decode a raw MIDI message ([status, data1, data2]) into a plain object, so
// apps match on `msg.type` instead of masking status bytes by hand.
//
//   { type: "noteOn",    channel, note, velocity }   velocity 1-127
//   { type: "noteOff",   channel, note, velocity }   also a Note On with velocity 0
//   { type: "cc",        channel, controller, value }
//   { type: "pitchBend", channel, value }            -1 .. 1
//   { type: "polyAftertouch",  channel, note, pressure }   pressure on one held key or pad
//   { type: "channelPressure", channel, pressure }         one pressure value for the channel
//   { type: "programChange",   channel, program }
//   { type: "other",     channel, status, data1, data2 }   system messages (clock, sysex...)
//
// `channel` is 0-15 (so MIDI "channel 10", the drum channel, is 9).

export function parseMidi([status, data1 = 0, data2 = 0]) {
  const channel = status & 0x0f;
  switch (status & 0xf0) {
    case 0x90:
      if (data2 > 0) return { type: "noteOn", channel, note: data1, velocity: data2 };
    // Note On with velocity 0 is a Note Off by convention.
    // falls through
    case 0x80:
      return { type: "noteOff", channel, note: data1, velocity: data2 };
    case 0xa0:
      return { type: "polyAftertouch", channel, note: data1, pressure: data2 };
    case 0xb0:
      return { type: "cc", channel, controller: data1, value: data2 };
    case 0xc0:
      return { type: "programChange", channel, program: data1 };
    case 0xd0:
      return { type: "channelPressure", channel, pressure: data1 };
    case 0xe0:
      // 14-bit value, centre at 8192.
      return { type: "pitchBend", channel, value: ((data2 << 7) | data1) / 8192 - 1 };
    default:
      return { type: "other", channel, status, data1, data2 };
  }
}
