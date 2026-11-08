# PAD16 Sampler

A single-page drum sampler styled like a classic hardware pad sampler, built with Vite and the Web Audio API. Every sound is synthesized in the browser, so there are no sample files.

**Live demo: https://jaballer.github.io/pad-sampler/**

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
docker build -t pad-sampler .
docker run --rm -p 8080:80 pad-sampler   # http://localhost:8080
```

## Layout

Each app is its own page with its own code; shared code lives in `shared/`.

- `index.html` + `apps/sampler/` — the pad sampler
  - `main.js` — wires the page: connects the pads, step keys, tempo knob, computer keyboard and MIDI to the sampler and the views
  - `controller.js` — the sampler's state (selected pad, recording, volume) and every action on it (hit a pad, toggle a step, record, tap tempo...), with the follow-ups each one needs (LCD message, save, redraw); no DOM
  - `format.js` — small text helpers for the display and messages; no DOM
  - `pattern.js` — the step grid (which pad plays on which step) and the starter beat; no DOM
  - `song.js` — what is kept between visits (pattern, tempo, volume): the saved format, checking it on load, and the debounced saver; no DOM
  - `transport.js` — the lookahead scheduler: starts and stops, tempo, and the queue the playhead is painted from; no DOM
  - `tempo.js` — BPM limits, step length, tap tempo and snapping a live hit to the nearest step; no DOM
  - `sounds.js` — drum synthesis
  - `pads.js`, `steps.js`, `tempo-knob.js`, `lcd.js` — the on-screen views (`pads.js` also maps computer keys to pads, `lcd.js` has the pure text formatter)
  - `devices.js` — device profiles: the Novation Launchpad (pads, step keys, transport buttons, LED colours) and any other controller (notes 36-51 play pads)
  - `midi.js` — connects the profiles to the app: routes their events to it and keeps the lit controller's LEDs in step
  - `sampler.css` — sampler-only styles
- `keyboard.html` + `apps/keys/` — MIDI keyboard test page (notes, velocity, pitch bend, mod, sustain, CCs, pads)
  - `main.js` — wires the page: connects MIDI and the computer keyboard to the synth and the views
  - `synth.js` — the polyphonic synth (voices, sustain pedal, pitch bend, parameters); no DOM
  - `envelope.js` — ADSR scheduling on a Web Audio `AudioParam`
  - `params.js` — every synth parameter in one table (scale, display, knob order); adding one is one entry
  - `devices.js` — device profiles: the generic keyboard and the AKAI MPK mini (knob CCs, channel-10 pads)
  - `pointer-notes.js` — which note each mouse button or finger is holding on the piano; no DOM
  - `holds.js` — who is holding each note (MIDI, computer keyboard, each finger), so a note stops only when the last holder lets go; no DOM
  - `pad-learner.js` — learns which MIDI notes are pads 1-8 and remembers them
  - `piano.js`, `pad-grid.js`, `knob-dials.js`, `lcd.js` — the on-screen views (`lcd.js` also has the pure text formatter)
  - `keys.css` — keys-page-only styles
- `monitor.html` + `apps/monitor/` — MIDI monitor page: lists every message a device sends (notes, CCs, pressure, clock...) with its raw bytes, and a table of which notes were hit on which channel
  - `main.js` — wires the page: connects MIDI to the log and the view, and the pause / clear / copy / filter controls
  - `describe.js` — turns raw bytes into a name, channel, detail and hex, and a line of text for copying; no DOM
  - `log.js` — the bounded message list and the running tally of notes hit; no DOM
  - `view.js` — the on-screen message list and notes table
  - `monitor.css` — monitor-only styles
- `shared/audio.js` — the `AudioContext`, master volume and first-interaction unlock, used by both apps
- `shared/midi-access.js` — Web MIDI permission, device scanning and status, used by both apps
- `shared/midi-devices.js` — device profiles: picks the mapping for a controller by its port name
- `shared/midi-messages.js` — decodes raw MIDI bytes into `noteOn` / `noteOff` / `cc` / `pitchBend` / pressure / `programChange` objects
- `shared/notes.js` — note names and black/white keys
- `shared/scales.js` — slider position to value mappings (`linear`, `exp`, `squared`)
- `shared/storage.js` — JSON in `localStorage` that never throws
- `shared/base.css` — chassis, LCD and button styles used by both apps
- `.claude/skills/dependabot/` — a Claude Code skill for triaging, verifying and merging Dependabot PRs

Tests sit next to the code as `*.test.js`. Conventions and architecture rules are in [CLAUDE.md](CLAUDE.md).

## Develop

```bash
npm run check    # lint + format check + tests + build; CI and the deploy run this too
npm test         # tests only
npm run coverage # tests with a coverage table
npm run format   # apply Prettier
```
