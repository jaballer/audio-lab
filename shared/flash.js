// Light an element for a moment: add a class, and take it off again after `ms`.
//
//   const flash = createFlasher("hit", 110);
//   flash(element);
//
// Hitting an element that is already lit starts its time over. Without that,
// the first hit's timer would switch the light off partway through the second.

export function createFlasher(className, ms) {
  const timers = new WeakMap(); // element -> its pending timer

  return function flash(element) {
    element.classList.add(className);
    clearTimeout(timers.get(element));
    timers.set(
      element,
      setTimeout(() => element.classList.remove(className), ms),
    );
  };
}
