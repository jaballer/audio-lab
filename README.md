# Audio Lab

A small set of browser audio tools built with Vite, the Web Audio API and Web MIDI: a 16-pad drum sampler and step sequencer, a MIDI keyboard test page, a MIDI monitor, a companion page for the Akai MPC Sample, and a Tone.js synth demo. The built-in sounds are synthesized in the browser, so there are no sample files to download. There are no accounts and no server: the sampler keeps your work in your browser (the MPC Sample page's step pattern is not saved between visits).

**Live demo: https://jaballer.github.io/audio-lab/**

## The pages

| Page                                                               | What it is                                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Sampler (PAD16)](https://jaballer.github.io/audio-lab/)           | The pad sampler and sequencer, described below                                                                                                                     |
| [Keys](https://jaballer.github.io/audio-lab/keyboard.html)         | A polyphonic synth to test a MIDI keyboard: notes, velocity, pitch bend, mod, sustain, knobs and CCs, with an adjustable ADSR envelope                             |
| [MPC Sample](https://jaballer.github.io/audio-lab/mpc-sample.html) | A companion for the Akai MPC Sample: live pads, banks, velocity and pressure, play state and tempo from its MIDI clock, and a step sequencer that plays the device |
| [Monitor](https://jaballer.github.io/audio-lab/monitor.html)       | Every message a MIDI device sends, with its raw bytes, and which notes were hit on which channel                                                                   |
| [Tone demo](https://jaballer.github.io/audio-lab/tone-demo.html)   | A small synth with a feedback delay, built with [Tone.js](https://tonejs.github.io/)                                                                               |

## The sampler

- 4×4 grid of 16 pads (Kick, Snare, closed and open hats, Clap, Rim, toms, Cowbell, Conga, Shaker, Bass, Crash, Ride, Zap, Blip)
- Play pads by clicking, with the keyboard (the keys mirror the pad grid: `1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V`), or with a MIDI controller. Hold Shift to select a pad and open its editor without playing it
- A looping 16-step sequencer: up to 8 sequences of 1, 2, 4 or 8 bars (a beat starts with one, and you add, copy and remove them; while it plays, a press on a sequence's key makes it play next, at the end of the pass, and Shift switches at once; the Next key turns that round, which is how a touch screen switches at once; the Song key plays the sequences in the order of the Song panel and stops at the end of the song, or goes round again with Loop on, while the keys only show a sequence), a velocity for every step, Undo and Redo (Ctrl/Cmd + Z), and Copy and Paste for a bar. Space toggles play/stop
- REC mode: press Rec while playing and hit pads to record them, quantized to 16th notes, with the velocity of the hit
- Your own sounds: drop an audio file on a pad (up to 10 seconds and 5 MB) or load one in the pad editor, which also trims it and sets each pad's gain, pitch, choke group, amplitude envelope and colour
- Export saves the sequence showing as a looping audio file (1, 2, 4 or 8 loops in one file, in stereo or mono), or the song (the order and repeats of the Song panel) as one file or a stem for each pad
- Tempo knob (drag, scroll, or arrow keys), tap tempo, and a volume fader
- Your sequences, tempo, volume, pad settings and samples are kept in your browser between visits (nothing is uploaded). Save writes all of it to a `.audiolab` project file, and Open puts one back, in case the browser's storage is cleared

[CHANGELOG.md](CHANGELOG.md) lists what has changed, by day.

## MIDI

Press the **MIDI** switch (in the machine's header, beside the power switch, on every page that uses MIDI; its lamp is lit while the page is listening, and pressing it again stops listening) and allow the permission prompt. This uses the Web MIDI API, which works in Chrome, Edge, and Firefox (not Safari), on `localhost`, `127.0.0.1` or HTTPS.

**Novation Launchpad, Launchpad S, and Launchpad Mini mk1/mk2** — pads are lit to mirror the app when the MIDI port name identifies a supported model:

- Bottom-left 4×4 block: the 16 pads (pad 1 in the bottom-left corner)
- Top two rows: the 16 step keys for the selected pad
- Top round buttons, left to right: Play, Stop, Rec, Clear Steps, Clear All, Tap Tempo, Tempo −, Tempo +

**Akai MPC Sample** — its 16 pads play pads 1-16 in whichever pad bank is selected, with velocity. The [companion page](https://jaballer.github.io/audio-lab/mpc-sample.html) shows the pads live. On the device, set the MIDI port to USB (Shift + Pad 8, MIDI Config) and Pad MIDI Out to Always, or no pad events reach the browser.

**Any other controller**, including newer or unrecognized Launchpads: MIDI notes 36–51 play pads 1–16, with velocity. Their layout may not correspond to these notes, and Launchpad LEDs are not controlled.

## Run it

Needs Node 22.13 or newer, but not 23 or 25 (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # production build in dist/
```

## Run in Docker

```bash
npm run build
docker build -t audio-lab .
docker run --rm -p 8080:80 audio-lab   # http://localhost:8080
```

## Install and offline

The site is a progressive web app. In a production build a service worker keeps every page and script, so all of it
works with no connection and can be installed from the browser (Install in Chrome and Edge, Add to Home Screen on
iOS). A new build never replaces the running one by itself: the page shows "A new version is ready" with Reload and
Later, because reloading in the middle of playing would lose the person's place. It is off in `npm run dev`, so cached
files never hide edits; try it with `npm run build && npm run preview`.

## Documentation

[docs/](docs/README.md) has the rest, short enough to read before a change, for people and coding agents alike:

- [architecture.md](docs/architecture.md): how the code fits together, and every file and what it is for
- [sampler.md](docs/sampler.md), [export.md](docs/export.md), [mpc-sample.md](docs/mpc-sample.md): why each part works the way it does
- [CLAUDE.md](CLAUDE.md) (also `AGENTS.md`): the conventions, architecture rules and pull request workflow

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
