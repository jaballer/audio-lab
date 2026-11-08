// The joystick ball: it follows pitch bend (left / right) and mod (up).
//
//   const stick = createStick(ballElement);
//   stick.render({ bend, mod });   // bend -1 .. 1, mod 0-127
//
// `stickOffset` works out where the ball goes, with no DOM, so it can be tested.

const STICK_TRAVEL = 30; // px from the centre at full deflection
const MOD_MAX = 127;

export function stickOffset({ bend, mod }) {
  return { x: bend * STICK_TRAVEL, y: -(mod / MOD_MAX) * STICK_TRAVEL };
}

export function createStick(ball) {
  return {
    render(state) {
      const { x, y } = stickOffset(state);
      ball.style.transform = `translate(${x}px, ${y}px)`;
    },
  };
}
