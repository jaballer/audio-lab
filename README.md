# PAD16 Sampler

A single-page drum sampler styled like a classic hardware pad sampler, built with Vite and the Web Audio API. Every sound is synthesized in the browser, so there are no sample files.

- 4×4 grid of 16 pads (Kick, Snare, hats, Clap, Rim, toms, Cowbell, Conga, Shaker, Bass, Crash, Ride, Zap, Blip)
- Play pads by clicking or with the keyboard; the keys mirror the pad grid: `1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V`
- LCD display, 16 step keys for the selected pad, and a looping sequencer (Space toggles play/stop)
- Tempo knob (drag, scroll, or arrow keys), tap tempo, and a volume fader
- REC mode: press Rec while playing and hit pads to record them, quantized to 16th notes

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

- `src/sounds.js` — drum synthesis
- `src/main.js` — pads, sequencer, transport
- `src/style.css` — styles
