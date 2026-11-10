# Export: how it works, and why

The sampler's Export saves the sequence showing as a 16-bit WAV file, rendered as the page plays it. It was built over
several pull requests and then audited as a whole (fidelity to live playback, robustness, UX, and what stems and a
whole-song bounce will need). This records the decisions and what was measured. What is still to do is tracked in the
GitHub issues ([#116](https://github.com/jaballer/audio-lab/issues/116) stems,
[#117](https://github.com/jaballer/audio-lab/issues/117) whole song,
[#118](https://github.com/jaballer/audio-lab/issues/118) the speed-ups and guards still open in it: skipping hits that cannot reach the file), not here.

## Where it is

| File                                                  | What it does                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/sampler/export-wav.js`                          | The render (`planRender`, windows, `renderSequence`), the WAV encoder, `exportSequence`, `createExportAction`     |
| `apps/sampler/export-options.js`                      | The choices (loops, stereo or mono), what the file will be (length, size), the notes and reasons the dialog shows |
| `apps/sampler/export-dialog-state.js`                 | What the dialog shows and allows, the double-click guard, and what the page tells the dialog (all pure)           |
| `apps/sampler/export-dialog.js`                       | The `<dialog>`: draws what it is told and reports what is pressed                                                 |
| `apps/sampler/voices.js`, `kit.js`, `sample-voice.js` | One voice per pad and choke groups; the kit snapshot; a sample's source can be stopped                            |
| `shared/app-header.js`                                | The Export button, next to POWER (the `actions` option)                                                           |

## Decisions

**A button in the machine's header, not in the transport.** Export acts on the whole machine and is not a performance
control, so it sits with POWER, and the transport is Play, Stop, Rec and Tap Tempo. (The first version was an Export WAV
button in the transport, which also made that grid lopsided.) Connect MIDI and the Console stay in the site header, which
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
  export's. The file's size and the render's memory grow with the rate (48 kHz is 9% more than 44.1).
- **The loop's join.** A swept oscillator (kick, the snare's tone, toms, conga, zap, blip, and the
  bass's filter) that starts part way through a render block was made, for the first part of the block, from the default
  frequency before its first event, and what that did depended on where the hit fell in the block: a kick on the last step
  was one waveform on one pass and another, a phase apart, on the next, so the file's end did not join its start (a step of
  0.03 to 0.07 at 90 to 133 BPM, about -30 to -23 dBFS). `sweep` (`shared/dsp.js`) holds the start value before the sweep:
  the step is 0.0007 or less (-63 dBFS) at both rates, and the start of the file matches the same stretch inside a longer
  render to -59 to -75 dB for a kick, and to -36 dB at worst for seven pads on the last steps at 133 BPM (a phase
  difference in a tail, not a step: the ramp is still evaluated a block at a time, which a start inside the block cannot
  avoid). The same change makes the page's own kick start the same way every time. Only measured, not listened to.
- **Not bit-identical run to run** (one least significant bit in a few samples: the order the engine sums noise sources in);
  the noise sounds' buffer is shared and rebuilt when the audio rate changes, so an export and the page can differ in noise.
- **Firefox** should keep the old cost and have no percentage or mid-render cancel (above: expected from the missing method,
  not observed). Safari is untested.
- **`EXPORTED` is said even if the browser blocks the download**, which `saveBlob` cannot tell.
- **A pad whose saved sample fails to decode** plays, and exports, its built-in sound without saying so.

## What stems and a whole-song bounce will need

From the audit; none of it built.

- **What is exported has to be a value.** `emptyBars`, `hasSteps`, `exportFrames`, `exportInfo`, `exportName`, `exportTitle` and
  `planRender` read `song.sequences[song.current]` (`hitsOf` already takes a sequence). A bounce needs a list of sequences and stems a pad filter.
- **Stems and choke.** A pad rendered alone is not what the page plays when another pad in its choke group cuts it: either
  every hit is scheduled and only the wanted pad is audible, or each pad goes to a bus of its own. Stems are also expected
  unclipped and at unity volume, so the clipper and the master are decisions to make first.
- **Memory.** A bounce of eight 8-bar sequences at 40 BPM is 384 s (6.4 minutes): about as large as the biggest export today
  (8 loops of 8 bars, about 275 MB at the peak), so one buffer can still do it. It grows with anything that repeats: the
  audit's synthetic case of eight 384 s sequences (3,072 s) held 1.08 GB of float for the render alone, and 517 MB each of
  WAV and Blob, which would kill a phone's tab. Beyond today's size it needs chunked rendering and output (a file built from
  encoded chunks and a Blob of them), not one buffer. Stems should encode each pad to 16-bit and drop the float buffer at
  once; a zip needs a store-only writer with CRC32 and must not hold a second copy.
- **Progress** is one fraction; many renders need it composed (`[i/n, (i+1)/n]`). One export at a time (`createExportAction`)
  suits all three. 16 downloads without a gesture meet a browser's "multiple downloads" prompt: a zip avoids it.
- **The dialog** has two choice groups wired by hand and a hard-coded "WAV"; a second format touches the options, the name,
  the readout, the header title and the button.
