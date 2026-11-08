// What pressing a device's POWER switch does to its audio: sound that is on goes off,
// and anything else (off, or not yet unlocked by a click) comes on. The press is a click,
// so it is also a gesture the browser accepts for starting audio.
//
// `powered` is checked as well as `running`: for a moment after power goes off the context
// is still running (it is fading out), and a second press then must turn it back on.

export function togglePower(audio) {
  if (audio.powered && audio.running) audio.powerOff();
  else audio.powerOn();
}
