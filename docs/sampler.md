# The sampler: design decisions

Why the sampler (`index.html`, `apps/sampler/`) works the way it does: the song and its sequences, step velocity, the pad
editor and each pad setting. What it can do is in the [README](../README.md); where each file is, in
[architecture.md](architecture.md); the export, in [export.md](export.md). Work still to do is tracked in the GitHub
issues (song mode [#159](https://github.com/jaballer/audio-lab/issues/159), step editing
[#87](https://github.com/jaballer/audio-lab/issues/87), sound editing [#21](https://github.com/jaballer/audio-lab/issues/21)),
not here.

## The song

What `song.js` keeps, and `controller.js` plays:

- **Sequences.** A beat starts with one sequence and has up to eight (`MAX_SEQUENCES` in `layout.js`), each 1, 2, 4 or 8
  bars of 16 steps, with its own pattern and velocities. Tempo, swing and volume belong to the song, not to a sequence.
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
- **Saved as a versioned shape.** Every change to what is saved bumps `SONG_VERSION` and adds a migration, so a beat saved
  by an older page still loads, and a song from a newer page is left alone rather than misread. The storage key is still
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

## Amplitude envelope

A loaded sample can be given an attack, a decay, a sustain level and a release in the pad editor, under Tune (#120).

- **Laid over the time the sample is heard for.** A sample plays once and says nothing when it ends (there is no note off), so the envelope is applied across its heard length (the trimmed part, at the pad's pitch): Attack fades it in from the start, Decay lowers it to the Sustain level, which is held, and Release fades the last that-much of it out (`apps/sampler/pad-envelope.js`, pure and tested). A stage that runs into the next is cut where the next begins, from the level it had reached. All at their defaults (no attack, no release, sustain 100) is no envelope, and the sample plays exactly as before, with no extra node.
- **Release is also the fade of a cut.** A hit on the same pad, or on another pad in its choke group, fades the pad's earlier voice out over the pad's Release (spread over seven time constants, so it is about 60 dB down at the end of it; never faster than the 4 ms every cut has) instead of the fixed short fade. Read when the voice starts.
- **When there is a note off** (hold mode, #114): the sustain would hold until the pad is released and Release would start there. The settings mean the same; only what ends the held part changes.
- **Samples only, like Pitch:** a built-in sound is synthesized with its own envelope, so the sliders are disabled (with the same hint) while a pad plays one, and `kit.envelope` is null for it.
- **Sliders, in positions:** attack and decay go to 2 s and release to 5 s, on a cubic scale (fine control over short times: position 10 is 2 ms, 50 is 250 ms); sustain is 0 to 100 per cent. The values kept are the positions, so the song format (version 7) and the settings code stay whole numbers; the display shows the time.
- **The export** follows (the same `kit.voice().play` and `createVoices`), with enough passes before the one kept to cover a release longer than the loop: a pad hit every loop leaves a fading voice each time, so the loop's steady state has tails from several passes back (`1 + ceil(longest release / loop)` warm-up passes, at most twelve).
- **A hit shorter than its attack and release together:** an attack that does not fit in the sample, with a release, shares the sample's time with it in proportion (a rise to full and a fall to silence), so the hit is never silent.
- **Drawn on the waveform.** The pad editor's waveform shows the envelope: the waveform as it is (faint), the waveform scaled by the envelope (bright), and the envelope as a line above the middle and its mirror below, over the trimmed part. It is laid over the sample's own time (`envelopeCurve`: a point `t` seconds into the hit is `t` times the rate seconds into the sample), so it lines up with the waveform whatever the trim and the pitch are, and it follows the sliders as they move. It is the same shape the audio is ramped through, so the two share one source; the picture is the envelope alone, not the whole signal (it leaves out the 3 ms edge fades of a trim, the pad's gain, and the longer fade a re-hit's cut makes). Nothing is drawn for a built-in sound, which has no waveform.
- **Not decided here:** curved (exponential) segments instead of linear ramps; an envelope for the built-in sounds; dragging the points of the curve on the picture.
