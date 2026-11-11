# Audio Lab documentation

Everything a person or a coding agent needs to understand and change this site, in a handful of files. Read them in this
order; stop when you have what you need.

| Read                               | For                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [README](../README.md)             | What the site is: the five pages, what the sampler does, MIDI controllers, how to run, build and install it                                              |
| [CLAUDE.md](../CLAUDE.md)          | The rules: conventions, architecture rules, tests, and the branch and pull request workflow (`AGENTS.md` is the same file)                               |
| [architecture.md](architecture.md) | How the code fits together: a page's modules, the sound, MIDI and storage paths, and every file and what it is for, the build and tooling files included |
| [sampler.md](sampler.md)           | Why the sampler works as it does: the song and its sequences, step velocity, the pad editor and each pad setting                                         |
| [export.md](export.md)             | Why Export works as it does: the dialog, the offline render, stems, all the sequences, and what was measured                                             |
| [mpc-sample.md](mpc-sample.md)     | The Akai MPC Sample's MIDI, as documented and as measured on the device, and the decisions it led to                                                     |
| [CHANGELOG](../CHANGELOG.md)       | What changed on the live site, by day                                                                                                                    |

Whether something is planned, and when, is tracked in the [GitHub issues](https://github.com/jaballer/audio-lab/issues).
Where a page here names what is not built or not decided (a "Later" or "Not decided here" note), it records where the
design stops and what it leaves room for; the issue, not the page, says whether that work is planned.

## Keeping them true

A change that makes a doc wrong fixes it in the same pull request:

- **A file added, moved or removed:** the Files list in `architecture.md`, and the module lists in `CLAUDE.md`.
- **A design decision** (one that took discussion, or that a reader would otherwise undo): the page for that area. Say
  why, and what was measured or only reasoned.
- **Something a visitor can see or hear:** the README if it changes what a page does, and an entry in `CHANGELOG.md`.
- **A new area** gets a page here only when it does not fit one above. Keep the list short.
