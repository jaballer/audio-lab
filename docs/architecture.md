# Architecture: how the code fits together

How the site is built, for a person or an agent about to change it: the shape of a page, the paths sound, MIDI and
saved data take, and every file and what it is for. The rules that keep this shape (and that a review checks) are in
[CLAUDE.md](../CLAUDE.md); why a feature works the way it does is in the page for it ([sampler](sampler.md),
[export](export.md), [MPC Sample](mpc-sample.md)).

## The big picture

A static site: five HTML pages built by Vite, no server, no accounts, no framework. Every sound is synthesized or decoded in
the browser with Web Audio; controllers come in through Web MIDI. Tone.js is the only runtime dependency, and only the Tone
demo page loads it.

```text
index.html ──> apps/sampler/main.js ──┐
keyboard.html ─> apps/keys/main.js ───┤      each main.js only wires: finds its elements, builds the logic and the
monitor.html ──> apps/monitor/main.js ┼───>  views, and connects the inputs to them
mpc-sample.html > apps/mpc-sample/... ┤
tone-demo.html ─> apps/tone-demo/... ─┘
                                       uses shared/ (audio, MIDI, scheduler, pattern, storage, header, footer, offline)
```

## A page has three kinds of module

| Kind   | What it does                                                                                 | Examples                                   | Tested?                                 |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| Logic  | State and rules. No DOM, nothing at import time: exports functions, factories and plain data | `controller.js`, `song.js`, `scheduler.js` | Yes, in Node (`*.test.js` beside it)    |
| View   | `create…(element, options)`: draws into the element it is handed, reports what was pressed   | `pads.js`, `lcd.js`, `step-keys.js`        | Its pure helpers are (`formatLcd`, ...) |
| Wiring | `main.js`: finds the elements, builds the rest, connects MIDI and the computer keyboard      | `apps/*/main.js`                           | No: checked in the running page         |

A view does not decide: a pad press goes to the controller, the controller changes its state and calls `onChange`, and
`main.js` reads `getState()` and redraws. Views write only what changed (`shared/dom-updates.js`), because the sampler redraws
on every step and a screen reader would announce the same text again.

## Sound

```text
pad hit / step ──> kit.voice(i).play(time) ──> voices.js (one voice a pad, choke groups) ──> audio.master
                                                                                                │
                              shared/audio.js: master gain ──> soft clipper ──> speakers + analysers (lights, level meter)
```

- **One engine.** `shared/audio.js` owns the `AudioContext` and the master gain. Nothing else makes either. The context is
  created on the first user gesture (`audio.ensure()`), because browsers do not allow sound before one.
- **The audio clock, not timers.** `shared/scheduler.js` wakes on a timer but schedules each step at an `AudioContext` time
  about 0.12 s ahead; the playhead on screen follows separately. The MPC Sample page runs the same scheduler on
  `performance.now()` time and sends MIDI notes with timestamps instead of making sound.
- **Export is the same graph, offline.** The WAV export plays the song into an `OfflineAudioContext` with the same kit, voices
  and clipper, so the file is what the page plays ([export.md](export.md)).

## MIDI

```text
navigator.requestMIDIAccess ──> shared/midi-access.js ──> parseMidi (shared/midi-messages.js) ──> createMidiRouter
                                                                                                      │
             device profile (apps/*/devices.js): match(portName), translate(msg) ──> app events: pad, knob, sustain...
                                                                                                      │
                                                                     main.js / apps/sampler/midi.js ──> controller
```

A controller's numbers (CCs, notes, channels, LED colours) live only in its profile. Supporting another controller means a
new profile, matched against the exact port name the browser reports (see "Testing with MIDI hardware" in `CLAUDE.md`).

## What is kept, and where

Nothing leaves the browser. All of it is read through code that never throws, because storage can be full, blocked or
empty (a private window), and the page must work without it.

