# Pad Sampler

A small single-page drum sampler built with Vite and the Web Audio API. Every sound is synthesized in the browser, so there are no sample files.

- 8 drum pads: Kick, Snare, Hat, Open Hat, Clap, Tom, Cowbell, Bass
- Play pads by clicking or with the keyboard: `Q W E R` / `A S D F`
- 16-step sequencer with BPM and volume controls (Space toggles play/stop)

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
