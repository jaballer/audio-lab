# Step editing for the sampler: design

The sampler has 16 pads (no banks) and a step sequencer whose steps are only on or off. This records why step editing
starts with per-step velocity, and how. The phases and their status are tracked in the GitHub epic
[#87](https://github.com/jaballer/audio-lab/issues/87), not here.

Editing the sounds themselves (trim, gain, pitch per pad) is a separate track, [#21](https://github.com/jaballer/audio-lab/issues/21).

## What constrains the design

- **The pattern is on/off only.** `shared/pattern.js` is a boolean grid. The MPC Sample page uses the same module, so
  velocity is added beside it: `isOn` stays boolean and existing callers keep working.
- **Playback already has a place for a gain.** In `apps/sampler/controller.js`, each step's hits go through a `bus`
  gain of their own (so they can be cut off on Stop). Only the live-hit path, `playSound` in `shared/sounds.js`,
  has a velocity stage. The sequencer needs the same, from one shared helper rather than two copies.
- **Live recording discards velocity.** `triggerPad(index, velocity)` receives it, but `recordHit` drops it.
- **Saved songs are at version 2** (sequences of one to eight bars). Storing velocity is version 3 with a migration,
  through the `MIGRATIONS` hook in `apps/sampler/song.js`.
- **The step keys show one bar at a time** (`setPage`), so any strip under them shows the same bar.
- **Step keys can only toggle.** There is no way to select a step without flipping it.
- **Pad selection already gives the editing context.** The selected pad is the row and the step is the column, so
  editing needs no banks. Banks only matter for more than 16 sounds.

## Decision: a velocity strip, not an Edit mode

A strip of vertical bars under the step keys, dragged to set. It needs no modes, works with mouse and touch, and shows
every value at once. An Edit mode (pick a step, turn the knob, as on the MPC) suits hardware but hides the values.
It is added only if the Launchpad or MPC should edit velocity too.

## Decisions made

- **Velocity is stored as 1-127** (MIDI, and what the MPC page sends) and converted to a 0-1 gain where it is played
  (`withVelocity` in `shared/sounds.js`).
- **Mouse first.** The strip is the way to edit; there is no Edit mode for the Launchpad or MPC yet. Add one when
  hardware should edit steps too.
- **Undo is per sequence and covers the steps**, not tempo, volume, length or which sequence is showing. Velocity
  changes made within a moment of each other (a drag) are one undo.
- **Copy and paste is one pad**, all bars, velocities included, and it can be pasted into another sequence.

## Later

More per-step settings (nudge, probability, ratchets) should not be ruled out by the velocity data shape: they would
be more sparse maps beside `velocities`, in the same version of the song. Banks, only if more than 16 sounds are
wanted. See the epic for what is left.
