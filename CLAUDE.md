# Conventions

Vite + vanilla JS (ES modules) + Web Audio / Web MIDI. No framework, no runtime dependencies. Everything
is synthesized in the browser.

## Commands

Node 22.13 or newer, skipping the odd-numbered 23 and 25 (`.nvmrc` says 22, `engines` in `package.json` has the exact range).

```bash
npm run dev           # dev server on http://127.0.0.1:5173
npm run check         # lint + format check + tests + build: run before every commit
npm run lint          # eslint
npm run format        # prettier --write (format:check to verify only)
npm test              # vitest run
npm run coverage      # vitest with a coverage table (files at 100% are left out): shows what the tests do not reach
```

CI runs `npm run check` on pull requests, and the deploy to GitHub Pages runs it before building, so a
failing check blocks the deploy.

## Layout

- `index.html` + `apps/sampler/`: the pad sampler. `keyboard.html` + `apps/keys/`: the MIDI keyboard page.
- `shared/`: code used by more than one app. App-only code stays under `apps/<name>/`.
- A new page needs an entry in `vite.config.js` (`build.rollupOptions.input`).

## Architecture rules

- **Logic modules have no DOM and no work at import time.** `synth.js`, `envelope.js`, `params.js`,
  `notes.js`, `holds.js`, `pointer-notes.js`, `pad-learner.js`, `pattern.js`, `song.js`, `transport.js`, `tempo.js`, `controller.js`, `computer-keys.js`, `format.js`, `scales.js`,
  `midi-messages.js`, `storage.js` and `audio.js` only export functions/factories. This is what makes them testable.
- **View modules draw into an element they are handed.** `piano.js`, `pad-grid.js`, `knob-dials.js`,
  `pads.js`, `steps.js`, `tempo-knob.js`, `stick.js`, `synth-panel.js` and `lcd.js` export a `create…(element, options)` factory (the LCD
  takes a set of elements): no `getElementById`, nothing at import time. They
  show and report (a pad flashed, a key was pressed); they do not decide. Anything worth testing (such as the
  LCD text in `formatLcd`) is a pure function next to the DOM code.
- **`main.js` only wires.** It finds the elements, builds the synth and views, and connects inputs (MIDI,
  computer keyboard) to them. Page state that several views read lives there.
- **All audio goes through `shared/audio.js`.** Use `audio.ensure()` to get the context and `audio.master` as
  the output. Never construct an `AudioContext` or a master gain elsewhere. Nothing may assume the context
  exists before the first user interaction.
- **All MIDI input goes through `shared/midi-access.js` and `parseMidi`.** Do not mask status bytes by hand;
  match on `msg.type`.
- **Controller-specific numbers live in a device profile, not in a handler.** A profile (see
  `shared/midi-devices.js`) has `match(inputName)` and `translate(msg)`, which returns the app's own events
  (`knob`, `pad`, `sustain`…); `main.js` reacts to those and never sees a CC number or channel. Supporting
  another controller means adding a profile. Both pages do this (`apps/keys/devices.js`,
  `apps/sampler/devices.js`). A profile can also describe a controller's lights (the Launchpad's LEDs); the
  LED colours and note numbers stay in the profile too.
- **Slider-to-value mappings use `shared/scales.js`**, not hand-written formulas.
- **One place changes each value.** A parameter that can be set from a slider, a MIDI knob or a default goes
  through a single setter (see `setSlider` / `setChoice` in `keys/main.js` and `synth.set`), so the UI, the
  audio graph and the display cannot disagree. Parameters are listed once, in `apps/keys/params.js`; the page draws their controls from that table.
- Schedule sounds at `AudioContext` times (a lookahead scheduler, `AudioParam` events), never by starting them
  directly from `setTimeout`/`setInterval` callbacks. Timers drift and stall; the audio clock does not.

## Code style

Prettier and ESLint are the source of truth (`.prettierrc.json`, `eslint.config.js`); do not hand-format.
Beyond what they enforce:

- Comments explain **why** (a browser quirk, a hardware detail, a non-obvious choice), not what the code does.
- Prefer small functions over deep nesting; early `return` for guard cases.
- Unused function arguments are prefixed `_`.
- Save anything between visits with `shared/storage.js` (`loadJson` / `saveJson`), never `localStorage`
  directly: storage can throw or be empty (private windows, blocked site data), and the page must work
  without it.
- Magic numbers get a named constant or a comment (`BEND_RANGE`, `STICK_TRAVEL`, `LOOKAHEAD_MS`).

## Tests

- Tests sit next to the code as `*.test.js` and run in Node (Vitest). They cover logic modules, not DOM.
- Web Audio is faked with small stand-ins that record calls (see `apps/keys/synth.test.js`); do not add a
  browser-emulation dependency for this.
- New pure logic gets a test in the same commit. A bug fix starts with a test that fails.
- When a behaviour can only be judged by ear or by eye (envelope feel, layout), say so in the commit/PR rather
  than claiming it was verified.

### Testing with MIDI hardware

- **Use a real browser, not an embedded one.** The in-app browser pane of the Claude desktop app blocks Web
  MIDI: `navigator.requestMIDIAccess()` throws `NotAllowedError` and the page shows "MIDI: PERMISSION DENIED".
  Check anything that needs a connected controller (pad input, Launchpad LEDs, port names) in Firefox or
  Chrome at `http://127.0.0.1:5173` (`npm run dev`); Claude in Chrome can drive Chrome when its extension is
  connected. The built-in pane is fine for checks that do not touch MIDI.
- **Match against the exact port name.** Read it from the MIDI monitor page (`monitor.html`). Without a
  browser, `aconnect -l` or `/proc/asound/seq/clients` list the ALSA sequencer port names on Linux
  (`/proc/asound/cards` does not: it has card descriptions, which differ from the port name). Test a
  profile's `match` with the real string, not a guess. The monitor shows input names only; a profile with
  lights (`lights`/`reset`) is matched against the output port's name too (`apps/sampler/midi.js`), and a
  browser can name the two differently, so test both. In the browser console, list them with
  `[...(await navigator.requestMIDIAccess()).outputs.values()].map((p) => p.name)`.
- **Keep the model boundary, but allow for the browser's decoration.** Firefox on Linux reports ports as
  `client:port MIDI 1 28:0` and Windows can prefix `2- `, so a `match` that insists on the string ending
  right after the model name silently drops the profile. Accept those known prefixes and suffixes, and
  exclude sibling models by name, so one profile does not also claim a different model with the same
  leading name.
- Device profiles cover the controllers actually in use here, not every model of a brand.

## Workflow: branch and pull request

`main` is protected: changes land through a pull request, and the `check` job must pass first. Pushing to
`main` deploys to GitHub Pages, so merging is shipping.

1. Start from an up-to-date `main`: `git switch main && git pull`.
2. Branch as `type/short-name`: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/` (for example
   `refactor/params-registry`).
3. Commit in small steps, and run `npm run check` before pushing.
4. Push the branch and open a PR. The template asks for a summary, a test plan and anything not verified.
5. Wait for `check` to go green, then merge. Squash for one commit per PR; rebase to keep a deliberate commit
   series (for example a format-only commit next to a behaviour change). Merge commits are disabled.
6. The branch is deleted on merge. Locally: `git switch main && git pull && git branch -d <branch>`.

One PR is one change that could be reverted on its own. Keep unrelated cleanups out of it.

## Commits and changes

- Small, single-purpose commits; format-only changes go in their own commit, separate from behaviour changes.
- Refactors say "no intended behaviour change" and are checked against the running page.
- Update the Layout section of `README.md` when files are added, moved or removed.
