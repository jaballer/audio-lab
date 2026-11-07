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

**Novation Launchpad (original layout)** — pads are lit to mirror the app:

- Bottom-left 4×4 block: the 16 pads (pad 1 in the bottom-left corner)
- Top two rows: the 16 step keys for the selected pad
- Top round buttons, left to right: Play, Stop, Rec, Clear Pad, Clear All, Tap Tempo, Tempo −, Tempo +

**Any other controller:** MIDI notes 36–51 play pads 1–16, with velocity.

## Run it

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
  - `main.js` — pads, sequencer, transport
  - `sounds.js` — drum synthesis
  - `midi.js` — Launchpad mapping and LED feedback
  - `sampler.css` — sampler-only styles
- `keyboard.html` + `apps/keys/` — MIDI keyboard test page (notes, velocity, pitch bend, mod, sustain, CCs, pads)
  - `main.js` — wires the page: connects MIDI and the computer keyboard to the synth and the views
  - `synth.js` — the polyphonic synth (voices, sustain pedal, pitch bend, parameters); no DOM
  - `envelope.js` — ADSR scheduling on a Web Audio `AudioParam`
  - `params.js` — every synth parameter in one table (scale, display, knob order); adding one is one entry
  - `notes.js` — note names and black/white keys
  - `pad-learner.js` — learns which MIDI notes are pads 1-8 and remembers them
  - `piano.js`, `pad-grid.js`, `knob-dials.js`, `lcd.js` — the on-screen views (`lcd.js` also has the pure text formatter)
  - `keys.css` — keys-page-only styles
- `shared/audio.js` — the `AudioContext`, master volume and first-interaction unlock, used by both apps
- `shared/midi-access.js` — Web MIDI permission, device scanning and status, used by both apps
- `shared/midi-messages.js` — decodes raw MIDI bytes into `noteOn` / `noteOff` / `cc` / `pitchBend` objects
- `shared/scales.js` — slider position to value mappings (`linear`, `exp`, `squared`)
- `shared/storage.js` — JSON in `localStorage` that never throws
- `shared/base.css` — chassis, LCD and button styles used by both apps

Tests sit next to the code as `*.test.js`. Conventions and architecture rules are in [CLAUDE.md](CLAUDE.md).

## Develop

```bash
npm run check    # lint + format check + tests + build; CI and the deploy run this too
npm test         # tests only
npm run format   # apply Prettier
```
