# PAD16 Sampler

A single-page drum sampler styled like a classic hardware pad sampler, built with Vite and the Web Audio API. Every sound is synthesized in the browser, so there are no sample files.

**Live demo: https://jaballer.github.io/audio-lab/**

- 4×4 grid of 16 pads (Kick, Snare, hats, Clap, Rim, toms, Cowbell, Conga, Shaker, Bass, Crash, Ride, Zap, Blip)
- Play pads by clicking or with the keyboard; the keys mirror the pad grid: `1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V`
- LCD display, 16 step keys for the selected pad, and a looping sequencer (Space toggles play/stop)
- Tempo knob (drag, scroll, or arrow keys), tap tempo, and a volume fader
- REC mode: press Rec while playing and hit pads to record them, quantized to 16th notes
- MIDI controller support (see below)

## MIDI

Click **Connect MIDI** and allow the permission prompt. This uses the Web MIDI API, which works in Chrome, Edge, and Firefox (not Safari), on `localhost` or HTTPS.

**Novation Launchpad, Launchpad S, and Launchpad Mini mk1/mk2** — pads are lit to mirror the app when the MIDI port name identifies a supported model:

- Bottom-left 4×4 block: the 16 pads (pad 1 in the bottom-left corner)
- Top two rows: the 16 step keys for the selected pad
- Top round buttons, left to right: Play, Stop, Rec, Clear Pad, Clear All, Tap Tempo, Tempo −, Tempo +

