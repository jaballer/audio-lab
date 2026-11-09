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

## Open decisions

- Mouse first, or hardware first? This decides whether the strip phase includes an Edit mode.
- Velocity stored as 0-1 (what `triggerPad` takes) or 1-127 (MIDI, and what the MPC page sends)? Decided in phase 1.

## Later

More per-step settings (nudge, probability, ratchets) should not be ruled out by the velocity data shape. Copy and
paste of a pad's pattern, undo, and banks are in the epic's last phase.