| What                                                                           | Where                                                   | Code                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------- |
| The sampler's song: sequences, arrangement, tempo, swing, volume, pad settings | `localStorage` `pad-sampler:song` (versioned, migrated) | `apps/sampler/song.js` via `shared/storage.js` |
| Which pad has which sample, and its trim                                       | `localStorage` `pad-sampler:samples`                    | `apps/sampler/samples.js`                      |
| The samples' bytes                                                             | IndexedDB                                               | `shared/blob-store.js`                         |
| Small preferences (export options, drawer, lights...)                          | `localStorage` `pad-sampler:*`                          | `apps/sampler/main.js`                         |
| A whole beat, as a file the person keeps                                       | `.audiolab` (a zip: `project.json` and the samples)     | `apps/sampler/project.js`, `zip.js`            |

A song saved by an older page is upgraded (`MIGRATIONS` in `song.js`); one from a newer page is ignored rather than
misread. A tab that sees another tab save stops saving its older copy (`tab-sync.js`).

## Offline and updates

A production build emits a service worker (`shared/sw-template.js`, filled in by the `emit-service-worker` plugin in
`vite.config.js`) that keeps every page and script. A new build waits until the person presses Reload in the update notice:
reloading mid-beat would lose their place. It is off in `npm run dev`.

## Sequencer: what is shared between pages

The sampler and the MPC Sample page both run step sequencers. They share the generic parts and each keep their own
controller:

- `shared/pattern.js`: a rows × steps grid, with a velocity per step.
- `shared/tempo.js`: BPM limits, step length, swing, tap tempo, `nearestStep`.
- `shared/scheduler.js`: the lookahead scheduler. It takes a `clock` (`{ now(), prepare?() }`), so it runs in audio time
  (the sampler) or in MIDI time (the MPC page), and `onStep(step, time)` is the seam to whatever plays the step.
- `shared/step-keys.js` + `step-keys.css`: the row of step keys.

Not one global sequencer, because the pages differ where it matters:

1. **Clocks.** The sampler schedules in `AudioContext` time; the MPC page in `performance.now()` time, the domain of Web MIDI
   timestamps.
2. **Who leads.** The MPC page follows the device's own clock and sends it notes; it makes no sound of its own and sends no
   clock (that made the device distort: [mpc-sample.md](mpc-sample.md)).
3. **What else a controller holds.** The sampler's `controller.js` also has pad selection, LCD messages, recording and
   Launchpad lights. A shared module that owned all of that would be the sampler's controller under another name.

`apps/sampler/song.js` (saving) stays with the sampler until a second page needs it; a module is shared when a second
page uses it, so its API comes from two real users.

## Files

Each app is its own page with its own code; shared code lives in `shared/`.

