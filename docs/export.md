# Export: how it works, and why

The sampler's Export saves the sequence showing (looped), or the song, as a 16-bit WAV file, rendered as the
page plays it. It was built over several pull requests and then audited as a whole (fidelity to live playback, robustness, UX,
and what a whole-song bounce would need, which is now built as "The song" below). This records the decisions and what
was measured. What is still to do is tracked in the
GitHub issues ([#116](https://github.com/jaballer/audio-lab/issues/116) stems,
[#117](https://github.com/jaballer/audio-lab/issues/117) whole song,
[#118](https://github.com/jaballer/audio-lab/issues/118) the speed-ups and guards still open in it: skipping hits that cannot reach the file), not here.

## Where it is

| File                                                  | What it does                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sampler/export-wav.js`                          | The render (`planRender`, windows, `renderSequence`), the WAV encoder, `exportSequence`, `createExportAction`                                                     |
| `apps/sampler/export-options.js`                      | The choices (the sequence showing or the song, loops, stereo or mono, mix or stems), what the file will be (length, size), the notes and reasons the dialog shows |
| `apps/sampler/export-dialog-state.js`                 | What the dialog shows and allows, the double-click guard, and what the page tells the dialog (all pure)                                                           |
| `apps/sampler/export-dialog.js`                       | The `<dialog>`: draws what it is told and reports what is pressed                                                                                                 |
| `apps/sampler/zip.js`                                 | A store-only zip writer (CRC32, no dependency) for the stems                                                                                                      |
| `apps/sampler/voices.js`, `kit.js`, `sample-voice.js` | One voice per pad and choke groups; the kit snapshot; a sample's source can be stopped                                                                            |
| `shared/app-header.js`                                | The Export button, next to POWER (the `actions` option)                                                                                                           |

## Decisions

**A button in the machine's header, not in the transport.** Export acts on the whole machine and is not a performance
control, so it sits with POWER, and the transport is Play, Stop, Rec and Tap Tempo. (The first version was an Export WAV
button in the transport, which also made that grid lopsided.) Connect MIDI and the Console were in the site header (now in the machine header), which
every page shares; moving them, or adding a Menu, is a separate decision that touches every page.

**A native `<dialog>`, not a side panel.** Exporting is one-shot: it should take no room while it is closed. A side panel
beside the pad editor needs about 1500 px to hold both (the machine at its 850 px minimum, two 290 px panels and the gaps;
about 1620 px with the machine at full width), and sharing one slot costs a tab strip for something used once in
a while. `showModal()` gives the focus trap, Escape, the backdrop and focus returning to the button for free. The page's
key handler (pads, Space, undo) leaves the keys alone while it is open, and a pad editor opened beside it is out of reach.

**Loops (1, 2, 4, 8) and Channels (stereo, mono).** The default is the plain export as it always was. The choices are kept
between visits. A file made with options is named for them (`pad16-seq-01-100bpm-x4-mono.wav`) so two exports of one
sequence do not overwrite each other. Sample rate and bit depth are not offered (the issue said "if anyone asks"); the file
is 16-bit, at the rate the page's audio runs at (44.1 or 48 kHz on most machines; 44.1 kHz where there is none yet, or one
outside 22.05 to 96 kHz), and the dialog says which.

**Files: Mix or Stems.** The third choice, first in the dialog, is what is made: the mix as one WAV (the default, as it
always was), or a WAV for each pad that has steps in one zip, so the parts can be mixed elsewhere (see Stems below).
The button says which (Export WAV, Export ZIP), the readout counts the stems and sizes the zip ("5 stems · 2.0 s each ·
stereo · 1.7 MB zip"), and the hint says what stems are. Loops and Channels apply to every stem. The choice is kept
between visits with the others (options saved before it have none, which is the mix).

**Progress and cancel are in the dialog.** While it renders the choices and the close button are off, a bar and a
percentage show, and Cancel export (or Escape) stops it. It cannot be closed while it renders: a dialog that closed would
leave nothing to say how far it had got, or a way to stop it. The messages (`EXPORT CANCELLED`, ...) are shown in the
dialog as well as on the LCD: the LCD is behind the dialog and out of a screen reader's reach while it is open, so the
dialog's own line is the live region, and a saved file is announced on the LCD once the dialog has closed. A press in the
half second after a render starts or stops is ignored (the Cancel export button takes the place of Export WAV, so the
second click of a double click would otherwise land on it).

**It says what it will cost before it is made.** The length and size of the file; bars with no steps ("nothing plays in
them but what is still ringing": a file is as long as all its bars, and a sequence of 8 bars with steps in the first is
silent from 2 s in, which looks like an export that broke off); and, from about 200 MB, how much memory it takes. These are
read out with the dialog's name when it opens. Export WAV is off, with the reason in place of the hint, for a sequence with
no steps and for a browser that cannot render audio to a file. The guard only warns: it never blocks.

**No "time left".** It was tried (from the rate so far) and said "a few seconds left" for 18 s: the windows of a render do
not cost the same (a dense bar followed by sparse ones). A wrong estimate is worse than none, so there is a percentage.

## The render

The sequence is played into an `OfflineAudioContext` with the page's sounds, velocities, pad settings, retrigger and choke
cuts, volume and clipper. `planRender` works out the hits, the passes and where the file sits before any audio exists.

- **Passes.** The last `loops` passes are the file; the passes before are warm-up, so what rings on from the end of one
  pass (a crash, a long sample, a long Release) is in the start of the next, as it is when the page loops. One warm-up pass
  is enough unless a pad's Release is longer than the loop: then there are `1 + ceil(release / loop)`, at most 12.
- **Windows.** Every node that waits for its start time is looked at by the audio thread in every block, so the cost is about
  the nodes waiting times how long they wait. With the whole sequence scheduled before the render began (about 100,000 nodes
  for a dense 8-bar song) the work grew with the square of the length. The render now pauses (`suspend`) at the end of each
  second of audio and starts the hits that sound two windows on: what waits is bounded, and no hit is started closer than
  about a window to its time (a trimmed sample whose start is already late is moved on to `currentTime + 5 ms`, which would
  shift it). A pause is also a progress report and a place to stop. Firefox has no `OfflineAudioContext.suspend`: it
  schedules everything first, as before, so it should have no percentage, a cancel that waits for the end, and the old cost: that
  is expected from the missing method, not seen (Firefox was not run). A pause that cannot be
  set or resumed fails the render: the rest of the sequence would not be scheduled, and the file would be silent from there.
- **Cancel.** The render stops at its next pause. It is then let go of (the master is disconnected and the render resumed to
  run out unheard): left suspended, Chromium never frees it, and each cancel kept about 90 MB.
- **Cut sources are stopped.** A sample cut after a tenth of a second ran on, silent, to the end of its buffer. The export
  has the source stopped at `cut + 2 x release + 0.1 s` (the fade is a seventh of the release per time constant: fourteen of
  them, more than 120 dB down). Only the export asks for this; the page's own voices are as they were.
- **Snapshots.** The song is read when Export WAV is pressed; the kit is snapshotted when the render starts, after the wait
  for saved samples (a snapshot at the press could hold a built-in sound for a pad whose sample is still being restored). A
  sample's snapshot keeps its trim as it was. A render never hears a pad edited under it.
- **Memory.** The kept window is `subarray` views of the render, not copies. Mono is the mean of the two channels, in
  JavaScript. At the peak the whole render buffer, then the WAV and its Blob, are held: 8 bytes a frame of the render
  (warm-up included) plus 8 of the file, stereo or mono.

## What was measured

Chromium, on one machine; none of it listened to.

- **Fidelity.** For the built-in sounds, loaded samples (trim, pitch, envelope, a release longer than the loop), velocity,
  pad gain, choke, retrigger, master volume and the clipper, the offline render equals a live graph to float rounding (about
  2.4e-7). The step grid equals the live scheduler's. The WAV header and encoding are correct; mono is the channel mean.
- **Speed.** 16 pads on every step: milliseconds per second of file, windowed against all-first, 155 vs 185 (1 loop), 111 vs
  242 (4), 102 vs 469 (8): flat, where it grew. 8 bars at 40 BPM, every pad on every step, one loop: 273 s before, 6.6 s now;
  with 8 loops (a 384 s file) 38 s on a quiet machine and 68 s on a busy one, with 433 progress reports, the longest gap between two 236 ms and 0.7 s.
- **Cancel.** Six cancelled renders: 1,047 to 1,491 MB before, flat at about 850 MB now.
- **Memory.** The 384 s file peaked 297 MiB (stereo) and 312 MiB (mono) over the page's baseline; the formula gives 275.

How the equivalence was checked, for the next change to the render: six varied songs (loops, mono, choke groups, a trimmed
and pitched sample with a long release, 16 pads dense) rendered before and after in a browser with `Math.random` seeded (the
noise sounds draw their buffer from it, so two loads of the same code differ), comparing the loudness of 160 blocks of each
(within 1e-7, the noise between two runs of the same code) and, for the engine change, every sample against the same code
scheduled in one go (at most 6e-7, about 2% of one 16-bit step).

## Known limits and open questions

- **Samples and the rate.** A loaded sample is a buffer at its own rate, and the browser resamples it, with a quick rough
  resampler, into a context at another. Into a 44.1 kHz render a 48 kHz buffer measured 1.2 dB down at 10 kHz, 2.7 at 15 kHz
  and 4.0 at 19 kHz, and into a 48 kHz render none. So the export follows the page's rate (`exportSampleRate`): what is
  saved is what is heard, and a sample at the page's rate is not resampled at all. Built-in sounds are synthesized at the
  render's rate and are not affected. Still true: the page decodes the saved samples at 48 kHz (`RESTORE_SAMPLE_RATE`)
  before its audio exists, so on a 44.1 kHz machine they are resampled, here as on the page; that is the page's, not the
  export's. The file's size and the render's memory grow with the rate (48 kHz is 9% more than 44.1, and 96 kHz 2.2 times: the largest export, 275 MB at 44.1 kHz, would be about 600 MB, which the size note warns of but does not stop).
- **The loop's join.** A swept oscillator (kick, the snare's tone, toms, conga, zap, blip, and the
  bass's filter) that starts part way through a render block was made, for the first part of the block, from the default
  frequency before its first event, and what that did depended on where the hit fell in the block: a kick on the last step
  was one waveform on one pass and another, a phase apart, on the next, so the file's end did not join its start (a step of
  0.03 to 0.07 at 90 to 133 BPM, about -30 to -23 dBFS). `sweep` (`shared/dsp.js`) holds the start value before the sweep.
  Over 41 tempos from 60 to 180 BPM, at 44.1 and 48 kHz, a kick (and a kick with a snare) on the last steps leaves a step
  of 0.003 at worst (-51 dBFS), and the first second of the file differs from the same stretch inside a longer render by
  -52 dB of the file's peak at worst. It is not zero: the engine still evaluates a ramp a block at a time, which a start
  inside the block cannot avoid, so a lone swept sound's phase after its first block still depends on where it fell
  (a review measured up to -34 dB of that one sound's own level, at the worst alignment; seven pads on the last steps at
  133 BPM, -36 dB of the file's peak). That is a small difference in a tail, not a step. The same change makes the page's own kick start the same way every time. Only measured, not listened to.
- **Not bit-identical run to run** (one least significant bit in a few samples: the order the engine sums noise sources in);
  the noise sounds' buffer is shared, made for one rate at a time, and rebuilt when the rate changes: an export at the page's rate shares the page's, and only an export at the 44.1 kHz fallback (no audio yet, or a rate outside 22.05 to 96 kHz) alternates with it.
- **Firefox** should keep the old cost and have no percentage or mid-render cancel (above: expected from the missing method,
  not observed). Safari is untested.
- **`EXPORTED` is said even if the browser blocks the download**, which `saveBlob` cannot tell.
- **A pad whose saved sample fails to decode** plays, and exports, its built-in sound without saying so.

## Stems

Per-pad stems ([#116](https://github.com/jaballer/audio-lab/issues/116)) were built in two parts: the engine (`renderStems`,
`zip.js`), then the dialog's Files choice, which offers them (`exportStems`). What the engine does and why:

- **One render a pad, only that pad's sound.** `planRender({ pad })` keeps the pad's hits, and, as `silent` hits, those of
  the other pads in its choke group, which are not made (no sound is built for them) but go through `voices.start`, so they
  cut the pad where they sound, as on the page. A pad in no group (0 is none) is cut only by itself, and its render has no
  other pad in it. The renders cost about what the one mix does: measured, 16 stems of a dense 8-bar song took 5.2 s against
  4.7 s for the mix.
- **On the mix's timeline.** A stem warms up for as many passes as the mix does (a long release on one pad moves every
  stem), and schedules only the passes its own pad can be heard from (`skipped`): the rest are empty, which costs next to
  nothing. This is what makes the stems add up: a hit's place in a render block and its fraction of a frame change what an
  oscillator or a sample's start makes of it, and a stem that began a pass or two later put its hits at other frames
  (measured: stems of a song with a long sample release added to the mix to only -39 to -46 dB; on the mix's timeline,
  -120 dB). A pass is left out only when the pad's tail is 120 dB down by the file: twice its release away (a cut fades
  over fourteen time constants of a seventh of the release), not the one release that the mix needs for its own steady
  state. With one, a pad whose release was shorter than the longest in the song was out by -82 to -89 dB, found by a
  review: the mix still has the tail of the pass before the first one a stem schedules, cut by that pass's first hit.
- **Where the property is checked.** The mix must be below the clipper's knee (0.7): a clipped mix is not the sum of
  unclipped stems, so a comparison at a louder volume says nothing about the stems (a test song at volume 25 with loud
  samples peaked at 0.96 and differed by -13 dB, at volume 10 by -126 dB).
- **Master volume, no clipper.** The page's master volume is applied, and the clipper is left out (`clip: false`): a clipper
  is for the sum, and it cannot be taken apart. So the stems add up to the page's mix before the clipper, which below the
  clipper's knee is the mix. Measured in Chromium, the sum of the stems equals the single file to float rounding (-115 to
  -126 dB): 16 pads with velocities, two choke groups, all 16 pads in one group, loaded samples with trim, pitch, gain and a
  5 s release, mono, four loops, two bars. Where the mix would clip, the stems add up to more than full scale, which is
  what a mixer wants; one stem that passes full scale on its own is clipped by the 16-bit file.
- **Names.** `pad16-seq-01-100bpm-x4-mono-pad03-snare.wav` in a zip named `pad16-seq-01-100bpm-x4-mono-stems.zip`: the
  pad's number is what keeps two pads with one sound apart; the sound's name is made of letters and digits.
- **Held, not rendered.** Each render is let go of once its file is encoded, so what is held is the encoded files (2 bytes a
  frame a channel each, all of them until the zip is made). `zipParts` does not copy them, but the Blob made of the parts is the
  browser's own copy, so while the parts are held the page has the files twice: the size note for stems counts twice the files. Progress is one fraction across the
  renders, each weighed by `renderCost` (the sounds it makes in each pass it schedules), and a cancel is looked at before
  the first and between every two (and inside each, as for a single file). The kit and the song are read by every render, so the page passes a snapshot
  of each, as for a single file: stems made from two states would not add up.
- **The size note counts the files twice** (`exportMemoryBytes`, with `stems`): the render, and each stem's file held and
  copied into the zip's Blob. Measured in Chromium, 16 stems of a dense 8-bar song at 100 BPM, 4 loops (77 s each, a 225 MB
  zip): the browser's memory peaked about 335 MiB over its baseline, against the note's 490 MB. So the note is about 30% high
  there, probably because the browser keeps the Blob's bytes outside the page's own memory; Firefox and Safari may not, and
  the note is a warning for phones, so it is left on the safe side (the mix's was a little low, 8%). The 16 stems took 24 s;
  the zip's size in the dialog (225 MB) was the file's (235,932,750 bytes) to the digit shown.
- **The zip** is stored, not compressed (a WAV does not shrink to anything worth the time): a header, the name and the bytes
  for each file, then the directory. Checked with `unzip -t` and Python's `zipfile` as well as with a reader in the tests. Not
  zip64: a file or an archive of 4 GiB or more, or 65,536 files, is refused.

## The song

The Sequences choice in the dialog, Showing or Song, exports the song as the Song panel has it: every entry in order, each as often as
it repeats, which is what Song mode plays ([#117](https://github.com/jaballer/audio-lab/issues/117) built it as every sequence once, as
"All", in step 3 of song mode in [#159](https://github.com/jaballer/audio-lab/issues/159); step 4 made it read the arrangement, and
renamed All to Song, the files too). A song nobody has edited has no arrangement, and is every sequence once, in order, as it was.
`songPasses(song)` in `export-wav.js` is the list of its passes, from `passOrder` in `arrangement.js` (the walk playback and export
share).

- **What is exported is a list of passes.** `planRender` builds `passList`, a pass for each stretch of the render, with the step it
  begins at and its hits. For the sequence showing it is the same one sequence over and over (the warm-up and the loops, as
  before: the numbers did not change); for the song it is a pass for each time round each entry. A sequence that comes round again
  shares its hits between its passes (they are the same each time, and the render only reads them), so a long song costs a pass of
  bookkeeping each and not a copy of the sequence. The hit feeder walks the list, so the two are one code path.
- **No warm-up, no loop seam, a tail.** Nothing comes round to ring into the start, so the file begins at its first step (the render's
  lead is the only thing before it), and ends with `SONG_TAIL_SECONDS` (4 s) for what rings on, where the loop's own tail is folded into
  its start. A fixed time, so that the dialog can say how long and how big the file is without the kit's releases; a sample longer than
  the tail is cut at its end. A pad's hit is cut by its next across the end of a pass, as the page's chain does, and that includes the
  next time round the same entry (a sequence that ends on a hit and begins on one cuts itself); the last hit of the whole is not cut.
- **A sequence the song leaves out is not in the file, and one that repeats is in it each time.** The dialog's heading counts the
  entries ("SONG · 3 ENTRIES · 100 BPM"), and what the song's length is, repeats and all, is the readout's to say. What the song plays
  is also what is asked about everywhere else: whether there is anything to export (`hasSteps`: a song that plays only empty
  sequences has nothing, though a sequence it leaves out has steps), which pads get a stem (`stemPads`), and which sequences the note
  names.
- **Empty sequences are kept**, as Song mode plays them: a pass of silence of their length (apart from what is still ringing from the one
  before). The dialog's note names the ones the song plays (once each, however often they come round: "Sequence 3 has no steps: nothing
  plays in it but what is still ringing."), and the dialog blocks Export only when no sequence the song plays has a step. The sequence
  showing does not have to be one with steps.
- **Loops do not apply**, so the Loops row goes and the file name leaves them out: `pad16-song-90bpm.wav`, `pad16-song-90bpm-mono.wav`,
  `pad16-song-90bpm-stems.zip` and `pad16-song-90bpm-pad03-snare.wav`. The choice is kept with the other options (`scope`: "sequence" or
  "song"; an older saved option means the sequence showing, and one saved as "all", which is what the song was called, is read as "song").
  The files were `pad16-all-…` in the version before the song had an order of its own: a rename of what lands in a downloads folder,
  made once, together with the choice's name.
- **Stems** are a stem of each pad that has a step in any sequence the song plays, each as long as the whole (the same timeline, so they
  add up to the mix), weighed by `plan.cost` (the sounds in every pass, repeats counted).
- **A cap on the length: 400 s, tail and all (`MAX_SONG_EXPORT_SECONDS`).** The Song panel lets a song be 32 entries of 16 repeats of up to
  eight bars, which is hours of audio, and the render and the file are each one buffer (see Memory below). 400 s is 6 min 40 s: as large as
  the biggest export made before a song could repeat (eight 8-bar sequences at 40 BPM, 388 s with its tail). Past it the dialog turns
  Export off, with the reason in place of the hint ("This song is 25 min 40 s long, and Export makes at most 6 min 40 s. Fewer repeats or
  entries make it shorter, or export one sequence at a time."), still says how long and how big the file would be, and has no note (a
  memory warning for a file that is not made is noise, and the plan of it is not worked out). `exportSequence` and `exportStems` ask
  again before they start (`SONG TOO LONG`), for a song that changed under an open dialog. Only the song has the cap: the sequence showing
  is made longer by its loops, a choice of four, which the memory note warns of as before. The cap is on time, so it is the same at any
  rate; the memory it means is not: 400 s is about 270 MB at 44.1 kHz, 290 at 48 and 590 at 96 (as the dialog counts, `exportMemoryBytes`), which the note
  warns of from 200 MB and does not stop, as for any export. A chunked render would lift the cap, and is not built.
- **Checked in a real browser (Chromium, 48 kHz), when the song was every sequence once.** Not run again for the arrangement: only which
  passes are listed changed (the hit feeder, the voices and the render are as they were), and what the tests with a fake audio context
  say about the order and the repeats is below.
  - A hip hop starter with an empty third sequence made `pad16-all-90bpm.wav`, 14.67 s and 2,816,044 bytes (3 bars of sound, the empty
    sequence, and the tail), what the dialog said; the stems zip and the mono files were the sizes it said too.
  - Every hit was within a frame and a half of where the grid puts it, with swing across the end of a sequence, from 22.05 to 96 kHz and 57
    to 240 BPM; the file begins at its first step; an empty sequence is silent apart from what rings through it; a pad's hit cuts its earlier
    one from the sequence before; and the stems, with loaded samples, trims, pitches, a long release and choke groups, sum to the mix to
    within -108 to -118 dB.
  - A sound longer than the tail is cut at the end of the file with no fade (an 8 s sample hit in the last bar leaves the file at about
    -35 dBFS), which the dialog's hint says: a loop never does that, as its tail comes round to its start.
- **Checked for the arrangement, in the running page (Chromium, 48 kHz) and in tests.** A song made in the Song panel (sequence 1 three
  times, then an empty sequence 3, with sequence 2 taken out) made `pad16-song-100bpm.wav`, 13.6 s and 2,611,244 bytes, what the dialog
  said; the three times round sequence 1 have the same loudness in every 50 ms and the empty one is silent, and the 4 s tail is silent
  (the starter's sounds are short, so nothing rings into it). The stems zip of a song of sequence 1 twice and an empty sequence made three
  stems named `pad16-song-100bpm-pad0N-…`, each 11.2 s, and a zip of 6,451,778 bytes against the dialog's 6.2 MB. A song of 7 min 9 s
  (a sequence of 8 bars sixteen times, and six more) turned Export off and said why, with no note, still giving its length and size; and an
  Export choice saved as "all" opened as Song. The tests cover the order, the repeats, a sequence left out, a pad cut across a repeat, the
  stems and the notes with a fake audio context. Not listened to: that a repeat is heard to come round on the beat, and the seam between
  entries, are for the ear. Firefox and Safari were not run.

What is not built: an end of song with a Loop switch is for the player, not the export (the file is the song once through), and a render
that is not one buffer.

- **Memory.** A bounce of eight 8-bar sequences at 40 BPM is 384 s (6.4 minutes) and 4 s: about as large as the biggest export today
  (8 loops of 8 bars, about 275 MB at the peak), so one buffer can still do it: measured, 388 s at 40 BPM finished in 4.1 s, and its peak was
  260 MB over the page across the browser's processes (the render, the WAV and the Blob) against the 261 MB the note works out, which
  is what the dialog's memory note says (and, since there are no loops, that exporting one sequence at a time makes it smaller). It grows with
  anything that repeats: the audit's synthetic case of eight 384 s sequences (3,072 s) held 1.08 GB of float for the render alone, and 517 MB each of
  WAV and Blob, which would kill a phone's tab. That is what the cap on a song's length is for: with repeats a song can come to that, and
  it is stopped at 400 s. Beyond it needs chunked rendering and output (a file built from encoded chunks and a Blob of them), not one buffer.
- **The dialog** has four choice groups wired by hand and a button that says WAV or ZIP; a second format touches the options, the
  name, the readout, the header title and the button.
