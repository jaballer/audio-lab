# The sampler: design decisions

Why the sampler (`index.html`, `apps/sampler/`) works the way it does: the beat and its sequences, the song, step velocity, the pad
editor and each pad setting. What it can do is in the [README](../README.md); where each file is, in
[architecture.md](architecture.md); the export, in [export.md](export.md). Work still to do is tracked in the GitHub
issues (song mode [#159](https://github.com/jaballer/audio-lab/issues/159), step editing
[#87](https://github.com/jaballer/audio-lab/issues/87), sound editing [#21](https://github.com/jaballer/audio-lab/issues/21)),
not here.

## The beat

What `beat.js` keeps, and `controller.js` plays. In the code, as on the page, the **beat** is everything that is saved (the
sequences, the arrangement, tempo, swing, volume and pad settings), and the **song** is the chain of sequences that Song
mode plays (#159 step 5 renamed the first from `song` to `beat`, so the two no longer share a name). Only what is already
stored keeps the old name: the storage key, the saved field `loopSong` and a project file's `song`.

- **Sequences.** A beat starts with one sequence and has up to eight (`MAX_SEQUENCES` in `layout.js`), each 1, 2, 4 or 8
  bars of 16 steps, with its own pattern and velocities. Tempo, swing and volume belong to the beat, not to a sequence.
- **Switching while playing.** A sequence key queues that sequence to take over at the end of the pass (`queueSequence`,
  through the scheduler's `onWrap`), so the beat never jumps mid-bar, and Shift switches at once. That is with the Next
  latch on, as it is until a person turns it off; with Next off the two swap, a press switches at once and Shift waits, so
  turning Next off is how a touch screen, which has no Shift, switches at once (`pressIsNow` in `sequence-row.js`). This is Pattern mode,
  the one the page loads in. In Song mode (below) the keys do not switch the sound at all.
- **What plays and what shows** are kept apart in the controller. `current` is the sequence the step keys, the step editor and the
  sequence keys are about (with its `pattern`, `history`, `bars` and `page`); `playing` is the slot of the one the scheduler builds steps
  from and the display says sounds (`playingIndex()` gives its number: the slot itself is kept because a number moves when a sequence is
  removed). In Pattern mode they are the same sequence: every pick, switch and takeover
  goes through `adoptSequence`, which sets both, so a person sees and edits what plays. In Song mode they can differ (the song plays one
  sequence while another is edited): a pick is `showOnly`, a takeover moves `playing` alone, and Stop, or turning Song mode off, brings
  them together again (`mirrorPlaying`, `followPlaying`). A read about sound (the steps built, the length of a pass, the sequence the song or a queue
  goes on from, a live hit recorded, `heard`) uses `playing`; a read about the editor uses `current`.
- **The arrangement** (`arrangement.js`) is the order a song plays its sequences in, each with repeats. `null`, the default,
  means every sequence once, in order, so it cannot fall out of step with the sequences until a person edits it; the first edit
  makes it explicit, and from then on a sequence added gets an entry at the end and one removed takes its entries with it.
- **The Song panel** (`chain-strip.js`, #159 step 4b) edits it: a cell for each entry, with its sequence and its repeats, and
  tools to add the sequence showing, remove, move and repeat the entry selected. Selecting an entry only selects it (`selectEntry`: the
  controller's `selectedEntry`, since Song mode begins at it), so nothing about what plays changes. The controller does the editing (`addEntry`, `removeEntry`,
  `moveEntry`, `setEntryRepeats`) through the pure edits in `arrangement.js`, and keeps where the song is on its entry through
  them (a position that pointed at an entry follows it), so a song that is playing goes on from where it was and hears the edit at
  the end of the pass. An edit made in the moment before that downbeat (after the scheduler has reached the pass end and before its
  first step has sounded, up to a quarter of a second at 100 BPM) counts at it, as a press on a sequence key does
  (`reconsiderPassEnd`: what the song picked for that pass end is worked out again, and the steps built for it are taken back and
  built again if it is another). The entry playing is marked from `songPass`, which leads what is heard by the lookahead as the sequence
  keys do. No undo, as for the sequences' own list.
- **Song mode** (the Song key, `toggleSong`; #159 step 4b, replacing the All key that played every sequence in order) goes by the
  arrangement: the controller keeps where the song is (`songAt`) and `nextPass` says which pass follows the one that ended (the next
  time round the entry if it repeats, else the next entry), and the song ends after its last pass unless Loop is on (below). Song mode is off on
  every load and is not saved, and a song that plays saves nothing as it goes. The decisions, each asked of the person who wanted it:
  - **Play begins at the entry selected** in the Song panel, at its first time round (the first entry when none was picked),
    wherever the editor is.
  - **The editor stays put while the song plays.** The sequence keys only show a sequence there, with no effect on the sound (a song
    is jumped by selecting an entry and pressing Play), so the Next latch has nothing to do and is disabled. The panel marks what
    plays, and the step keys have no cursor while what shows is not what plays. A hit played live, or recorded, goes into what plays
    (`playing`), as it sounds. Edits to the step keys are to what shows, heard when that sequence comes round.
  - **Turning Song mode off while it plays** goes on as a loop of the sequence that was playing, and the editor jumps to it
    (`followPlaying`); turning it on goes on playing what played, until the end of its pass, then the song's next pass.
  - **Stop** leaves the editor where it is, and what plays becomes the sequence showing again (`mirrorPlaying`). The next Play begins at
    the entry selected, as always, and the display says so (below).
  - **The song ends after its last pass, unless Loop is on** (#159 step 4c). `isLastPass` says which pass is the last (the last time
    round the last entry), and with Loop off, which is how a song is until a person turns it on, the pass end after it is the end: `onWrap`
    tells the scheduler `endAt(time)`, which stops queuing steps but goes on playing until the clock reaches that time, so that the last
    step (handed to the audio clock up to the lookahead early) is not cut off and what the display marks is what sounds until the end. Then
    the scheduler stops itself and `onEnd` says `END OF SONG` and redraws, as a stop does: what rings goes on, and Stop pressed again cuts it.
    Calling `stop()` from `onWrap` instead would have taken those last steps back. Play begins at the entry selected again, as after Stop; the
    editor and the selection stay where they were. With Loop on the last pass is followed by the first entry, as the song always was before
    it could end. A pass that is in no entry (its sequence was removed while it played) is not the last: the chain takes the first entry after
    it, and the song ends at its own end. Only Song mode ends: a beat that is not in Song mode is a loop of the sequence showing, whatever Loop
    says, and Export ignores Loop (the file is the song once through).
  - **Loop is a key in the Song panel** (`toggleLoop`, `loopSong`). It is a setting of the song and not of the visit, so, where Song mode is
    not kept, it is saved with the beat (saved format 11; left out while off, so a song that never had Loop on is saved as before). Off is
    the default, as decided for the epic: a song that is played once through is what a person who has made one expects, and a loop is a choice.
  - **The end can be changed in the moment before it sounds**, as a press on a sequence key can (the scheduler has reached the pass end
    and its first step has not sounded, up to a quarter of a second at 100 BPM): Loop turned on or off, an entry added, removed, moved or
    given more or fewer repeats, a sequence added, copied or removed (a new one comes after the last, and so changes which pass is the last), and Song mode
    turned on all count at that pass end (`reconsiderPassEnd`, `chainAtOpenPassEnd`). What was
    built after the pass end is taken back (`takeBackBuilt`) and the run ends there (`endSongLate`), or the end is taken back
    (`scheduler.endAt(null)`) and the song goes on, from the sequence that ended or by a takeover. Song mode turned off ends nothing: what was
    playing goes on as a loop, unless the clock has already reached the end (the scheduler stops itself at its next tick, up to 25 ms later, and
    it is too late to take back: `endAt(null)` ignores it). The scheduler takes an end back by itself when it goes back over the pass end (`rewindTo`: a rebuild of the
    steps is told of the pass end again and decides it once more, as for a repeat), when a pass begins (`startPass`) and when a loop made
    longer carries on past it (`setSteps`).
  - **The LCD has a screen for each mode** (`SCREENS` in `lcd.js`, chosen by `screenFor`, each a pure function of the state that gives the
    five lines; the display is five lines tall and the level meter beside it is sized to them). The pattern screen is the sequence,
    the pad, the tempo, the bar and the step. The song screen keeps the first three lines' jobs (`SONG 02/05  PLAYING`, where the
    first number is the entry of the song, then the pad and the tempo) and puts in the places of the bar and the step, which the
    timeline along the bottom of the display already says, the sequence that plays with the time round its entry (`SEQ 03  REPEAT
2/4`) and the sequence that comes next (`NEXT SEQ 01`, or `NEXT END` in the last pass of a song that ends there). Stopped, it says where Play would begin, the entry selected. A stopgap
    towards a screen of its own for the song, as the display will have a screen for each function. The controller says where the song
    is in `getState().heard.song` (`heardSong`): what sounds, not the pass the scheduler has begun (the strip's `songPass` leads
    by the lookahead, the display does not, as for `heard.sequence`); a place not known (Song mode joined in mid-pass) is the first
    entry that names the sequence, as the chain takes it, and is blank when no entry does.
  - Export's Song choice reads the arrangement (`songPasses` in `export-wav.js`, from `passOrder`): every entry in order, each as often
    as it repeats, and a sequence the song leaves out is not in the file. A song longer than 400 s (`MAX_SONG_EXPORT_SECONDS`) is
    too long to export, and the dialog says so; `docs/export.md` has the reasons.
- **Starters** (`starters.js`) are whole beats to begin from (tempo, swing, patterns, choke groups, colours). The pads'
  sounds are the same in every starter: a starter changes the beat, not the kit.
- **Swing** is 50 (straight) to 75: how much of each pair of steps the first takes, so the second sounds later
  (`shared/tempo.js`). The live scheduler and the export both apply it.
- **Saved as a versioned shape.** Every change to what is saved bumps `BEAT_VERSION` and adds a migration, so a beat saved
  by an older page still loads, and a beat from a newer page is left alone rather than misread. The storage key is still
  `pad-sampler:song`, the project's old name: renaming it would orphan every saved beat.

## Step velocity

A step has a velocity, 1-127, beside its on/off (`shared/pattern.js`; `isOn` stays boolean, so the MPC Sample page, which
shares the module, kept working).

- **A strip, not an Edit mode.** Vertical bars under the step keys, dragged to set: no modes, mouse and touch both work, and
  every value shows at once. An Edit mode (pick a step, turn the knob, as on the MPC) suits hardware but hides the values;
  add one only when the Launchpad or MPC should edit steps.
- **Stored as MIDI velocity, played as a gain** (`withVelocity` in `shared/sounds.js`), by live hits and the sequencer
  alike. Recording keeps the velocity of the hit.
- **Undo is per sequence and covers the steps**, not tempo, volume, length or which sequence is showing. Velocity changes
  made within a moment of each other (a drag) are one undo.
- **Copy and paste is one bar of one pad** (the bar showing), velocities included, onto another bar, pad or sequence;
  pasting onto the next bar of the same pad is how a bar is repeated (#98).
- **Later:** more per-step settings (nudge, probability, ratchets) would be more sparse maps beside `velocities`. Banks only
  if more than 16 sounds are wanted.

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
- **Sections, not tabs, for now.** Sound, Tune, Envelope, Mix, Listen (Mute and Solo) and Color. Tabs when there are enough sections to need them.
- **Where later features go.** Reverse, one-shot or hold and a voice limit each become a section drawn into the drawer by a view
  of its own. Filter, Pan and the sends to the reverb and delay are under Mix.

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

- **A setting like Gain and Pitch:** it is in `pad-settings.js`, kept in the kit, saved in the beat's `padSettings` (beat version 5; a version 4 beat has no groups), shown on the LCD (`PAD 03 CHOKE GROUP 1`), and not part of the step undo history.
- **Symmetric:** any pad in the group cuts the others; there is no "this pad cuts that one but not the reverse".
- **Two pads of a group on the same step:** each cuts the other from that moment, silenced outright (not faded: a fade would let the first milliseconds through), so the pad handled last, the higher pad number, is the one heard.
- **Read when the hit starts:** the group a pad is in when a hit begins decides what it cuts, so moving a pad into a group takes effect from the next hit (for a step already handed to the audio clock, up to about 120 ms ahead, from the one after it). A step queued ahead does not cut a live tap made after it was queued, within that window; the pad's own retrigger cut has the same limit.
- **Same machinery as the retrigger cut:** a fade on the audio clock, from the new hit's start time, with the earliest-cut bookkeeping and the undo for a queued step that is cancelled (Stop, a sequence switch). Live hits, the sequence and the WAV export all use it.
- **Not decided here:** default groups for the built-in kit (the hats) are not set, so a fresh kit behaves as before; showing the group on the pad, and sharing swatches with pad colours (#122), are separate.

## Pad colours

A pad can be given a colour in the pad editor (a row of swatches at the end of the pad editor), to tell pads apart by your own grouping: drums, loops, bass, one-shots (#122).

- **A fixed set of eight colours, plus none** (`pad-colors.js`), not a free picker. Each is chosen to be seen against a pad's face (at least 3:1, checked by a test) and kept clear of the orange selection ring and the red hit light, so it can never be mistaken for either. The value kept is the swatch number, so a colour can be added at the end of the list but not reordered.
- **How it shows:** the pad's rim (the ring just inside its edge) takes the colour, and the face stays dark, so the number, key and name keep their contrast. The selection ring and the hit light sit inside the rim, and the rim stays through a hit's light.
- **Not the colour alone:** the pad's tooltip says the colour's name, and the swatches have names; the chosen swatch has a thick dark ring, apart from the blue focus ring, and is marked with the system highlight in forced-colours mode.
- **For a screen reader:** the pad's label ends with the colour's name (`Pad 3, Kick, key C, blue`), and each swatch has its name; the group of swatches is a radio group (arrow keys, Home and End).
- **A pad setting like Gain, Pitch and Choke** (`pad-settings.js`, the kit, the beat's `padSettings`; beat version 6, a version 5 beat has no colours), shown on the LCD (`PAD 03 COLOR BLUE`), not part of the step undo history. It belongs to the pad, so Default Sound does not clear it. It has no effect on playback or the export.
- **Not decided here:** default colours for the built-in kit, a swatch beside the pad editor's heading, mapping a colour to a Launchpad's LEDs (only red, green and amber), and naming a group.

## Filter and pan

Each pad has a Filter and a Pan, under Mix in the pad editor (#187, phase 2). They act on what comes out of the pad, so they
work on a built-in sound as well as a loaded sample (unlike Pitch and the envelope, which need a sample).

- **One filter control, two filters.** The slider runs from -100 to +100 with an off in the middle: left of it is a low-pass
  (the cutoff comes down from the top of hearing to 80 Hz, so the sound darkens), right of it a high-pass (the cutoff goes up
  from 20 Hz to 8 kHz, so it thins out), as on a DJ filter. Each is an equal ratio for an equal step (`scales.exp`), so the sweep
  feels even. One control and not a cutoff and a type: it is what a person reaches for, and the two never want to be on
  together. The Q is a Butterworth's (the flattest bend, no bump at the cutoff); resonance is not offered.
- **Three paths, crossfaded, and no filter is ever retyped.** A strip has the dry sound, a low-pass and a high-pass side by
  side, each through a gain; the Filter setting turns one gain up and the other two down. Off is the dry path alone, the sound
  exactly as it is (measured: the output equals the input to float rounding, 3e-17). A single biquad that changed from
  low-pass to high-pass as the slider crossed the middle was tried first, and measured to tick: changing the type of a
  `BiquadFilterNode` that is playing resets its memory, and on a steady tone that left a step of about 8 % of the peak for 5 ms
  (low-pass) and 2 % over 50 ms (high-pass). Both filters are made once, as what they are, and run on the sound all the
  time, so one that is turned up is already at work and only its gain moves. The cost is two filters running on every pad that
  is sounding, even at off (a filter at rest idles on silence); it was not measured on a phone.
- **A filter waits at the end of its range, and moving the slider glides.** A filter that is not in use waits where it is nearly
  out of the way (the low-pass at 20 kHz, the high-pass at 20 Hz). A setting is reached over a few milliseconds (a time
  constant of 15 ms) so a dragged slider does not zipper; a filter that is turned on is set to its cutoff at once, from where
  it waited, since a glide from the end of its range would sweep through every cutoff on the way.
- **Pan is a balance, with 0 dB in the centre.** Moving a pad right turns its left side down in a straight line (to nothing at
  +100) and leaves the right as it is, and the other way round: the centre is the sound untouched, so the default pad sounds as
  it did. The strip first makes the sound two channels as speakers do (a mono sound is on both), so a stereo sample is
  balanced as it is. Decided against the browser's `StereoPannerNode`, an equal-power pan: for a mono sound it is 3 dB down
  at the centre, which would change every pad that is not panned (or dip the level the moment a pad moved off the
  centre). The price is that a mono sound panned hard is about 3 dB quieter in all than at the centre; chosen over a +3 dB
  at the edges.
- **Default Sound keeps them; a starter resets them, as it does Gain.** They belong to the pad, so Default Sound and loading a sample leave a pad's Filter and Pan alone. A starter is a whole beat that sets the pads' settings itself, so a pad on a built-in sound goes back to off and the centre; a pad with a loaded sample keeps what the person gave it.
- **Saved with the pad's other settings**, as whole numbers, in the beat's `padSettings` (beat version 12; a version 11 beat has
  none, which reads as off and the centre). The export plays through the same strips, so a stem has its pad's filter and pan
  and the stems still add up to the mix.
- **On the LCD** as `PAD 03 FILTER LP 1.2 KHZ`, `HP 248 HZ` or `OFF`, and `PAD 03 PAN L 30`, `R 100` or `CENTER`.
- **Not decided here:** a resonance control, a filter that follows the envelope, and mapping the filter to a MIDI knob (a DJ
  Filter knob in a quick bar is a later phase of the effects work; the Master Filter has a MIDI knob, #194).

## Drive

Each pad has a Drive, first under Mix in the pad editor (#187, phase 5), in front of its Filter and Pan: it pushes what comes out of the pad into a soft clip, which thickens it and adds harmonics, and with the slider at 0 it is off. It works on a built-in sound as well as a loaded sample.

- **A soft clip, with the pre-gain doing the moving.** The shaper is a `WaveShaperNode` with one fixed curve for every strip (tanh,
  `driveCurve`: odd, so it makes no DC, and flat at the ends), and the slider sets the gain in front of it, `g` from 1 at the
  bottom of the range to 40 at the top, an equal ratio for an equal step (`scales.exp`), so the sweep feels even. At 1 the bend is
  gentle and barely more than the sound itself; at 40 anything louder than a fortieth of full scale is a flat top. The shaper takes
  an input between -1 and 1, so the pre-gain is `g` divided by the curve's reach (4): a hit of full scale at `g` = 40 is ten times
  past the end of the table, which is flat there (tanh of 4 is 0.9993).
- **Make-up is 1 / sqrt(g), measured.** A bare tanh makes a sound much louder (the RMS of the built-in sounds was 14 dB up at
  `g` = 10 and 17 dB up at 40), and dividing by `g` all the way would make it much quieter, since a loud hit saturates. Through the real strip, on six of the
  built-in sounds, 1 / sqrt(g) keeps the loudness between -5 and +7 dB of where it was across the whole slider (most within 3 dB;
  the sparse, noisy sounds such as the clap are the loudest and the kick is the quietest at the top). Peaks come down, as they do when a sound is squashed
  (a kick that peaks at 0.97 peaks at 0.16 at full drive). The make-up is for sounds as loud as the built-in ones: the small-signal gain is
  sqrt(g), up to +16 dB at full drive, so a very quiet sample, a low velocity or a tail is lifted against the loud hits, which is a compressor's
  doing as much as a drive's. Whether it sounds right can only be judged by ear.
- **Off is the dry path alone, and turning it on is a crossfade.** A strip has the dry sound and the shaped path side by side;
  at 0 the dry gain is 1 and the shaped path's post-gain is 0, so the sound goes on exactly as it is (measured: a difference of 0
  from no mixer at all, for a strip that is built at 0; one turned off while the page is playing gets there by the same 15 ms fades,
  which leave a residual of about 4e-5 of the shaped path after 150 ms and 1e-7 after a quarter of a second: inaudible, but not exact). Turned on, the shaped path fades in as the dry fades out over a few milliseconds (a time constant of 15 ms),
  with its pre-gain set at once while it is still silent: gliding the pre-gain from where it waited would sweep the shaper through every amount on the
  way. Moving the slider while it is on glides both gains. Measured with a steady tone: every move, including on and off, is within 1.14 times the roughness of the
  tone at either end (a click would be tens of times). The shaped path at the bottom of the range is a gentle bend and not the dry sound: a quiet sound
  is the same to within a hair, but a full-scale peak comes out 2.3 dB lower at the first step of the slider (0.5 of full scale, 0.5 dB), so crossing 0
  trims the loudest peaks a little.
- **Known limit: dragged to 0 and straight back.** Turned off and on again before the shaped path has finished fading out (about a tenth of a second), the pre-gain is set at
  once while that path is still partly up, which steps what is left of it: at most about 0.02 (-34 dB of full scale) on a loud, sustained sound at full drive, and the later the less. Gliding the
  pre-gain instead was tried and measured: it sweeps the shaper through every amount in between, and was 3 to 15 times rougher with the corners of a clipped tone than the step, so it was
  not kept.
- **Not oversampled, on purpose.** A soft clip folds its harmonics back as aliasing unless the sound is taken to a higher rate
  and back: measured in Chromium, a 5 kHz sine at full drive has its fold-backs at -14 dB against the tone with none, and below
  -120 dB at 2x. But the oversampling filters delay the shaper's output (measured: 2.9 ms at 2x and 4.4 ms at 4x), which puts a driven pad late against the
  others, and, in the first version (2x), made turning the drive on click (the crossfade from the dry path to the delayed one: 40 times the roughness of the tone). A drum machine's pads have to be
  on time more than a distortion has to be clean, as for the master's clipper, which is not oversampled either. The aliasing is
  worst on bright, loud, sustained sounds (a hat or a ride at full drive).
- **The cost** is one shaper and four more gains on every strip, running at off as well (an idle shaper is not free). Measured offline in Chromium, 16 strips with a hit every
  125 ms rendered in the same time at drive 0 and at 100, and the shaper without oversampling added about 10 % to a whole render against none; it was not
  measured on a phone.
- **It is after the pad and before everything else, so the stems still add up.** The drive is on each pad's own strip, before the
  sends and the master filter, so a stem has its pad's drive exactly as it is in the mix, and the stems still add up to the mix: a nonlinear
  stage per pad, with every pad on a strip of its own, is as good as a linear one for this (measured in Chromium with the real export: the stems of three
  driven pads, one also filtered and sent to the reverb, summed to the mix to -139 dB against its peak).
- **Default Sound keeps it; a starter resets it.** Like the other pad settings, it belongs to the pad: Default Sound and loading a
  sample leave it alone, and a starter puts a pad on a built-in sound back to 0 (a pad with a loaded sample keeps what it was given).
- **Saved with the pad's other settings**, as a whole number from 0 to 100, in the beat's `padSettings` (beat version 15 with a
  no-op migration, so a page that does not know it refuses the beat instead of opening it and saving it back without the drive; a version 14 beat reads as 0).
- **On the LCD** as `PAD 03 DRIVE 45 %`.
- **Not decided here:** other curves (a hard clip, a fold, a tube-like asymmetric one), a tone control after it, and a drive on the master
  (the master already has a soft clipper, which is not set by anything on the page).

## Reverb and delay

Every pad can send to one shared reverb and one shared delay (#187, phase 3). Each pad has a **Reverb** and a **Delay** under Mix
in the pad editor (0 to 100 %, none to begin with, for any sound), and the effects themselves are in an **Effects** panel
between the Song panel and the steps: the reverb's **Size** and **Level**, the delay's **note**, **Feedback**, **Level** and
**Ping-Pong**. They are the same for every pad and every sequence: the mix belongs to the beat.

- **Sends, and returns the pads share.** A strip's sound, after its filter and pan, goes on to the output as before and, in
  the amount of the pad's send, to the reverb and to the delay (`reverbSend`, `delaySend`); the two returns add their sound to
  the output. One reverb for the whole kit is what makes a kit sound like one room, and sixteen convolvers would be far too
  heavy for a phone. A pad whose sends are 0 is exactly as it was: the sends are 0-gain taps, and the output equals the input
  (measured in a browser: a difference of 0).
- **The reverb is a convolver on a made-up room, built only when it is wanted.** The impulse (`reverbImpulse` in
  `effects.js`) is noise from a seeded generator that dies away to 60 dB down over the room's length (0.3 s to 3 s, an equal
  ratio for an equal step of Size) and darkens as it goes, one noise for each side. Seeded, so the page and an export make the
  same room. Nothing is built until a pad sends to the reverb: the convolver, its impulse and its connection wait for the first
  send, and are let go of again once every send is 0 and what was in the room has rung out (its length and a little more, by a
  timer: letting go of a node is housekeeping, not a sound). A beat with no reverb costs no convolver.
- **A new size is a new room, faded to.** Setting a convolver's buffer while it plays clicks (measured in Chromium with a steady
  tone through it: the largest jump was 90 times a smooth tone's; the fade here is about 15 times smaller than that, and what is
  left is the new room filling up). So a change of Size builds the new room beside the old one once the slider has stopped
  (150 ms after the last move: a drag would make a room for every step), fades up the new one as the old one fades down, and lets
  go of the old one when it is silent.
- **The delay is two lines and the same wiring for every setting.** Each side has a delay line with the feedback going round it,
  or, for ping-pong, across to the other line: the settings only turn gains up and down (what goes into each line, and how much
  comes round or across), so Ping-Pong, Feedback and the note glide and nothing is ever rewired under a sound that is echoing.
  Ping-pong mixes both sides into the left line, so the first echo is on the left, the second on the right, and so on (measured);
  the plain delay keeps each side where it was (a pad panned right echoes on the right). With no feedback ping-pong is the one echo,
  on the left (nothing is passed across to the right).
- **The note follows the tempo.** The time is a share of a beat (1/16, 1/8, a dotted 1/8 or 1/4; `delaySeconds`), so a change of
  tempo moves it: the line glides to the new time over about 50 ms (a time constant of 50 ms), which bends the echoes' pitch for a
  moment instead of clicking. The longest, a quarter note at 40 BPM, is 1.5 s.
- **Levels are measured, not guessed.** A convolver is normalized by its impulse, so a pad sent fully to the reverb at full
  Level came back 7 dB (the biggest room) to 17 dB (the smallest) under its dry sound, a whisper at the top of a slider; the return is
  brought up 12 dB (`REVERB_RETURN_GAIN`), which puts full send and Level at -5 to +5 dB against the dry sound (energy, with a snare-like
  hit). The delay's first echo at full send and Level is as loud as the pad. The send and level sliders are straight lines; the
  feedback stops at 90 %, so an echo always dies away. Whether it sounds right can only be judged by ear.
- **Saved with the beat.** The pad's sends are two more entries in `padSettings` (clamped, formatted and saved with the others),
  and the effects are one optional `effects` object on the beat: `{ reverbSize, reverbLevel, delayDivision, delayFeedback,
delayLevel, pingPong, masterFilter }` (the last came with phase 4, below), whole numbers (`delayDivision` is the place in `DELAY_DIVISIONS`, so a new note goes on the end), left out
  while they are all at their defaults and read back through `parseEffects` like `swing`. Beat version 13 with a no-op migration:
  a version 12 beat has no sends and no effects, which reads as dry (phase 4 moved it to 14). A starter has no effects of its own: the effects go back to
  the defaults, and its built-in pads send nothing, so it starts dry; a pad with a loaded sample keeps the sends it was given, as it
  keeps its other settings, and so sends to the default effects. Not part of the step undo history, like the pad settings.
- **On the LCD** as `PAD 03 REVERB 40 %` and `PAD 03 DELAY 25 %`, and for the panel `REVERB SIZE 0.8 S`, `REVERB LEVEL 50 %`,
  `DELAY TIME 1/8.`, `DELAY FEEDBACK 35 %`, `DELAY LEVEL 50 %` and `PING-PONG ON`.
- **In an export**, the same mixer is built on the offline context with the beat's effects and tempo, so a stem has its pad's
  sends and the stems still add up to the mix (they are linear: measured, a difference of 2e-7). How far the tails are followed
  is in `docs/export.md`.
- **Not decided here:** a pre-delay or damping control on the reverb, a delay that is not a note (a time in
  milliseconds), and sends from a pad to the delay's own reverb.

## Master filter

One Filter over the whole mix (#187, phase 4), in the Effects panel under **Master**. It is the pad's Filter again (the same
-100 to +100 slider, low-pass left of the middle, high-pass right of it, off in the middle, the same cutoffs from `filterSpec`),
and it is one of the beat's effects: `masterFilter` in the `effects` object, whole numbers, off by default.

- **Over everything that is heard, and nothing after it but the volume.** The strips and both returns lead into it, so it
  darkens or thins the reverb and the echoes as well as the pads (measured in a browser: a reverb tail with the filter at its
  lowest was 8 times quieter in level than with it off). It is the last thing in
  the mixer, so the master volume and the soft clipper come after it and still catch a peak.
- **The same three paths as a strip, built by the same code.** A dry path, a low-pass and a high-pass, each through a gain, made
  once and never retyped, the unused filter waiting at the end of its range, glides for a moved cutoff and a jump for a filter
  that is turned on (`createFilterPaths` and `applyFilter` in `mixer.js` are shared by the strips and the master filter). Off is
  the dry path alone, so the mix goes through unchanged (measured: the difference from no mixer at all is 0). Moving it under a
  steady tone is no rougher than the tone itself (0.9 to 1.15 times the second difference of a clean sine, in every direction across the middle; a click would be far more). Two
  more filters run on the master for as long as the page is playing, which is nothing next to the sixteen strips'.
- **Saved with the beat.** One more entry in `effects`. Beat version 14 with a no-op migration, as each phase that added saved data has had one:
  a page that does not know the filter refuses a version it does not know, instead of opening the beat and saving it back without the setting
  (a page cached offline keeps its version until it is reloaded). `parseEffects` fills a missing entry with the
  default, so a version 13 beat reads as off, and one that has only a master filter is kept like any other that is not at
  the defaults. A starter, like for the other effects, puts it back to off. The filter does not lengthen an export's tail (it only takes away from what rings).
- **In an export**, the mixer is the page's, so the master filter is in the file and in every stem. A filter is linear, so the stems
  still add up to the mix.
- **On the LCD** as `MASTER FILTER LP 1.3 KHZ`, `HP 248 HZ` or `OFF`.
- **A MIDI knob can move it** (below, #194).
- **Not decided here:** a resonance control, a DJ Filter knob in a quick bar, and a master filter that is part of a sequence or a song entry.

## A MIDI knob for the Master Filter

A knob on a controller can move the Master Filter ([#194](https://github.com/jaballer/audio-lab/issues/194)): under Master in the Effects panel,
**MIDI Learn**, then turn a knob. The code is `midi-map.js` (no DOM) and the Learn key in `effects-panel.js`.

- **Taught, not built in.** A knob's controller number is a fact about the hardware that the page does not know, and a profile
  that said "K1 is the filter" would work only for the controllers the project has a profile for, and could not move when K1
  already means something else. So the person assigns it. Profiles stay the place for hardware facts (pad notes, LED colours); an
  assignment is the person's setup, so it is not a profile's. The numbers a person teaches are data (`midi-map.js` keeps them and
  `main.js` never names one), which is how the rule that controller numbers do not appear in a handler is kept.
- **A generic `cc` event.** The Akai profile and the generic one pass a Control Change on as `{ type: "cc", channel, controller,
value }`, and `midi.js` hands it to the page, where `createMidiMapping` either learns it or, when it is assigned, moves the
  setting through `setEffect` (the one setter the slider uses, so the display, the audio and the saved beat follow). The Launchpad
  profile passes none on: all its controllers are buttons (CC 104 to 111), and keeping them out is what stops Learn taking a button.
  A Launchpad this page has no layout for (a Pro, an X, an MK3) would fall to the generic profile and send its buttons as knobs, so it
  has a profile of its own, `otherLaunchpad`: the generic notes and no `cc` (any port with "Launchpad" in its name that the first
  profile does not take).
- **Kept on its own.** The assignment (`pad-sampler:midi-map`, by `shared/storage.js`) is not part of the beat or a `.audiolab`
  file: it says which knob of which controller, not what the music is, and a project opened on another computer should not bring a
  stranger's controller numbers with it. The channel is part of it (a knob on channel 1 is not the same knob on channel 2), and so is the input it
  came from, by the name the browser gives its port (the same name a profile matches): two controllers can send the same numbers, and
  teaching a knob on one must not let the other move the filter, nor satisfy Learn first. The name is what the browser reports, so
  a port that it names differently another day (Windows puts a number in front of it, ALSA behind it) is a knob to teach again, and
  two controllers of one model with the same name are not told apart. A stored map is read back through `parseMidiMap`, which drops
  anything that is not a known target, an assignable controller and an input name, and never throws.
- **Learn takes the first knob turned that can be one.** Not after a number of moves: what a person does not mean to assign is
  a handful of controllers that are not knobs, and these are left out by number (`isAssignableCc`): 64, the sustain pedal, which
  a footswitch sends on every press; 0 and 32, Bank Select; and 120 to 127, the channel mode messages (all sound off and the like)
  that controllers send by themselves. Learn goes on waiting past them and the display says which controller it passed
  (`CC 64 IS NOT A KNOB`). This is a limit: a knob that is one of those controllers cannot be assigned. Learn stops when the
  Learn key is pressed again, when Clear is, when MIDI is switched off and when the Effects panel is hidden (a Learn left
  waiting would take a knob nobody knew was being waited for: a mod wheel moved after reconnecting would have replaced the
  assignment). One controller is one setting's: assigning it to a second target
  takes it from the first (there is one target so far).
- **The middle of the knob is the filter off, in a detent.** The curve is `detented` in `shared/scales.js`, where a slider-to-value
  mapping belongs (it is not specific to MIDI). A knob has 128 positions and no middle one (63.5), so off at only one
  position would mean the filter is on, a little, nearly always. Positions within `DETENT` (6 per cent of half the travel, the
  eight positions 60 to 67) all give off, and the rest of the travel is spread over what is left, so the setting is continuous at
  the edge of the detent (the first step past it is 1) and still reaches -100 and +100 at the ends. The width is a judgement by hand,
  not measured; it is a constant (`DETENT`) so it is one line to change.
- **The knob jumps to its position.** There is no pickup mode (the knob doing nothing until it passes the slider): a DJ filter is
  swept, and a jump from where the slider was to where the knob is, is what is expected of one. The knob's messages that would set the
  setting to what it already is (the detent sends a run of them) set nothing.
- **Heard like the slider.** A turn of the knob is `setEffect("masterFilter", …)`: it moves the slider and the display (`MASTER
FILTER LP 1.3 KHZ`), is heard by what is ringing, and is saved with the beat. Learn and Clear say what they did on the display
  (`MOVE A KNOB FOR MASTER FILTER`, `MASTER FILTER CH 1 CC 21`, `MASTER FILTER KNOB CLEARED`), and the panel's status line is a
  `role="status"`, so a screen reader hears them.
- **A map that could not be saved is said so.** Storage can be blocked or full (`saveJson` returns false): the knob works until the page
  is closed, and the display ends the message with `(NOT SAVED)`, for a taught knob and for Clear.
- **Not decided here:** other targets (reverb and delay level, tempo: a target is an entry of `TARGETS`, with how a value of 0
  to 127 becomes its setting), per-pad targets (a knob would have to follow the selected pad), a controller's lit rings or motorised
  knobs, a note that MIDI is off when Learn is pressed (the page says "Turn a knob", and the MIDI switch is in the header), a fixed
  profile mapping for a known controller, and following a change made in another tab (two tabs each keep their own copy, and the
  last to save wins; the beat has `tab-sync.js` for this, the map is small and per controller, and it was not worth the same).

## Mute and solo

A pad can be muted, or soloed so that only it (and any other soloed pads) is heard (#196). It is how a beat is listened to and not
part of it: the steps, the pad's settings and its sample are untouched.

- **In the pad editor's Listen section**, two toggle buttons (`aria-pressed`) for the selected pad. On the pad grid a muted pad has a
  MUTE badge, a soloed one a SOLO badge, and a pad that a solo of another silences has its name dimmed, so the state shows with the
  editor closed. The words are in the pad's label too, so it is not carried by sight alone. The LCD says `PAD 03 MUTE ON` and so on.
- **A solo is not a mute of the others.** `mute-solo.js` keeps two sets of pads and a pad is heard if it is not muted and, when any pad
  is soloed, is soloed. Clearing the last solo brings the pads back as they were. A pad both muted and soloed is silent: the mute wins.
- **Silenced at the strip's gate, not at the voice.** Each strip (`mixer.js`) starts with a gain, the gate, of 1 or 0, which glides
  as the settings do (so a mute in the middle of a sound is not a click). The voices still play into it, so a hit on a muted pad
  still lights the pad and still cuts the pads of its choke group, as the choke is a part of the beat. The gate is at the front, so a
  silenced pad sends nothing new to the reverb and the delay either, and what those two already hold rings out.
- **For the visit, not saved.** Not in the beat, a project file or an undo, so a beat can never open silent because a pad was left
  soloed. Opening a project or a starter reloads the page (`main.js`), which clears them too. Saving mutes could be added later without breaking anything (a `BEAT_VERSION` bump).
- **A mix export is made as it is heard**: the Export dialog says how many pads are left out ("2 pads are muted or silenced by a solo,
  so left out of this file"). A stem is one pad's own sound, so stems are unaffected, as are the choke cuts a stem already includes.
- **Not decided here:** a MIDI button or a key for each pad's mute and solo, a way to clear every mute and solo at once, and a mute
  as a part of a sequence (automation). A live keyboard shortcut for the selected pad is the likeliest first one.

## Amplitude envelope

A loaded sample can be given an attack, a decay, a sustain level and a release in the pad editor, under Tune (#120).

- **Laid over the time the sample is heard for.** A sample plays once and says nothing when it ends (there is no note off), so the envelope is applied across its heard length (the trimmed part, at the pad's pitch): Attack fades it in from the start, Decay lowers it to the Sustain level, which is held, and Release fades the last that-much of it out (`apps/sampler/pad-envelope.js`, pure and tested). A stage that runs into the next is cut where the next begins, from the level it had reached. All at their defaults (no attack, no release, sustain 100) is no envelope, and the sample plays exactly as before, with no extra node.
- **Release is also the fade of a cut.** A hit on the same pad, or on another pad in its choke group, fades the pad's earlier voice out over the pad's Release (spread over seven time constants, so it is about 60 dB down at the end of it; never faster than the 4 ms every cut has) instead of the fixed short fade. Read when the voice starts.
- **When there is a note off** (hold mode, #114): the sustain would hold until the pad is released and Release would start there. The settings mean the same; only what ends the held part changes.
- **Samples only, like Pitch:** a built-in sound is synthesized with its own envelope, so the sliders are disabled (with the same hint) while a pad plays one, and `kit.envelope` is null for it.
- **Sliders, in positions:** attack and decay go to 2 s and release to 5 s, on a cubic scale (fine control over short times: position 10 is 2 ms, 50 is 250 ms); sustain is 0 to 100 per cent. The values kept are the positions, so the beat format (version 7) and the settings code stay whole numbers; the display shows the time.
- **The export** follows (the same `kit.voice().play` and `createVoices`), with enough passes before the one kept to cover a release longer than the loop: a pad hit every loop leaves a fading voice each time, so the loop's steady state has tails from several passes back (`1 + ceil(longest release / loop)` warm-up passes, at most twelve).
- **A hit shorter than its attack and release together:** an attack that does not fit in the sample, with a release, shares the sample's time with it in proportion (a rise to full and a fall to silence), so the hit is never silent.
- **Drawn on the waveform.** The pad editor's waveform shows the envelope: the waveform as it is (faint), the waveform scaled by the envelope (bright), and the envelope as a line above the middle and its mirror below, over the trimmed part. It is laid over the sample's own time (`envelopeCurve`: a point `t` seconds into the hit is `t` times the rate seconds into the sample), so it lines up with the waveform whatever the trim and the pitch are, and it follows the sliders as they move. It is the same shape the audio is ramped through, so the two share one source; the picture is the envelope alone, not the whole signal (it leaves out the 3 ms edge fades of a trim, the pad's gain, and the longer fade a re-hit's cut makes). Nothing is drawn for a built-in sound, which has no waveform.
- **Not decided here:** curved (exponential) segments instead of linear ramps; an envelope for the built-in sounds; dragging the points of the curve on the picture.
