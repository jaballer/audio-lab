# Changelog

What changed on the live site, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no version numbers or tags: every merge to `main` deploys to GitHub Pages, so entries are grouped by the day
they merged. Internal refactors, tooling and docs are listed under **Maintenance** and leave out the page's behaviour.
Numbers link to the pull request.

## [Unreleased]

### Added

- A footer on every page with links to the source code, the documentation, the design notes, the changelog, the issue
  tracker, the author's GitHub profile and the license. They open in a new tab, so the sampler keeps playing ([#169](https://github.com/jaballer/audio-lab/pull/169))

### Maintenance

- A beat can carry an arrangement, the order a song will play its sequences in, each with a number of repeats (saved
  format 10). It changes nothing on the page yet: nothing reads or edits it, a beat saved by an older page loads as it
  did, and a sequence added, copied or removed is followed in it
  ([#170](https://github.com/jaballer/audio-lab/pull/170))
- The docs are a short set with an index, `docs/README.md`, for people and coding agents alike: `architecture.md` (how
  the code fits together, and the file-by-file list that was in the README), `sampler.md`, `export.md` and
  `mpc-sample.md`. The sequencer and step-editing notes are folded into them, `AGENTS.md` links to `CLAUDE.md`, and the
  footer's Design notes link says what it now holds ([#172](https://github.com/jaballer/audio-lab/pull/172))

## 2026-11-11

### Added

- Sampler: Play All. The All key, at the end of the transport row, plays the sequences one after the other, round and
  round: lit, each pass is followed by the next sequence and the last by the first, until Stop. Play begins with the
  sequence showing, a sequence queued with the keys goes first and the order goes on from it, and the display says ALL
  where it says SEQ. It is off each time the page opens, and a chain that plays does not save the beat as it goes, so
  another open tab is not told it is out of date ([#166](https://github.com/jaballer/audio-lab/pull/166))
- Sampler: Export can save all the sequences in order. A Sequences choice in the Export window, Showing or All, saves
  every sequence once each as one file, or as a zip with a stem for each pad that has a step, with four seconds on the
  end for what rings on and no loop to come round (a longer sound is cut). An empty sequence is a stretch of silence,
  as Play All plays it, and the window names it. The files are called `pad16-all-…`
  ([#167](https://github.com/jaballer/audio-lab/pull/167))

### Changed

- Sampler: the display shows what sounds. For the moment between one sequence taking over and its first step sounding
  (a quarter of a second at 100 BPM), the display stays on the sequence that gave way while the keys and the step
  editor are already on the new one, and a press on a sequence key, or on All, just ahead of the end of a pass acts at
  that end and not a pass later ([#166](https://github.com/jaballer/audio-lab/pull/166))

### Maintenance

- The export's plan is a list of passes (the sequence showing looped, or every sequence once each), which an edited
  order of sequences can fill later; `docs/export.md` says how all the sequences are exported and what was
  measured ([#167](https://github.com/jaballer/audio-lab/pull/167))

## 2026-11-10

### Added

- Sampler: Starters. A Starter list and a Start button in the controls row replace the beat and the pad settings with
  a hip hop (90 BPM), techno (130), house (124) or trap (140) beat to begin from. Start asks first; the volume stays,
  and so do the samples on the pads with the gain, pitch and envelope set on them. Hip hop and house carry a swing, 58
  and 54 per cent ([#155](https://github.com/jaballer/audio-lab/pull/155),
  [#157](https://github.com/jaballer/audio-lab/pull/157))
- Sampler: a Swing knob sounds the second step of each pair later, from 50 per cent (straight, as it was) to 75. It is
  saved with the beat, an exported file swings the same, and a pad hit recorded live is placed by when the steps sound
  ([#156](https://github.com/jaballer/audio-lab/pull/156))
- Sampler: a beat starts with one sequence and can have up to eight. A row of keys under the display chooses the
  sequence showing; + adds an empty one, Copy adds a copy of the one showing, and − removes it (asking first when it
  has steps). A beat saved before this keeps the sequences that are used and drops the empty ones after them
  ([#162](https://github.com/jaballer/audio-lab/pull/162))
- Sampler: while a beat plays, a press on a sequence's key makes that sequence play next, where the pass ends: its key
  blinks (or is only ringed, with reduced motion) and pressing it again takes that back. Shift switches at once
  ([#163](https://github.com/jaballer/audio-lab/pull/163))
- Sampler: a Next key, beside +, Copy and −, turns that round: off, a press on a sequence switches at once and Shift
  waits for the end of the pass. A touch screen has no Shift, so this is how it switches at once; the page keeps the
  choice ([#165](https://github.com/jaballer/audio-lab/pull/165))
- Sampler: two bars at the right of the display show how loud the left and right of the output are, with a lamp at the
  top that lights when the sound is pressed against the clipper's ceiling
  ([#161](https://github.com/jaballer/audio-lab/pull/161))
- Sampler: a Velocity switch in the step tools shows or hides the velocity bars, which are hidden to begin with; the
  page remembers which ([#158](https://github.com/jaballer/audio-lab/pull/158))

### Changed

- Sampler: the display has a line each for the sequence, the pad, the tempo, the bar and the step, with the step ruler
  and the progress bar along the bottom ([#161](https://github.com/jaballer/audio-lab/pull/161))
- Sampler: the header and controls are tidied. The Console button is gone from every page's header (the log still
  collects), MIDI and Lights sit beside Power, Edit Pad has no lamp, and the starter you started shows in the list
  after the page reloads ([#158](https://github.com/jaballer/audio-lab/pull/158))
- The message on a browser without Web MIDI says "MIDI: not supported in this browser"; it told people to use Chrome
  or Edge, while Firefox is supported ([#153](https://github.com/jaballer/audio-lab/pull/153))

### Fixed

- Sampler: the display's step counted only within the bar, so key 22 could light while the display said step 6
  ([#161](https://github.com/jaballer/audio-lab/pull/161))

### Maintenance

- The unused `ctx` argument of `envelope` in `shared/dsp.js` is gone. No change to what plays
  ([#153](https://github.com/jaballer/audio-lab/pull/153))
- The scheduler says where a pass ends (`onWrap`, also for each pass end a stall crosses) and lets the next pass be
  another length (`startPass`); queuing a sequence, and later Play All, are built on it
  ([#163](https://github.com/jaballer/audio-lab/pull/163))

## 2026-11-09

### Added

- Sampler: a colour for each pad, set in the pad editor from a fixed row of swatches. It shows as the pad's rim, is
  named for a screen reader, and is saved with the song ([#124](https://github.com/jaballer/audio-lab/pull/124)).
- Sampler: an amplitude envelope per pad for loaded samples: Attack, Decay, Sustain and Release sliders in the pad
  editor, drawn on the sample's waveform. Release is also how long a hit fades out the pad's last one. Saved with the
  song ([#125](https://github.com/jaballer/audio-lab/pull/125)).
- Sampler: the step editor, and the pad editor's Tune and Envelope sections, can be collapsed with a button on their
  headings. The page remembers which are open ([#126](https://github.com/jaballer/audio-lab/pull/126)).
- Sampler: a thin progress bar along the bottom of the display, under the step ruler, shows where the playhead is in the
  whole sequence, one segment per bar ([#128](https://github.com/jaballer/audio-lab/pull/128)).
- Sampler: Shift with a click on a pad, or with the pad's computer key, selects the pad and opens the pad editor
  without playing it, so a pad can be set up in the middle of a take. Opened by key, focus moves to the editor
  ([#127](https://github.com/jaballer/audio-lab/pull/127), [#130](https://github.com/jaballer/audio-lab/pull/130)).
- Sampler: an export shows its progress and can be cancelled, with the Cancel export button or Escape
  ([#129](https://github.com/jaballer/audio-lab/pull/129), [#136](https://github.com/jaballer/audio-lab/pull/136)).
- Sampler: Export opens a window to choose 1, 2, 4 or 8 loops of the sequence in one file, and stereo or mono, with
  the file's length and size shown before it is made ([#136](https://github.com/jaballer/audio-lab/pull/136)).
- Sampler: the Export window says, before the file is made, which bars have no steps (a file is as long as all its bars) and
  when it needs a lot of memory (from about 200 MB; a phone may not have it), and it says why Export is off for a
  sequence with no steps or a browser that cannot render a file
  ([#136](https://github.com/jaballer/audio-lab/pull/136), [#137](https://github.com/jaballer/audio-lab/pull/137),
  [#140](https://github.com/jaballer/audio-lab/pull/140)).
- Sampler: Export can make stems: choose Stems in the Export window and it saves a WAV for each pad that has steps,
  in one zip, so the parts can be mixed elsewhere. Each is the length of the sequence, with the loops and channels
  chosen, and with the cuts of its choke group; they are at the page's master volume and not clipped, and add up to
  the mix. The window counts the stems and sizes the zip, shows which one it is rendering, and says how much memory
  it needs ([#144](https://github.com/jaballer/audio-lab/pull/144)).
- Sampler: the step editor's heading names the selected pad
  ([#132](https://github.com/jaballer/audio-lab/pull/132)).
- Every page works offline and can be installed as an app. A newer version of the site waits until you press Reload
  on the "A new version is ready" strip, so an update never interrupts playing ([#134](https://github.com/jaballer/audio-lab/pull/134)).
- Sampler: a light show behind the machine. A Lights button turns on a glow on the desk: four lights orbit the window
  at a pace that follows the tempo, the colour runs from blue to red with how loud the output is, and each pad hit
  bursts from its pad in the pad's colour. It is kept between visits, and starts off for a person who asked for
  reduced motion ([#147](https://github.com/jaballer/audio-lab/pull/147))
- Sampler: the display and the pads boot up and shut down with the power switch. The page starts powered off, with a
  dark, blank display and dim pads; the first interaction boots it, with lines typing onto the display and light
  sweeping across the pads, and switching off runs it backwards (reduced motion skips the sweeps)
  ([#148](https://github.com/jaballer/audio-lab/pull/148))
- Sampler: Save and Open. Save downloads a `.audiolab` project file with the beat, the tempo, the volume, the pad
  settings and the samples; Open reads one back (and asks first, since it replaces the beat on the page), refusing a
  damaged file whole. This is for when the browser's storage is cleared
  ([#149](https://github.com/jaballer/audio-lab/pull/149))
- Sampler: a tab left open no longer saves an old beat over a newer one. When another tab changes the beat or the
  samples, this tab stops saving and says so with a Reload and a Later; after Later, each save it skips says NOT
  SAVED: CHANGED IN ANOTHER TAB ([#150](https://github.com/jaballer/audio-lab/pull/150))

### Changed

- Sampler: the tempo knob moves in whole BPM when dragged, scrolled or stepped with the arrow keys. Shift changes the
  size of a move: Shift + drag moves a tenth of a BPM per pixel, and Shift + scroll or arrow steps by 10
  ([#127](https://github.com/jaballer/audio-lab/pull/127)).
- Sampler: a long or dense export renders far faster (a dense 8-bar song at 40 BPM took 273 s and takes about 7), and a
  cancelled export no longer keeps growing the page's memory ([#139](https://github.com/jaballer/audio-lab/pull/139)).
- Sampler: an export is made at the sample rate the page's audio runs at (44.1 or 48 kHz on most machines), and the
  Export window says which, so a loaded sample is no longer resampled a second time on its way into the file, which
  took 1.2 dB off 10 kHz and 4 dB off 19 kHz ([#142](https://github.com/jaballer/audio-lab/pull/142)).
- Sampler: a new layout. The pads move to the right, so the pad editor opens beside them; a row of the machine's own
  controls (Volume, Tempo with a Tap key, Seq, Edit Pad) sits above the display; Volume is a rotary knob like the
  tempo knob, and the bar lengths are one joined group with the chosen one pressed in. POWER is a rocker switch in the
  machine's header on the sampler, keyboard and Tone.js pages ([#145](https://github.com/jaballer/audio-lab/pull/145))
- Sampler: a pass of polish. Lime and cyan are gone from the pad colours (a colour saved from lime on shows as
  another one), pressing an empty velocity bar turns its step on at that height, Rec is red, the bar arrows sit with
  the Bars keys, and Help is collapsible on every page ([#146](https://github.com/jaballer/audio-lab/pull/146))
- Connect MIDI, its status and the Console move from the site bar into the machine's header, beside Export and POWER,
  on the four pages that use MIDI ([#146](https://github.com/jaballer/audio-lab/pull/146))
- Sampler: Open, Save and Export are a File group in the controls row, and MIDI is a lit switch that says whether the
  page is listening and stops listening when pressed again (on every page that has it)
  ([#152](https://github.com/jaballer/audio-lab/pull/152))

### Fixed

- Sampler: pressing a button no longer makes the page jump: Rec, Export and Edit Pad used to shift the buttons and panels
  around them by a pixel or two ([#135](https://github.com/jaballer/audio-lab/pull/135)).
- Sampler: in forced-colours (high contrast) modes the Export window is readable and a lit button can be told from an
  unlit one ([#137](https://github.com/jaballer/audio-lab/pull/137)).
- Sampler: the Export button can no longer be left stuck when something goes wrong as an export starts, and a failure to
  bring back the saved samples says so (`SAMPLES FAILED TO LOAD`) instead of "export failed"
  ([#137](https://github.com/jaballer/audio-lab/pull/137)).
- Sampler: an exported loop no longer clicks where its end meets its start when a kick, snare, tom, conga, zap or blip
  falls on the last steps (the click was about -30 to -23 dBFS and is now below -50), and those sounds start the same way
  on every hit on the page too ([#142](https://github.com/jaballer/audio-lab/pull/142)).
- Sampler: the progress bar along the display follows the playhead again, and its boot sweep respects reduced motion
  ([#151](https://github.com/jaballer/audio-lab/pull/151))

### Maintenance

- The export's render split into a plan and pieces, and the kit can be snapshotted so a render never hears a pad edited under
  it ([#138](https://github.com/jaballer/audio-lab/pull/138)).
- What the Export dialog shows and allows is pure and tested, apart from the DOM it is drawn into, and
  `docs/export.md` records how the export works, what was measured and what stems and a whole-song bounce will need
  ([#141](https://github.com/jaballer/audio-lab/pull/141)).
- The engine for per-pad stems (a pad rendered on its own, with its choke group's cuts, so the stems add up to the mix) and
  a zip writer for them; the page does not offer stems yet ([#143](https://github.com/jaballer/audio-lab/pull/143)).

## 2026-11-08

### Added

- A fixed site header on every page: the site name, a link to each page, Connect MIDI with its short status, and a
  Console button ([#50](https://github.com/jaballer/audio-lab/pull/50)).
- A console drawer along the bottom of the window with the MIDI detail the header leaves out (every input port the
  browser lists, plug and unplug events, errors), with Copy and Clear
  ([#50](https://github.com/jaballer/audio-lab/pull/50)).
- MPC Sample page: PLAY and STOP lamps and the tempo read from the device's MIDI clock, bar and beat on the LCD
  (the sequence length and time signature can be set), Play and Stop buttons that start and stop the device, and
  Space to play or stop ([#48](https://github.com/jaballer/audio-lab/pull/48)).
- MPC Sample page: each pad plays the sampler's sound for it, with velocity, and a Sound button turns that off
  ([#49](https://github.com/jaballer/audio-lab/pull/49)).
- Sampler: a velocity for every step. Bars under the step keys show how hard each step plays; drag along them (or
  use the keyboard) to set it. It is saved with the song, and a step recorded live keeps the velocity of the hit
  ([#94](https://github.com/jaballer/audio-lab/pull/94)).
- Sampler: Undo and Redo for the steps (also Ctrl/Cmd + Z), and Copy Steps and Paste Steps, which copy the bar
  showing for the selected pad onto another bar, pad or sequence
  ([#95](https://github.com/jaballer/audio-lab/pull/95), [#98](https://github.com/jaballer/audio-lab/pull/98)).
- Sampler: drop an audio file on a pad (up to 10 seconds and 5 MB) to play it there. It is kept in this browser
  between visits ([#97](https://github.com/jaballer/audio-lab/pull/97)). The page asks the browser to keep it, sizes
  the total cap from the browser's quota, and shows the space used
  ([#99](https://github.com/jaballer/audio-lab/pull/99)).
- Sampler: a pad editor beside the pads (Edit Pad) with Load Sample, Default Sound, and a Gain and a Pitch slider
  for the selected pad ([#101](https://github.com/jaballer/audio-lab/pull/101),
  [#102](https://github.com/jaballer/audio-lab/pull/102)), and the waveform of a loaded sample with a Start and an
  End to trim it ([#104](https://github.com/jaballer/audio-lab/pull/104)).
- Sampler: Export, in the machine's header beside Power, saves the sequence showing as an audio file of exactly its
  length, so it loops. It is rendered as the page plays it: the sounds and samples, each step's velocity, the pads'
  settings and the master volume ([#111](https://github.com/jaballer/audio-lab/pull/111)).
- Sampler: Stop pressed again, while the sequence is already stopped, cuts off all sound, such as a crash's tail or a
  long sample ([#109](https://github.com/jaballer/audio-lab/pull/109)).
- Sampler: choke groups. A Choke slider in the pad editor puts a pad in a group from 1 to 8; pads in the same group
  cut each other off, like a closed hat cutting an open one. Saved with the song
  ([#123](https://github.com/jaballer/audio-lab/pull/123)).
- Tone page: the keys as a piano, value readouts, and Release, Echo time and Feedback controls
  ([#78](https://github.com/jaballer/audio-lab/pull/78), [#82](https://github.com/jaballer/audio-lab/pull/82)).
- Keys page: the K1–K8 dials can be turned with the mouse (drag, scroll or arrow keys), and they follow the sliders
  ([#57](https://github.com/jaballer/audio-lab/pull/57)).
- A POWER switch on the sampler, keys and tone pages: it turns sound on and off, and off stays off until it is pressed
  again ([#60](https://github.com/jaballer/audio-lab/pull/60)).
- MPC Sample page: the same POWER switch, so the pads' sound can be turned off
  ([#62](https://github.com/jaballer/audio-lab/pull/62)).
- MPC Sample page: a step sequencer. Click a pad to pick it, turn its step keys on, and Play starts the device and
  sends it a note for each step, so it plays its own sounds in time with the page's clock. It follows the sequence's
  bars and time signature (16 steps shown at a time), covers every pad of every bank, and has its own Tempo field.
  The steps are not saved between visits yet.

### Changed

- Each page's helper text moves from a footnote inside the machine to a Help panel below it
  ([#52](https://github.com/jaballer/audio-lab/pull/52)).
- Each page starts behind a loading overlay, lifted once fonts and the first frames have settled, so the page no
  longer jumps while its scripts build it ([#51](https://github.com/jaballer/audio-lab/pull/51)).
- Keys page: laid out like a controller, and the knobs' values show on the LCD
  ([#103](https://github.com/jaballer/audio-lab/pull/103)).
- MPC Sample page: the device's own Play and Continue drive the sequencer, the page follows the device's clock
  instead of sending one, and the page no longer plays browser sounds: the device is the sound source
  ([#81](https://github.com/jaballer/audio-lab/pull/81), [#84](https://github.com/jaballer/audio-lab/pull/84),
  [#85](https://github.com/jaballer/audio-lab/pull/85)).
- MPC Sample page: Play starts the device at the Tempo field's tempo (120 BPM until it is changed), not at the
  tempo last heard from the device.
- Every page shows the same "sound is off" banner until the first click or key press (it replaces the sampler's own
  banner and the keys and tone pages' header line), shakes when a MIDI hit arrives while sound is off, and on touch
  screens appears only then ([#60](https://github.com/jaballer/audio-lab/pull/60)).
- MPC Sample page: the Stop and Play lamps are the buttons (Stop first, as on the device). Play starts the device by
  sending Start and a steady clock, so the device follows the page's tempo while it plays. The separate Play and
  Stop buttons, the Space shortcut and the Sound button are gone: the pads always play the sampler's sounds
  ([#61](https://github.com/jaballer/audio-lab/pull/61)).
- Sampler: a pad plays one voice at a time. Tapping a pad that is still playing a long sample fades the earlier hit
  out, as on a hardware sampler ([#110](https://github.com/jaballer/audio-lab/pull/110)).

### Fixed

- Sampler: the LCD is no longer a live region, so screen readers stop announcing every step
  ([#96](https://github.com/jaballer/audio-lab/pull/96)).
- Loud steps no longer crackle: a soft clipper after the master volume keeps sounds that add up past full scale from
  clipping. It applies to every page that makes sound ([#108](https://github.com/jaballer/audio-lab/pull/108)).
- Sampler: loading, resetting and trimming samples on one pad happen in order, and two tabs no longer erase each
  other's samples. Power off builds no sound and records no silent hit, a very short trim is no longer cut or
  silent, a song the page cannot read is backed up before it is saved over, and Undo and Redo jump to the pad and bar
  they changed ([#105](https://github.com/jaballer/audio-lab/pull/105)).
- Sampler: screen readers no longer hear the same text announced again on every step while playing, a control that
  goes disabled keeps focus where the person was, the selected pad is marked, a right or middle click on a pad is no
  longer a hit, and text and small buttons have more contrast and size
  ([#106](https://github.com/jaballer/audio-lab/pull/106)).
- Tone page: the computer keys keep playing after using a slider or menu
  ([#79](https://github.com/jaballer/audio-lab/pull/79)).

### Maintenance

- The drum sounds move to `shared/` so more than one page can play them
  ([#49](https://github.com/jaballer/audio-lab/pull/49)).
- Project skills for shipping work here, in `.claude/skills/`
  ([#100](https://github.com/jaballer/audio-lab/pull/100)).
- Tests for behaviour that was not pinned, a fix for a negative velocity key when filling steps, and the docs brought up
  to date ([#107](https://github.com/jaballer/audio-lab/pull/107)).

## 2026-11-07

### Added

- Tone demo page: a polyphonic [Tone.js](https://tonejs.github.io/) synth into a feedback delay. It is the only page
  that loads Tone.js ([#46](https://github.com/jaballer/audio-lab/pull/46)).
- MPC Sample page, and a device profile for the Akai MPC Sample in the sampler: its pads play pads 1-16 in any of the
  eight pad banks, and the page shows hits, velocity, pressure and the selected bank
  ([#47](https://github.com/jaballer/audio-lab/pull/47)).
- MIDI monitor page: every message a device sends, with its raw bytes, and a table of which notes were hit on which
  channel ([#30](https://github.com/jaballer/audio-lab/pull/30)).
- The sampler remembers its pattern, tempo and volume between visits
  ([#7](https://github.com/jaballer/audio-lab/pull/7)).

### Changed

- The Launchpad profile covers only the legacy models (Launchpad, Launchpad S, Launchpad Mini mk1/mk2). Newer or
  unrecognized Launchpads use the generic mapping (notes 36-51) and their LEDs are not controlled
  ([#32](https://github.com/jaballer/audio-lab/pull/32)).
- The project is renamed from `pad-sampler` to `audio-lab`. The saved-song storage key keeps its old name, so existing
  beats still load ([#45](https://github.com/jaballer/audio-lab/pull/45)).

### Fixed

- A pad's flash on the sampler ended early when it was hit again quickly
  ([#44](https://github.com/jaballer/audio-lab/pull/44)).
- Notes no longer stick on the keys page: a second finger no longer overwrites the first, notes end when the window
  loses focus or a pointer is cancelled, a note held from two sources stops only when the last lets go, and an
  unplugged MIDI keyboard releases what it held ([#29](https://github.com/jaballer/audio-lab/pull/29)).
- A recorded hit no longer sounds twice at slow tempos ([#20](https://github.com/jaballer/audio-lab/pull/20)).
- The sampler's playhead queue is bounded while nothing is reading it
  ([#19](https://github.com/jaballer/audio-lab/pull/19)).
- Steps missed during a main-thread stall are skipped, not played in a burst
  ([#18](https://github.com/jaballer/audio-lab/pull/18)).

### Maintenance

- Both pages route MIDI through device profiles and a shared router
  ([#4](https://github.com/jaballer/audio-lab/pull/4), [#6](https://github.com/jaballer/audio-lab/pull/6),
  [#37](https://github.com/jaballer/audio-lab/pull/37)).
- The keys page draws its controls from one parameters table
  ([#2](https://github.com/jaballer/audio-lab/pull/2)), and its views and controller are split out of `main.js`
  ([#3](https://github.com/jaballer/audio-lab/pull/3), [#36](https://github.com/jaballer/audio-lab/pull/36)).
- The sampler is split into pattern, transport, tempo and view modules
  ([#5](https://github.com/jaballer/audio-lab/pull/5)), with a controller that owns its state and actions
  ([#35](https://github.com/jaballer/audio-lab/pull/35)), shared layout constants and versioned song migrations
  ([#38](https://github.com/jaballer/audio-lab/pull/38)).
- The drum sounds' building blocks move to `dsp.js` ([#39](https://github.com/jaballer/audio-lab/pull/39)).
- Pad class names are scoped per page ([#44](https://github.com/jaballer/audio-lab/pull/44)).
- Tests for the shared audio and MIDI modules and the drum sounds
  ([#27](https://github.com/jaballer/audio-lab/pull/27)); a `coverage` script, a pinned Node range and weekly
  Dependabot updates ([#22](https://github.com/jaballer/audio-lab/pull/22)).
- A Dependabot skill ([#34](https://github.com/jaballer/audio-lab/pull/34)) and the GitHub Actions bumps it handled
  ([#23](https://github.com/jaballer/audio-lab/pull/23), [#24](https://github.com/jaballer/audio-lab/pull/24),
  [#25](https://github.com/jaballer/audio-lab/pull/25), [#26](https://github.com/jaballer/audio-lab/pull/26)).
- Documented testing with MIDI hardware ([#33](https://github.com/jaballer/audio-lab/pull/33)) and the
  branch-and-pull-request workflow ([#1](https://github.com/jaballer/audio-lab/pull/1)).

## 2026-11-06

First day, before pull requests were required.

### Added

- The pad sampler: 16 synthesized drum pads and a 16-step sequencer
  (`dc0fcf0`), restyled as a hardware pad sampler with a REC mode (`1e8c6ec`).
- Web MIDI support with a Novation Launchpad mapping and LED feedback (`197e302`).
- A MIDI keyboard test page (`65b6958`), restyled like a compact controller (`6a9ba1a`), with an adjustable ADSR
  envelope (`95d0977`) and knobs mapped to the synth (`edd23ef`).
- Deploy to GitHub Pages with Actions (`41d84bf`), gated on `npm run check` (`f5aa657`).

### Maintenance

- The sampler and keyboard become separate apps with shared modules (`ffcbeec`); Prettier, ESLint and Vitest are added
  (`de70131`, `8da31fa`, `20421a1`); `CLAUDE.md` conventions are written (`7a60b93`).

[Unreleased]: https://github.com/jaballer/audio-lab/compare/07b2f9a...main