**Akai MPC Sample** — its 16 pads play pads 1-16 in whichever pad bank is selected, with velocity. The [companion page](https://jaballer.github.io/audio-lab/mpc-sample.html) shows the pads live. On the device, set the MIDI port to USB (Shift + Pad 8, MIDI Config) and Pad MIDI Out to Always, or no pad events reach the browser.

**Any other controller**, including newer or unrecognized Launchpads: MIDI notes 36–51 play pads 1–16, with velocity. Their layout may not correspond to these notes, and Launchpad LEDs are not controlled.

## Run it

Needs Node 22.13 or newer, but not 23 or 25 (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Run in Docker

```bash
npm run build
docker build -t audio-lab .
docker run --rm -p 8080:80 audio-lab   # http://localhost:8080
```

## Layout

Each app is its own page with its own code; shared code lives in `shared/`.

- `index.html` + `apps/sampler/` — the pad sampler
  - `main.js` — wires the page: connects the pads, step keys, tempo knob, computer keyboard and MIDI to the sampler and the views
  - `controller.js` — the sampler's state (selected pad, recording, volume) and every action on it (hit a pad, toggle a step, record, tap tempo...), with the follow-ups each one needs (LCD message, save, redraw); no DOM
  - `layout.js` — how many pads (and in what grid) and steps the sampler has, decided once; the pad grid, step keys, key map and Launchpad profile read it; no DOM
  - `format.js` — small text helpers for the display and messages; no DOM
  - `pattern.js` — the step grid (which pad plays on which step) and the starter beat; no DOM
  - `song.js` — what is kept between visits (pattern, tempo, volume): the saved format, upgrading older versions, checking it on load, and the debounced saver; no DOM
  - `transport.js` — the lookahead scheduler: starts and stops, tempo, and the queue the playhead is painted from; no DOM
  - `tempo.js` — BPM limits, step length, tap tempo and snapping a live hit to the nearest step; no DOM
  - `pads.js`, `steps.js`, `tempo-knob.js`, `lcd.js` — the on-screen views (`pads.js` also maps computer keys to pads, `lcd.js` has the pure text formatter)
  - `devices.js` — device profiles: the Novation Launchpad (pads, step keys, transport buttons, LED colours), the Akai MPC Sample (any pad bank plays pads 1-16) and any other controller (notes 36-51 play pads)
  - `midi.js` — connects the profiles to the app: routes their events to it and keeps the lit controller's LEDs in step
  - `sampler.css` — sampler-only styles
- `keyboard.html` + `apps/keys/` — MIDI keyboard test page (notes, velocity, pitch bend, mod, sustain, CCs, pads)
  - `main.js` — wires the page: connects MIDI and the computer keyboard to the synth, the page's state and the views
  - `controller.js` — the page's state (held notes, pedal, joystick, CC and pad readouts) and every parameter change, in one place; no DOM
  - `synth.js` — the polyphonic synth (voices, sustain pedal, pitch bend, parameters); no DOM
  - `envelope.js` — ADSR scheduling on a Web Audio `AudioParam`
  - `params.js` — every synth parameter in one table (scale, display, knob order, labels); adding one is one entry
  - `devices.js` — device profiles: the generic keyboard and the AKAI MPK mini (knob CCs, channel-10 pads)
  - `pointer-notes.js` — which note each mouse button or finger is holding on the piano; no DOM
  - `holds.js` — who is holding each note (MIDI, computer keyboard, each finger), so a note stops only when the last holder lets go; no DOM
  - `pad-learner.js` — learns which MIDI notes are pads 1-8 and remembers them
  - `piano.js`, `pad-grid.js`, `knob-dials.js`, `stick.js`, `synth-panel.js`, `lcd.js` — the on-screen views (`synth-panel.js` draws the sliders and select from `params.js`, `stick.js` has the pure ball position) (`lcd.js` also has the pure text formatter)
  - `keys.css` — keys-page-only styles
- `monitor.html` + `apps/monitor/` — MIDI monitor page: lists every message a device sends (notes, CCs, pressure, clock...) with its raw bytes, and a table of which notes were hit on which channel
  - `main.js` — wires the page: connects MIDI to the log and the view, and the pause / clear / copy / filter controls
  - `describe.js` — turns raw bytes into a name, channel, detail and hex, and a line of text for copying; no DOM
  - `log.js` — the bounded message list and the running tally of notes hit; no DOM
  - `view.js` — the on-screen message list and notes table
  - `monitor.css` — monitor-only styles
- `mpc-sample.html` + `apps/mpc-sample/` — companion page for the Akai MPC Sample: shows the device's pads (hits, velocity, pressure), which bank is in play, the note each pad sends, whether it is playing or stopped and its tempo; its Play and Stop buttons ask the device to start or stop
  - `main.js` — wires the page: connects MIDI to the board and the views, drawing at most once per frame, and plays the sampler's sounds when a pad is hit (the Sound button turns that off)
  - `devices.js` — the page's device profile: pad hits, releases and pressure (with the bank and raw note), Start / Stop / Continue and clock, and the messages the Play and Stop buttons send
  - `pad-sound.js` — which sound a pad hit plays and how loud; drops a hit that arrives before audio is unlocked; no DOM
  - `board.js` — what the pads are doing in every bank, and which bank to show; no DOM
  - `transport.js` — whether the device is playing, its tempo and bar and beat read from the MIDI clock (a device already playing when the page connects, or one whose clock goes quiet, is noticed); no DOM
  - `pad-grid.js`, `bank-strip.js`, `transport-lights.js`, `lcd.js` — the on-screen views (`lcd.js` also has the pure text formatter)
  - `mpc-sample.css` — page-only styles
- `tone-demo.html` + `apps/tone-demo/` — a small synth built with [Tone.js](https://tonejs.github.io/), the only page that uses it (a feedback delay on the shared audio engine)
  - `main.js` — wires the page: points Tone at the shared `AudioContext`, builds the synth and delay, draws the keys and controls
  - `tone-demo.css` — demo-only styles
- `shared/sounds.js` — the 16 drum sounds, the kit that lists them in pad order, and `playSound` (one hit at a velocity); played by the sampler and the MPC Sample page
- `shared/dsp.js` — what the sounds are built from: noise, a decay envelope, a filter
- `shared/audio.js` — the `AudioContext`, master volume and first-interaction unlock, used by every app
- `shared/midi-access.js` — Web MIDI permission, device scanning and status, used by both apps
- `shared/midi-devices.js` — device profiles: picks the mapping for a controller by its port name, and `createMidiRouter`, which turns a raw message into the app's events and hands them to its handlers
- `shared/mpc-sample.js` — what is known about the Akai MPC Sample's MIDI: how to recognise its port and which pad and bank a note belongs to
- `shared/loading-screen.js` + `shared/loading.css` — the "Loading" overlay every page starts with, so the page does not jump while its scripts build it; removed once everything has loaded
- `shared/page-ready.js` — resolves when the page has settled (load event, fonts, two drawn frames) or after a timeout; no DOM
- `shared/site-header.js` — the bar above the machine, the same on every page: the site name, a link to each page, and Connect MIDI, its short status and the Console button
- `shared/pages.js` — the list of pages the site header links to (checked against `vite.config.js` by its test)
- `shared/app-header.js` — the machine's own header: its name and tagline, the audio status and the power light
- `shared/console-log.js` — the bounded list of messages the device's header leaves out (every MIDI port the browser lists, plug and unplug, errors); no DOM
- `shared/console-drawer.js` — the drawer along the bottom of the window that shows that list, with Copy and Clear
- `shared/midi-messages.js` — decodes raw MIDI bytes into `noteOn` / `noteOff` / `cc` / `pitchBend` / pressure / `programChange` objects
- `shared/flash.js` — light an element for a moment (a pad hit), restarting the time on a repeat hit
- `shared/computer-keys.js` — the computer keyboard as a one-octave piano (takes its events from a target, so it is testable); no DOM of its own; played by the keys page and the Tone.js demo
- `shared/notes.js` — note names and black/white keys
- `shared/scales.js` — slider position to value mappings (`linear`, `exp`, `squared`)
- `shared/storage.js` — JSON in `localStorage` that never throws
- `shared/base.css` — chassis, LCD, button and header styles used by every page
- `CHANGELOG.md` — what changed on the live site, by day, newest first
- `LICENSE` — the PolyForm Noncommercial License 1.0.0 (see License below)
- `.claude/skills/dependabot/` — a Claude Code skill for triaging, verifying and merging Dependabot PRs

Tests sit next to the code as `*.test.js`. Conventions and architecture rules are in [CLAUDE.md](CLAUDE.md).

## Develop

```bash
npm run check    # lint + format check + tests + build; CI and the deploy run this too
npm test         # tests only
npm run coverage # tests with a coverage table
npm run format   # apply Prettier
```

## License

Copyright 2026 Jabal Torres. Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): you can use, modify and share this code for any noncommercial purpose, including personal projects, study and hobby use. Selling it, or using it commercially, needs separate permission.

The Tone demo page uses [Tone.js](https://tonejs.github.io/), which is MIT-licensed and keeps its own license.
