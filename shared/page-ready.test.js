import { describe, expect, it } from "vitest";
import { whenPageReady } from "./page-ready.js";

// A window whose load event, fonts, animation frames and timers the test fires by hand.
function fakeWindow({ readyState = "loading", fonts = true } = {}) {
  const listeners = {};
  const frames = [];
  const timers = [];
  const delays = [];
  let fontsDone;
  const win = {
    document: {
      readyState,
      fonts: fonts ? { ready: new Promise((resolve) => (fontsDone = resolve)) } : undefined,
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: (fn, ms) => {
      timers.push(fn);
      delays.push(ms);
    },
  };
  return {
    win,
    fireLoad: () => listeners.load?.(),
    fontsDone: () => fontsDone(),
    pendingFrames: () => frames.length,
    runFrame: () => frames.shift()(),
    fireTimeout: () => timers[0](),
    timeoutDelay: () => delays[0],
  };
}

// Lets promise callbacks run, which is all the "time" these tests need.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function track(promise) {
  const state = { done: false };
  promise.then(() => (state.done = true));
  await tick();
  return state;
}

describe("whenPageReady", () => {
  it("waits for the load event, then the fonts, then two drawn frames", async () => {
    const page = fakeWindow();
    const state = await track(whenPageReady(page.win));
    expect(state.done).toBe(false);
    expect(page.pendingFrames()).toBe(0); // nothing is drawn-for until load and fonts are both in

    page.fireLoad();
    await tick();
    expect(page.pendingFrames()).toBe(0); // fonts still pending

    page.fontsDone();
    await tick();
    expect(page.pendingFrames()).toBe(1);
    expect(state.done).toBe(false);

    page.runFrame();
    await tick();
    expect(page.pendingFrames()).toBe(1);
    expect(state.done).toBe(false);

    page.runFrame();
    await tick();
    expect(state.done).toBe(true);
  });

  it("does not wait for a load event that already happened", async () => {
    const page = fakeWindow({ readyState: "complete" });
    page.fontsDone();
    const state = await track(whenPageReady(page.win));
    expect(page.pendingFrames()).toBe(1);
    page.runFrame();
    await tick();
    page.runFrame();
    await tick();
    expect(state.done).toBe(true);
  });

  it("copes with a browser that has no font loading API", async () => {
    const page = fakeWindow({ readyState: "complete", fonts: false });
    await track(whenPageReady(page.win));
    expect(page.pendingFrames()).toBe(1);
  });

  it("gives up after the timeout, so a stalled load cannot hide the page for good", async () => {
    const page = fakeWindow(); // load never fires
    const state = await track(whenPageReady(page.win, { timeoutMs: 1234 }));
    expect(state.done).toBe(false);
    expect(page.timeoutDelay()).toBe(1234);
    page.fireTimeout();
    await tick();
    expect(state.done).toBe(true);
  });
});
