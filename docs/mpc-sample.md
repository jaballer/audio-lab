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
- **Velocity changes the loudness.** The owner heard the velocity 25 note as quieter than the velocity 127 ones, and
  heard it again in a repeat with samples assigned to pads 1 to 4 (see the third run below).

A second run, from Chrome on macOS with Web MIDI instead of ALSA, repeated the six notes and added note 36 on
channels 3, 9 and 16. The device played and echoed all of them on channel 1, which makes MIDI In Channel = All very
likely (the setting itself was still not read). Each note was scheduled with `output.send(bytes, t)` and the echo's
`timeStamp` compared with `t`: the note on came back 9.2 to 10.9 ms late every time, and the echoed note-off gaps were
within about 3 ms of what was sent. That is nine notes on an otherwise quiet device, so it says nothing about a busy
sequence. A steady lag of about 10 ms may include USB and driver delay, so a sequencer could send that much early.
Chrome on macOS names the port plain `MPC Sample`, for both the input and the output.

A third run, from Chrome again, with samples assigned to pads 1 to 4, looked at three more things:

- **Note length.** A 50 ms note and a 1 s note on pad 1 sounded the same: the owner described the pads as one-shots.
  So for one-shot pads the note-off does not shorten the sound, and a sequencer can send any note length. Not
  tried: a pad set to hold or gate, where the note-off may stop the sample.
- **Start and clock sent together with notes.** Start and 383 clock ticks at 120 BPM, with three notes during them:
  the notes came back as before (9 to 11 ms late, note-off gaps within 1 ms of what was sent). The same 383 to 384
  ticks, one Start and one Stop came back, which fits the device being slaved to our clock (see the transport
  section) and does not show that it repeats a clock it was not slaved to.
- **The device playing its own sequence.** Started from its Play button with nothing sent, the device sent its own
  clock at about 128 BPM (665 ticks in 13 s). Three notes sent over it were echoed with the same 10 ms lag and exact
  lengths, and the owner heard them play cleanly. Nothing from the device's own sequence appeared as notes on the
  port. This also shows the device sends its own clock when started from its hardware button, which the transport
  section left untried.

What the device's own buttons send, with nothing sent to it:

| Pressed | Sent by the device                                                                   |
| ------- | ------------------------------------------------------------------------------------ |
| Play    | Start (`FA`), song position 0 (`F2 00 00`), CC 7 = 90 (`B0 07 5A`), then clock ticks |
| Stop    | Stop (`FC`), then CC 64 = 0 (`B0 40 00`); the clock ends                             |

**A Stop, or a Stop and Start, from the device turns off held notes**, including notes the page sent: a note held for
500 ms was ended about 140 ms in by a restart, with its note-off echoed at that moment, and a Stop sends note-offs for notes
that had already ended. A sequencer should not expect a note to sound for its full length across a transport change on
the device. The meaning of CC 7 = 90 and CC 64 = 0 was not looked up; they arrive with every Play and Stop.

Not confirmed: whether a different sample per bank sounds different (the owner has samples on pads 1 to 4 of one bank
only). Not tried: Continue with clock, and MIDI Sync In set to Off or MTC.

### Seen on the running page, with the sequencer (2026-11-08, Chrome on macOS)

Pad 1 on steps 1, 5, 9, 11 and 13 at 120 BPM in a 4 s loop, the page's Play pressed with the device idle:

- **The notes sit on the device's beat grid.** The first note arrived with the first clock tick, 6 ms after the
  device's Start. The gaps were 500, 499, 253, 250 and then 2499 ms, which is what that pattern gives, the loop
  repeated every 4.0 s, and every echoed note landed 0 to 2 ms after a clock tick that starts a step.
  Each note-off came 98 to 101 ms after its note-on.
- **A note can sound after Stop.** A step queued ahead of the Stop click played 70 ms after the click, with its
  note-off 99 ms later, because Chrome 157 has no `MIDIOutput.clear()` (`typeof output.clear` is `undefined`), so
  what was queued cannot be dropped. The page also releases each pad at the time of the last queued note-off, which
  is when the stray note ends anyway, so it plays its full gate and is never left held. A Stop can therefore leave
  one extra hit of up to the lookahead.
- **The page's Play does nothing while the device is already running from its own button.** With the clock already
  streaming from the device, pressing the page's Play produced no Start and none of the pattern's notes; the page's
  Play works once the device is stopped. Seen once, without reading the page's lamp state.
- **A hit on the device's own pads plays the page's browser sound as well.** The page plays the sampler's sound for
  every pad hit that reaches it, so with samples on the device both sound at once. Only the echoes of the
  sequencer's own notes are filtered. Tracked in epic #63, phase 3 (#67).

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
