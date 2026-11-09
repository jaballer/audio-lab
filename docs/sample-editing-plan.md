# Step editing for the sampler: design

The sampler has 16 pads (no banks) and a step sequencer whose steps, when this was written, were only on or off. This records why step editing
starts with per-step velocity, and how. The phases and their status are tracked in the GitHub epic
[#87](https://github.com/jaballer/audio-lab/issues/87), not here.

Editing the sounds themselves (trim, gain, pitch per pad) is a separate track, [#21](https://github.com/jaballer/audio-lab/issues/21).

## What constrained the design

These describe the code when the work began. Since then (#94 and after) the pattern stores a velocity per step
(`shared/pattern.js`, 1-127, beside the booleans), saved songs are at version 4 (velocity, then per-pad settings), the
sequencer's hits go through `withVelocity` and `withGain`, and recording keeps the velocity of the hit.

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
- **Copy and paste is one bar of one pad** (the bar showing), velocities included, and it can be pasted onto another
  bar, pad or sequence; pasting onto the next bar of the same pad is how a bar is repeated (#98). It began as a whole pad.

## Later

More per-step settings (nudge, probability, ratchets) should not be ruled out by the velocity data shape: they would
be more sparse maps beside `velocities`, in the same version of the song. Banks, only if more than 16 sounds are
wanted. See the epic for what is left.

## The pad editor drawer

Options for a pad (its sound, gain, pitch, and what comes next) live in a drawer of their own, not around the pads,
as on a hardware sampler where they are on a screen of their own.

- **Opened with an Edit Pad button, not by clicking a pad.** Clicking a pad plays it, and a panel that opened on
  every hit would be in the way of playing. While it is open, hitting any pad selects it and the drawer follows.
  Dropping a file on a pad works with it closed. Whether it is open is remembered.
- **Beside the machine when the window is at least 1180px wide, under the pads otherwise.** It never covers the pads
  or the step keys, which are what you are listening to while you edit. `main.js` moves the one element, as it
  does the display.
- **Not a dialog.** Playing goes on while it is open, so focus is not trapped. It is a labelled region opened by a
  button that says whether it is open. Opening it with the button moves focus to its heading (so a keyboard user
  is in it however far it sits from the button); Escape, with focus inside it, closes it and returns to the
  button. Moving it between its two places keeps focus on the control that had it.
- **Sections, not tabs, for now.** Sound and Tune. Tabs when there are enough sections to need them.
- **Where later features go.** Waveform and trim, reverse, one-shot or hold, a voice limit, an amp
  envelope and pan each become a section drawn into the drawer by a view of its own.

## Trim

A loaded sample has a start and an end, set in the pad editor from the waveform: drag the picture (the nearer handle
follows) or use the Start and End sliders, which are native range inputs so the keyboard and a screen reader have all
of it. Delete or a double-click puts a handle back.

- **Fractions of the sample's length, not seconds**, so a trim means the same whatever rate the file was decoded at.
  Kept possible: inside the sample, and never shorter than 5 ms (a shorter window is a click, not a sound). The handle
  being dragged is the one held back when the two would meet.
- **Kept with the sample, not the song:** in the map `samples.js` already keeps (`trim` beside `name` and `bytes`),
  and only for a sample that is trimmed. A new sample starts at all of it; Default Sound drops it.
- **Played with `start(when, offset, length)`** on the buffer source, so nothing is copied or re-decoded. The length is
  in the sample's own time, so a pitched sample is over sooner (the fade is worked out from the time it is heard).
- **Fades of 3 ms where it is cut:** in where the start is not the start of the file, out where the end is not the end
  of it, through a gain stage of the hit's own. A window shorter than twice the fade shortens it to fit. An untrimmed
  sample plays exactly as before, with no extra node.
- **The waveform is made once per sample** (400 columns of the lowest and highest value, all channels) and drawn at
  whatever size the drawer has, again when that changes.
- Built-in sounds are synthesized, so they have no waveform and the trim controls are hidden for them.

## Choke groups

A pad has a choke group, 0 (none) or 1 to 8, set with a Choke slider in the pad editor (#112). Pads in the same group cut each other off, as a closed hat cuts an open hat; a pad always cuts its own earlier hit, in a group or not (`apps/sampler/voices.js`).

- **A setting like Gain and Pitch:** it is in `pad-settings.js`, kept in the kit, saved in the song's `padSettings` (song version 5; a version 4 song has no groups), shown on the LCD (`PAD 03 CHOKE GROUP 1`), and not part of the step undo history.
- **Symmetric:** any pad in the group cuts the others; there is no "this pad cuts that one but not the reverse".
- **Two pads of a group on the same step:** each cuts the other from that moment, silenced outright (not faded: a fade would let the first milliseconds through), so the pad handled last, the higher pad number, is the one heard.
- **Read when the hit starts:** the group a pad is in when a hit begins decides what it cuts, so moving a pad into a group takes effect from the next hit (for a step already handed to the audio clock, up to about 120 ms ahead, from the one after it). A step queued ahead does not cut a live tap made after it was queued, within that window; the pad's own retrigger cut has the same limit.
- **Same machinery as the retrigger cut:** a fade on the audio clock, from the new hit's start time, with the earliest-cut bookkeeping and the undo for a queued step that is cancelled (Stop, a sequence switch). Live hits, the sequence and the WAV export all use it.
- **Not decided here:** default groups for the built-in kit (the hats) are not set, so a fresh kit behaves as before; showing the group on the pad, and sharing swatches with pad colours (#122), are separate.

## Pad colours

A pad can be given a colour in the pad editor (a row of swatches under Tune), to tell pads apart by your own grouping: drums, loops, bass, one-shots (#122).

- **A fixed set of eight colours, plus none** (`pad-colors.js`), not a free picker. Each is chosen to be seen against a pad's face (at least 3:1, checked by a test) and kept clear of the orange selection ring and the red hit light, so it can never be mistaken for either. The value kept is the swatch number, so a colour can be added at the end of the list but not reordered.
- **How it shows:** the pad's rim (the ring just inside its edge) takes the colour, and the face stays dark, so the number, key and name keep their contrast. The selection ring and the hit light sit inside the rim, and the rim stays through a hit's light.
- **Not the colour alone:** the pad's tooltip says the colour's name, and the swatches have names; the chosen swatch has a thick dark ring, apart from the blue focus ring, and is marked with the system highlight in forced-colours mode.
- **For a screen reader:** the pad's label ends with the colour's name (`Pad 3, Kick, key C, blue`), and each swatch has its name; the group of swatches is a radio group (arrow keys, Home and End).
- **A pad setting like Gain, Pitch and Choke** (`pad-settings.js`, the kit, the song's `padSettings`; song version 6, a version 5 song has no colours), shown on the LCD (`PAD 03 COLOR BLUE`), not part of the step undo history. It belongs to the pad, so Default Sound does not clear it. It has no effect on playback or the export.
- **Not decided here:** default colours for the built-in kit, a swatch beside the pad editor's heading, mapping a colour to a Launchpad's LEDs (only red, green and amber), and naming a group.
