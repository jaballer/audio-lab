// What pressing a device's POWER switch does to its audio: sound that is on goes off,
// and anything else (off, or not yet unlocked by a click) comes on. The press is a click,
// so it is also a gesture the browser accepts for starting audio.

export function togglePower(audio) {
  if (audio.running) audio.powerOff();
  else audio.powerOn();
}
