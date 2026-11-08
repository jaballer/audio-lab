# Sequencer: what is shared and what is not

The MPC Sample page (`apps/mpc-sample/`) is getting a step sequencer like the sampler's. This records the design
decision behind it. The phases and their status are tracked in the GitHub epic
[#63](https://github.com/jaballer/audio-lab/issues/63), not here.

## Decision: extract the generic pieces, do not build one global sequencer

The sampler's sequencer was mostly generic, so its pieces now live in `shared/` (done in epic #63, phase 1):

- `shared/pattern.js`: a pure rows × steps grid. The sampler's starter beat stayed behind in
  `apps/sampler/starter-beat.js`.
- `shared/tempo.js`: BPM clamp, step length, tap tempo, `nearestStep`.
- `shared/scheduler.js`: the lookahead scheduler, renamed from `transport.js`. It takes a `clock`
  (`{ now(), prepare?() }`) instead of the audio engine, so it can run in audio time or in MIDI time.
  `markHeard` stayed in it: it is tied to which step is next and to steps skipped after a stall, and any page that
  records live pad hits needs it.

- `shared/step-keys.js` + `shared/step-keys.css`: the step-key view, with its classes renamed from the sampler's
  unscoped `.cell`, `.step`, `.led`, `.step-group` to `step-keys-*` (see "Class names are scoped to the page" in
  `CLAUDE.md`). The sampler passes its own group size; each page that uses it imports the stylesheet.

Still to be shared when a second page needs it:

- `apps/sampler/song.js`: persistence, tied to the sampler's storage key and volume field. Stays app-specific until
  it is generalised on its own.

One module that owns pattern, clock, sounds, recording and saving would be the sampler's `controller.js`, which is
mixed in with pad selection, LCD messages and Launchpad lights. Each app keeps its own controller; they share the
parts underneath. The view is shared when the second page needs it, so its API comes from two real users.

## Why the MPC page cannot just reuse the sampler's transport

1. **Name clash.** `apps/mpc-sample/transport.js` follows the device's state from its MIDI clock; the sampler's
   `transport.js` is a scheduler. The shared one is called `scheduler.js`.
2. **Different clocks.** The sampler schedules in `AudioContext` time. The MPC page's `clock-master.js` queues MIDI
   ticks in `performance.now()` time. The shared scheduler takes an injected clock, and `onStep(step, time)` is the
   seam between the scheduler and whatever plays the step (the device over MIDI, the browser's sounds, or both).
3. **Who leads.** The device is a clock slave when started from the page (it needs Start plus a steady clock, see
   `docs/mpc-sample.md`) and the master when started from its own Play button. The pattern grid is the same either
   way; what triggers a step differs.

## The open question, answered by measurement

Whether the device plays notes the page sends it (Pad MIDI In = On) was measured, see `docs/mpc-sample.md`: it plays
them (tried on channels 1, 2, 3, 9 and 16, and on banks A and B), and echoes each back as a pad hit on channel 1. The page's sequencer therefore
sends the device its notes (`apps/mpc-sample/sequencer.js`) and `echo-guard.js` keeps the page from playing its own
sound on top of those echoes. The browser's sounds remain a second output for a later phase (epic #63, phase 3).
