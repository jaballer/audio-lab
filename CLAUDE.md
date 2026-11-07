# Conventions

Vite + vanilla JS (ES modules) + Web Audio / Web MIDI. No framework, no runtime dependencies. Everything
is synthesized in the browser.

## Commands

```bash
npm run dev           # dev server on http://127.0.0.1:5173
npm run check         # lint + format check + tests + build: run before every commit
npm run lint          # eslint
npm run format        # prettier --write (format:check to verify only)
npm test              # vitest run
```

CI runs `npm run check` on pull requests, and the deploy to GitHub Pages runs it before building, so a
failing check blocks the deploy.

## Layout

- `index.html` + `apps/sampler/`: the pad sampler. `keyboard.html` + `apps/keys/`: the MIDI keyboard page.
- `shared/`: code used by more than one app. App-only code stays under `apps/<name>/`.
- A new page needs an entry in `vite.config.js` (`build.rollupOptions.input`).

## Architecture rules

- **Logic modules have no DOM and no work at import time.** `synth.js`, `envelope.js`, `scales.js`,
  `midi-messages.js` and `audio.js` only export functions/factories. All DOM lookups, event listeners and
  rendering live in an app's `main.js`. This is what makes them testable.
- **All audio goes through `shared/audio.js`.** Use `audio.ensure()` to get the context and `audio.master` as
  the output. Never construct an `AudioContext` or a master gain elsewhere. Nothing may assume the context
  exists before the first user interaction.
- **All MIDI input goes through `shared/midi-access.js` and `parseMidi`.** Do not mask status bytes by hand;
  match on `msg.type`. Controller-specific numbers (CCs, pad notes, channel 10) are named constants near the
  code that uses them.
- **Slider-to-value mappings use `shared/scales.js`**, not hand-written formulas.
- **One place changes each value.** A parameter that can be set from a slider, a MIDI knob or a default goes
  through a single setter (see `setEnvSlider` / `synth.set`), so the UI, the audio graph and the display
  cannot disagree.
- Schedule sounds at `AudioContext` times (a lookahead scheduler, `AudioParam` events), never by starting them
  directly from `setTimeout`/`setInterval` callbacks. Timers drift and stall; the audio clock does not.

## Code style

Prettier and ESLint are the source of truth (`.prettierrc.json`, `eslint.config.js`); do not hand-format.
Beyond what they enforce:

- Comments explain **why** (a browser quirk, a hardware detail, a non-obvious choice), not what the code does.
- Prefer small functions over deep nesting; early `return` for guard cases.
- Unused function arguments are prefixed `_`.
- Wrap `localStorage` access in try/catch: it can throw or be empty (private windows, blocked storage), and the
  page must work without it.
- Magic numbers get a named constant or a comment (`BEND_RANGE`, `STICK_TRAVEL`, `LOOKAHEAD_MS`).

## Tests

- Tests sit next to the code as `*.test.js` and run in Node (Vitest). They cover logic modules, not DOM.
- Web Audio is faked with small stand-ins that record calls (see `apps/keys/synth.test.js`); do not add a
  browser-emulation dependency for this.
- New pure logic gets a test in the same commit. A bug fix starts with a test that fails.
- When a behaviour can only be judged by ear or by eye (envelope feel, layout), say so in the commit/PR rather
  than claiming it was verified.

## Commits and changes

- Small, single-purpose commits; format-only changes go in their own commit, separate from behaviour changes.
- Refactors say "no intended behaviour change" and are checked against the running page.
- Update the Layout section of `README.md` when files are added, moved or removed.