- `index.html` + `apps/sampler/` — the pad sampler
  - `main.js` — wires the page: connects the pads, step keys, tempo knob, computer keyboard and MIDI to the sampler and the views
  - `controller.js` — the sampler's state (selected pad, recording, volume, the current sequence) and every action on it (hit a pad, toggle a step, record, tap tempo...), with the follow-ups each one needs (LCD message, save, redraw); no DOM
  - `layout.js` — how many pads (and in what grid), steps per bar, the most bars and the most sequences the sampler has, decided once (a beat starts with one sequence); the pad grid, step keys, key map and Launchpad profile read it; no DOM
  - `format.js` — small text helpers for the display, messages and the pad editor (a sample's name, size and length); no DOM
  - `knob-moves.js` — how far a drag, wheel turn or key press moves the tempo knob (whole BPM, Shift for tenths or tens), which the volume knob uses too, and the angle a knob's pointer turns to; no DOM
  - `starter-beat.js` — the beat a first visit starts with, so Play makes noise right away; no DOM
  - `starters.js` — a few complete beats to start from, one per style (hip hop, techno, house, trap): tempo, patterns written as step grids, swing, and the pad settings that go with them (choke group, colours), built into the song `song.js` keeps; the pads' sounds are the same in every starter; no DOM
  - `song.js` — what is kept between visits (the sequences, tempo, volume): the saved format, upgrading older versions, checking it on load, and the debounced saver; no DOM
  - `arrangement.js` — the order a song plays its sequences in (each with a number of repeats; none until a person edits it, which means every sequence once, in order): cleaning what was saved, following a sequence added or removed, and the order of the passes; no DOM
  - `kit.js` — what each pad plays and how: the built-in sound or a sample loaded onto it, and the pad's settings: gain, pitch, envelope, choke group and colour (`voice(i).play` is what the sequencer and live hits call); no DOM
  - `voices.js` — one voice at a time on each pad: a pad hit again cuts off what it was still playing, and so do the other pads in its choke group (a fade on the audio clock), live, in the sequence or in the export; no DOM
  - `pad-envelope.js` — the shape of a pad's amplitude envelope (attack, decay, sustain, release) as the points a gain is ramped through, laid over the time a sample is heard for; no DOM
  - `pad-colors.js` — the fixed set of colours a pad can be given (with names for a screen reader); no DOM
  - `level-meter.js` — the maths behind the level meter on the display: the loudness (RMS, in dB below full scale) of each side of the output as lit segments, with a clip lamp for its peaks, and a reader that takes the page's two channel analysers; no DOM
  - `export-wav.js` — exports the sequence showing (or, with the scope set to all, every sequence in order, once each, with a tail on the end and no loop) as a WAV file: plays it into an offline audio context with the page's sounds, velocities, pad settings, retrigger cuts, volume and clipper, over two passes so the file (exactly the length of the bars) loops, then encodes 16-bit PCM; 1, 2, 4 or 8 loops of it can be kept in one file, in stereo or mono; the render is scheduled a second of audio at a time, so its cost grows with the file and not with its square, and it reports progress and can be cancelled (a cancelled render is let go of, and a cut sample's source is stopped); no DOM. `renderStems` makes one pad's stem at a time (its hits, and the cuts of its choke group, at the master volume and without the clipper), so that they add up to the mix, and `exportStems` puts them in a zip, which the dialog's Files choice offers
  - `export-options.js` — what an export can be told (the sequence showing or all of them, loops, stereo or mono, the mix or a stem for each pad; kept between visits), and what the Export dialog says about the file before it is made: its length, size and format; no DOM
  - `export-dialog-state.js` — what the Export dialog shows and allows (which controls are on, what the button and the Cancel button say while it renders), its double-click guard, and what the page tells it about the sequence showing or all of them; no DOM
  - `zip.js` — a zip archive of files stored as they are (a store-only writer with a CRC32, no dependency), for the export of stems and the project file; a file's bytes are not copied; `readZip` reads such an archive back (it refuses a compressed, encrypted, zip64 or damaged one, and checks each CRC); no DOM
  - `tab-sync.js` — knowing when another tab of the sampler has saved the song or the samples (the browser's `storage` event), so a tab that was left open stops saving its old beat over the new one and shows a "changed in another tab" strip (`shared/update-notice.js`, the same strip as the update one); no DOM
  - `project.js` — the project file (`.audiolab`, a zip): the whole beat (song, tempo, volume, pad settings) and the samples' original bytes, for when the browser's storage is cleared; built from what the page keeps (`collectSamples`), checked as strictly as stored data on the way in (`parseProject`: the song through `parseSong`, the samples through `parseSamples`, a damaged or too-large file refused whole), and written where the page keeps its own (`installProject`), after which the page starts again; no DOM
  - `trim.js` — which part of a sample plays: a start and an end as fractions of its length, kept possible (inside the sample, never shorter than 5 ms), and which handle a press would move; no DOM
  - `waveform.js` — a sample's outline for drawing, the lowest and highest value of each slice; no DOM
  - `pad-settings.js` — the pad settings: their ranges, clamping, decibels to a multiplier, semitones to a playback rate, the choke group, the text, and reading them back from a saved song; no DOM
  - `sample-voice.js` — a loaded sample as a pad sound, and decoding a file (with the length and size caps and the reason a file was refused); no DOM
  - `samples.js` — loading a file onto a pad, resetting it, and keeping the samples between visits (the files' bytes in IndexedDB, which pad has which in localStorage), restored at the start of a visit; no DOM
  - `pads.js`, `tempo-knob.js`, `volume-knob.js` (also the Swing knob), `velocity-bars.js`, `sample-loader.js`, `settings-sliders.js`, `pad-drawer.js`, `export-dialog.js`, `trim-view.js`, `lcd.js`, `level-meter-view.js`, `sequence-row.js` — the on-screen views (`pads.js` also maps computer keys to pads, `velocity-bars.js` has the pure velocity-from-pointer and key maths, `sample-loader.js` is the Load Sample button and dropping a file on a pad, `settings-sliders.js` is the Gain, Pitch, Choke and envelope sliders, `color-swatches.js` is the row of colours for the pad, `pad-drawer.js` is the pad editor drawer (open, close, heading), `export-dialog.js` is the Export window (loops, stereo or mono, size, progress and cancel), `trim-view.js` is the waveform with its Start and End and the pad's envelope drawn on it, `lcd.js` has the pure text formatter and the progress bar along the bottom of the display, `level-meter-view.js` is the two bars at the right of the display, `sequence-row.js` is the row of sequence keys with Add, Copy and Remove, and has the pure `sequenceKeys`)
  - `devices.js` — device profiles: the Novation Launchpad (pads, step keys, transport buttons, LED colours), the Akai MPC Sample (any pad bank plays pads 1-16) and any other controller (notes 36-51 play pads)
  - `midi.js` — connects the profiles to the app: routes their events to it and keeps the lit controller's LEDs in step
  - `sampler.css` — sampler-only styles
- `keyboard.html` + `apps/keys/` — MIDI keyboard test page (notes, velocity, pitch bend, mod, sustain, knobs, CCs)
  - `main.js` — wires the page: connects MIDI and the computer keyboard to the synth, the page's state and the views
  - `controller.js` — the page's state (held notes, pedal, joystick, CC and knob readouts) and every parameter change, in one place; no DOM
  - `synth.js` — the polyphonic synth (voices, sustain pedal, pitch bend, parameters); no DOM
  - `envelope.js` — ADSR scheduling on a Web Audio `AudioParam`
  - `params.js` — every synth parameter in one table (scale, display, knob order); adding one is one entry
  - `devices.js` — device profiles: the generic keyboard and the AKAI MPK mini (knob CCs; the channel-10 pad notes are claimed so they do not play as keys)
  - `knob-dials.js`, `stick.js`, `lcd.js` — the on-screen views (`stick.js` has the pure ball position, `lcd.js` also has the pure text formatter, including the line that names the last knob turned and its value)
  - `keys.css` — keys-page-only styles
- `monitor.html` + `apps/monitor/` — MIDI monitor page: lists every message a device sends (notes, CCs, pressure, clock...) with its raw bytes, and a table of which notes were hit on which channel
  - `main.js` — wires the page: connects MIDI to the log and the view, and the pause / clear / copy / filter controls
  - `describe.js` — turns raw bytes into a name, channel, detail and hex, and a line of text for copying; no DOM
  - `log.js` — the bounded message list and the running tally of notes hit; no DOM
  - `view.js` — the on-screen message list and notes table
  - `monitor.css` — monitor-only styles
- `mpc-sample.html` + `apps/mpc-sample/` — companion page for the Akai MPC Sample: shows the device's pads (hits, velocity, pressure), which bank is in play, the note each pad sends, whether it is playing or stopped and its tempo (the Play and Stop lamps only show what the device reports: the page sends no Start or clock, because the device distorted while following it), and a step sequencer that follows the device's clock and sends it a note for each step
  - `main.js` — wires the page: connects MIDI to the board and the views, drawing at most once per frame and runs the step keys and the Play and Stop lamps
  - `devices.js` — the page's device profile: pad hits, releases and pressure (with the bank and raw note), Start / Stop / Continue and clock, and the messages the sequencer sends to play a pad
  - `starter-beat.js` — the boom-tap the step keys start with on every load, so Play makes the device sound without drawing a pattern first; no DOM
  - `sequencer.js` — the step sequencer: a pattern with a row for every pad of every bank, played by the shared scheduler as notes sent to the device with timestamps; stops by releasing what sounded; no DOM
  - `board.js` — what the pads are doing in every bank, and which bank to show; no DOM
  - `transport.js` — whether the device is playing, its tempo and bar and beat read from the MIDI clock (a device already playing when the page connects, or one whose clock goes quiet, is noticed); no DOM
  - `pad-grid.js`, `bank-strip.js`, `transport-lights.js`, `lcd.js` — the on-screen views (`lcd.js` also has the pure text formatter)
  - `mpc-sample.css` — page-only styles
- `tone-demo.html` + `apps/tone-demo/` — a small synth built with [Tone.js](https://tonejs.github.io/), the only page that uses it (a feedback delay on the shared audio engine)
  - `main.js` — wires the page: points Tone at the shared `AudioContext`, builds the synth and delay, draws the keys and controls
  - `params.js` — the controls' ranges, defaults and readout formats
  - `tone-demo.css` — demo-only styles
- `shared/sounds.js` — the 16 drum sounds, the kit that lists them in pad order, and the gain stages a hit goes through (`withVelocity`, `withGain`); played by the sampler
- `shared/dsp.js` — what the sounds are built from: noise, a decay envelope, a filter
- `shared/pattern.js`, `shared/history.js` — the step grid (on/off, and a velocity per step) and undo/redo over any state that can be set aside as a value; no DOM
- `shared/storage-budget.js` — how much room the browser gives the site (the sampler's total cap is a share of it), asking it to keep the data (`navigator.storage.persist()`), and the "4.2/32 MB" text; never throws, no DOM
- `shared/download.js` — saves a Blob as a file through a link that is clicked by code (takes its document as a parameter)
- `shared/dom-updates.js` — `setText`, `setAttr`, `setDisabled`, `setHidden`: a view writes only what changed (a redraw every step would otherwise be announced again), and a button that goes disabled or a group that is hidden hands keyboard focus to a neighbour first
- `shared/disclosure.js` — a button that shows and hides some regions (`aria-expanded`, `aria-controls`, focus handed to the button when it hides what has it); the sampler's step editor uses it
- `shared/blob-store.js` — bytes kept in IndexedDB that never throws (a failed read is `null`, a failed write is `false`), for what localStorage cannot hold: the sampler's samples
- `shared/audio.js` — the `AudioContext`, master volume (through a soft clipper, so sounds that add up past full scale do not crackle), the analysers that listen after it (one for the whole output, for the lights; one for each side, built when something asks for it, for the level meter), power on/off and first-interaction unlock, used by the sampler, keys and Tone pages
- `shared/light-show.js`, `light-show-view.js`, `light-show.css` — the sampler's Lights button (in the machine header, beside MIDI and Power): a glow on the desk behind the machine that pulses with the tempo and runs from blue to red with how loud the output is, swells with the bass, sparkles at the edges with the highs and bursts in a pad's colour when it plays (the maths has no DOM; the view sets CSS variables each frame)
- `shared/audio-notice.js` — the "sound is off" notice the pages that play sound (sampler, keys, tone) show until the first click or key press (on touch screens only once a MIDI hit makes no sound)
- `shared/power.js` — what pressing a device's POWER switch does to its audio (on goes off, anything else comes on)
- `shared/power-sequence.js` — the machine's power phase (off, booting, on, shutdown) that the sampler's LCD and pads boot and shut down by
- `shared/midi-access.js` — Web MIDI permission, device scanning and status, used by both apps
- `shared/midi-devices.js` — device profiles: picks the mapping for a controller by its port name, and `createMidiRouter`, which turns a raw message into the app's events and hands them to its handlers
- `shared/mpc-sample.js` — what is known about the Akai MPC Sample's MIDI: how to recognise its port and which pad and bank a note belongs to
- `shared/loading-screen.js` + `shared/loading.css` — the "Loading" overlay every page starts with, so the page does not jump while its scripts build it; removed once everything has loaded
- `shared/page-ready.js` — resolves when the page has settled (load event, fonts, two drawn frames) or after a timeout; no DOM
- `shared/site-header.js` — the bar above the machine, the same on every page: the site name and a link to each page; it also builds the MIDI switch, and its short status, which `app-header.js` draws in the machine's own header
- `shared/pages.js` — the list of pages the site header links to (checked against `vite.config.js` by its test), and the links in the footer
- `shared/site-footer.js` — the strip below every page: links to the source, the documentation, the changelog and the issue tracker
- `shared/app-header.js` — the machine's own header: its name and tagline, its action buttons (Export) and the POWER switch
- `shared/console-log.js` — the bounded list of messages the device's header leaves out (every MIDI port the browser lists, plug and unplug, errors); no DOM
- `shared/console-drawer.js` — the drawer along the bottom of the window that shows that list, with Copy and Clear (not mounted at the moment: the Console button is gone until it has a better place)
- `shared/midi-messages.js` — decodes raw MIDI bytes into `noteOn` / `noteOff` / `cc` / `pitchBend` / pressure / `programChange` objects
- `shared/flash.js` — light an element for a moment (a pad hit), restarting the time on a repeat hit
- `shared/holds.js` — who is holding each note (MIDI, computer keyboard, each finger), so a note stops only when the last holder lets go; no DOM; used by the keys page and the Tone.js demo
- `shared/piano.js` + `piano.css` — the on-screen piano (lights keys, follows played notes, turns mouse/touch into notes); used by the keys page and the Tone.js demo
- `shared/pointer-notes.js` — which note each mouse button or finger is holding on the piano; no DOM
- `shared/computer-keys.js` — the computer keyboard as a one-octave piano (takes its events from a target, so it is testable); no DOM of its own; played by the keys page and the Tone.js demo
- `shared/notes.js` — note names and black/white keys
- `shared/scales.js` — slider position to value mappings (`linear`, `exp`, `squared`)
- `shared/tempo.js` — BPM limits, step length, swing (its range and how late a step sounds), tap tempo and snapping a live hit to the nearest step; no DOM
- `shared/scheduler.js` — the lookahead scheduler: starts and stops, tempo, where a pass ends (`onWrap`, so a page can start the next one with another length), and the queue the playhead is painted from, on whatever clock it is given (the sampler gives it the audio clock); no DOM
- `shared/step-keys.js` + `shared/step-keys.css` — the row of step keys for one pad, in groups; the sampler and the MPC Sample page use it, and each page that uses it imports the stylesheet
- `shared/storage.js` — JSON in `localStorage` that never throws
- `shared/offline.js` — what each page's `main.js` calls to work offline: registers the service worker (production builds only) and shows the update notice when a newer build is waiting
- `shared/register-sw.js` — registers `sw.js` and reports a waiting build; reloads only after the person applies the update; never throws, no DOM
- `shared/update-notice.js` — the "A new version is ready" strip with Reload and Later
- `shared/precache.js` + `shared/sw-template.js` — the service worker: the template is filled in at build time (the files to keep, from `precache.js`, and a fingerprint of the build) and emitted as `sw.js`; it is not imported by any page
- `public/manifest.webmanifest` + `public/icons/` — the web app manifest and its icons, served as they are
- `shared/base.css` — chassis, LCD, button and header styles used by every page
- `public/favicon.svg` — the site icon, served as it is (every page's `<head>` also carries its description and share tags)
- `docs/` — the documentation: [README.md](README.md) is its index
- `AGENTS.md` — a link to `CLAUDE.md`, for coding agents that look for that name
- `CHANGELOG.md` — what changed on the live site, by day, newest first
- `LICENSE` — the PolyForm Noncommercial License 1.0.0 (see License below)
- `.claude/skills/dependabot/` — a Claude Code skill for triaging, verifying and merging Dependabot PRs
- `.claude/skills/` (the rest) — how work is shipped here, as Claude Code skills: `ship-pr` (branch to open PR, bundled), `pre-pr-review` (an independent read-only review before a PR), `try-in-page` (drive the change in the running page), `handle-review-events` (Codex and CI events), `land-prs` (merge in order, sync main, clean up)

Tests sit next to the code as `*.test.js`.
