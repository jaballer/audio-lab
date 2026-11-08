# Changelog

What changed on the live site, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no version numbers or tags: every merge to `main` deploys to GitHub Pages, so entries are grouped by the day
they merged. Internal refactors, tooling and docs are listed under **Maintenance** and leave out the page's behaviour.
Numbers link to the pull request.

## [Unreleased]

### Added

- Keys page: the K1–K8 dials can be turned with the mouse (drag, scroll or arrow keys), and they follow the sliders
  ([#57](https://github.com/jaballer/audio-lab/pull/57)).
- A POWER switch on the sampler, keys and tone pages: it turns sound on and off, and off stays off until it is pressed
  again ([#60](https://github.com/jaballer/audio-lab/pull/60)).

### Changed

- Every page shows the same "sound is off" banner until the first click or key press (it replaces the sampler's own
  banner and the keys and tone pages' header line), shakes when a MIDI hit arrives while sound is off, and is hidden on
  touch screens ([#60](https://github.com/jaballer/audio-lab/pull/60)).

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

### Changed

- Each page's helper text moves from a footnote inside the machine to a Help panel below it
  ([#52](https://github.com/jaballer/audio-lab/pull/52)).
- Each page starts behind a loading overlay, lifted once fonts and the first frames have settled, so the page no
  longer jumps while its scripts build it ([#51](https://github.com/jaballer/audio-lab/pull/51)).

### Maintenance

- The drum sounds move to `shared/` so more than one page can play them
  ([#49](https://github.com/jaballer/audio-lab/pull/49)).

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

[Unreleased]: https://github.com/jaballer/audio-lab/compare/e8dadc1...main
