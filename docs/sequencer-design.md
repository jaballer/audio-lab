# Sequencer: what is shared and what is not

The MPC Sample page (`apps/mpc-sample/`) is getting a step sequencer like the sampler's. This records the design
decision behind it. The phases and their status are tracked in the GitHub epic
[#63](https://github.com/jaballer/audio-lab/issues/63), not here.

## Decision: extract the generic pieces, do not build one global sequencer

Most of the sampler's sequencer is already generic and only lives under `apps/sampler/`:

- `pattern.js`: a pure rows × steps grid. Only `STARTER_BEAT` is sampler-specific.
- `tempo.js`: BPM clamp, step length, tap tempo, `nearestStep`.
- `transport.js`: the lookahead scheduler. Generic apart from `markHeard`, which only live recording uses.
- `steps.js`: the step-key view. Its classes (`.cell`, `.step`, `.led`, `.step-group`) are not page-prefixed, so
  sharing it means renaming them (see "Class names are scoped to the page" in `CLAUDE.md`).
- `song.js`: persistence, tied to the sampler's storage key and volume field. Stays app-specific until it is
  generalised on its own.

One module that owns pattern, clock, sounds, recording and saving would be the sampler's `controller.js`, which is
mixed in with pad selection, LCD messages and Launchpad lights. Each app keeps its own controller; they share the
parts underneath. The view is shared when the second page needs it, so its API comes from two real users.

## Why the MPC page cannot just reuse the sampler's transport

1. **Name clash.** `apps/mpc-sample/transport.js` follows the device's state from its MIDI clock; the sampler's
   `transport.js` is a scheduler. The scheduler is renamed `scheduler.js` when it moves to `shared/`.
2. **Different clocks.** The sampler schedules in `AudioContext` time. The MPC page's `clock-master.js` queues MIDI
   ticks in `performance.now()` time. The shared scheduler takes an injected clock, and `onStep(step, time)` is the
   seam between the scheduler and whatever plays the step (the device over MIDI, the browser's sounds, or both).
3. **Who leads.** The device is a clock slave when started from the page (it needs Start plus a steady clock, see
   `docs/mpc-sample.md`) and the master when started from its own Play button. The pattern grid is the same either
   way; what triggers a step differs.

## Open question, answered by measurement

Whether the device plays notes the page sends it (Pad MIDI In = On) is not measured yet. If it does not, or it
echoes the notes back as pad hits, the page falls back to the browser's sounds and the shared pieces above still
apply. The results go in `docs/mpc-sample.md`.
