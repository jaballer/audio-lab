# Akai MPC Sample: reference notes

What we know about the device's MIDI behaviour, and where it comes from, so the next change to
`apps/mpc-sample/` does not start from a web search. Notes in our own words; the originals are linked.

## Official documentation

- [User Guide v1.0 (PDF)](https://cdn.inmusicbrands.com/akai/sample/MPC%20Sample%20-%20User%20Guide%20-%20v1.0.pdf):
  the MIDI Configuration table is on printed page 60. The PDF's text can be extracted with `pdftotext -layout`.
- [MIDI Configuration (web guide)](https://www.akaipro.com/guides/mpc-sample/midi_configuration.htm): the same table as a page.

Checked on 2026-11-08 against the PDF above. Akai may revise the guide, so recheck a version before relying on a gap below.

## MIDI Config menu

Open it with Shift + Pad 8 (MIDI Config), then turn and press the encoder.

| Setting                | Values               | What it does                                          |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| MIDI Port              | External, USB        | The one port used for both sending and receiving MIDI |
| MIDI In Channel        | All, 1-16            | Channel(s) accepted on input                          |
| MIDI Out Channel       | 1-16                 | Channel used for output                               |
| Pad MIDI In            | Off, On              | Whether incoming MIDI can trigger the pads            |
| Pad MIDI Out           | Never, Always, Empty | Whether the pads send MIDI                            |
| MIDI Sync In           | Off, Midi Clock, MTC | Whether, and how, it follows incoming sync            |
| MIDI Sync Out          | Off, Midi Clock, MTC | Whether, and how, it sends sync                       |
| MIDI Thru              | Off, On              | MIDI received at MIDI IN is also sent out MIDI OUT    |
| Receive Program Change | Off, Sequence        | Program Change messages can trigger sequences         |
| CV/Sync Out, Base, Div | Off/On, 1-8, 1-24    | Analogue sync pulses from the SYNC OUT jack           |

The hardware's own Play button starts a sequence from the beginning; Shift + Play (Continue) resumes from the current position.

## What the guide does not say

- It does not say whether the device acts on incoming MIDI **Start, Stop or Continue**, or on **MMC** (MIDI Machine
  Control, SysEx). The only transport-related settings are MIDI Sync In/Out (Midi Clock, MTC).
- It has no MIDI implementation chart, so what the device sends is known only from capture (below).

## Measured: what the device does with transport messages

Tried on 2026-11-08 over USB (MIDI Port = USB), sending through the ALSA sequencer and recording what came back.
MIDI Sync In was set to Midi Clock (confirmed by the owner).

| Sent to the device                     | Result                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Stop (`0xFC`)                          | Works. Stopped, it rewinds: it reports song position 0                                            |
| Start (`0xFA`) alone                   | Ignored: no reply, no clock                                                                       |
| Continue (`0xFB`) alone                | Ignored                                                                                           |
| Start, then clock ticks (`0xF8`)       | Plays: it reports Start, position 0 and MMC play, then streams its own clock                      |
| Start, a few ticks, then no more ticks | Plays while the ticks last, then stops itself about 0.7 s after the last one                      |
| MMC Deferred Play as SysEx             | No reply, but inconclusive: it did not answer an identity request either, so the send is unproven |

So the device is a clock slave: **a bare Start does not start it, it starts on the first tick after Start and keeps
going only while ticks keep arriving, at the tempo of those ticks.** A Play button that works means the page sends
Start and then a steady clock for as long as it plays (and so sets the device's tempo); `apps/mpc-sample/clock-master.js` does that. Ticks sent after a Stop do not restart it. Not tried: Continue with
clock, MIDI Sync In set to Off or MTC, and the page's own Play while the device was started from its hardware button.

## Measured: what the device does with notes sent to it

Tried on 2026-11-08 over USB with Pad MIDI In = On and Pad MIDI Out = Always (both confirmed by the owner), twice
with the same results. Six single notes, two and a half seconds apart, sent to the device's ALSA sequencer port as a
Standard MIDI File with `aplaymidi -p 28:0`, while `aseqdump -p 28:0` recorded what the device sent back. Writing to
the raw port (`amidi -p hw:3,0,0`) fails with "Device or resource busy" whenever a browser has MIDI open, so send
through the sequencer.

| Sent                                    | Heard (owner) | Sent back by the device                                |
| --------------------------------------- | ------------- | ------------------------------------------------------ |
| note 36, velocity 127, off after 1 s    | played        | note on 36 / 127, then note off after 1.0 s            |
| note 36, velocity 25, off after 1 s     | played        | note on 36 / 25, then note off after 1.0 s             |
| note 36, velocity 127, off after 50 ms  | played        | note on 36 / 127, then note off after 50 ms            |
| note 36 on **channel 2**, off after 1 s | played        | note on 36 on **channel 1**, then note off after 1.0 s |
| note 52 (bank B, pad 1), off after 1 s  | played        | note on 52, then note off after 1.0 s                  |
| note 36, velocity 127, off after 300 ms | played        | note on 36 / 127, then note off after 300 ms           |

What this shows:

- **The device plays notes it is sent**, on a channel other than 1 as well, and on a note outside bank A. Notes map
  to pads as in `shared/mpc-sample.js` (`noteForPad`).
- **It echoes them back.** Every note arrives on its input as a note on and a note off with the velocity and the
  note kept, the channel rewritten to its MIDI Out Channel (1), and our timing kept. A page that sends the
  device notes therefore also receives each one as a pad hit: `padDown` events, the pad grid lighting up, and the
  page's own browser sound for the pad playing on top of the device's. Whatever plays notes from the page has to
  handle that, for example by ignoring hits that arrive just after a note the page sent.
- The channel rewrite means this is not MIDI Thru (which would keep channel 2) and that MIDI In Channel accepts at
  least channels 1 and 2 (probably All). Its value was not read from the device.

Not confirmed, because it cannot be told from the log and was not reported by ear: whether velocity changes the
loudness, and whether a short note-off cuts the sample short or the pad plays out as a one-shot. The owner could not
tell the banks' sounds apart, so a different sample per bank is also unconfirmed. Not tried: how accurately a
timestamped `output.send(bytes, t)` lands in a browser, whether sending Start and clock at the same time changes
any of this, and what happens while the device is also playing its own sequence.

## What the device sends, captured

From `apps/mpc-sample/devices.js` (captured from a real device):

- Pads: note on/off with velocity and poly aftertouch for pressure; the note depends on the pad bank
  (`shared/mpc-sample.js`).
- Play: Start, song position 0, MMC SysEx, then a clock stream. Shift + Play (Continue) sends Continue and the position
  it resumes from. Stop sends Stop and the clock ends. Idle, it sends no clock.
- The MMC copies are left unread: real-time bytes reach the browser without the SysEx permission.
- Pad events only reach the browser with MIDI Port = USB and Pad MIDI Out = Always.

## Port names

Browsers decorate port names (Firefox on Linux: `client:port MIDI 1 28:0`; Windows can prefix `2- `), so match on the
model name and allow the decoration. See "Testing with MIDI hardware" in `CLAUDE.md`.
