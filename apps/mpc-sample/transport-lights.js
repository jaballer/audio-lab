// Two lamps, PLAY and STOP, that show what the device says its transport is doing: PLAY
// lights while it plays, STOP once it has stopped, and both stay dark until it has said
// anything. They are also buttons, but that click is wired in main.js: this only draws.
//
//   const lights = createTransportLights({ play: playEl, stop: stopEl });
//   lights.render({ state });   // transport.snapshot(): "playing" | "stopped" | "unknown"

export function createTransportLights({ play, stop }) {
  return {
    render({ state }) {
      play.classList.toggle("on", state === "playing");
      stop.classList.toggle("on", state === "stopped");
    },
  };
}
