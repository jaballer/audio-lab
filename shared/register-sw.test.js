import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register-sw.js";

// A tiny stand-in for an event target.
function emitter() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => (handlers[type] ||= []).push(fn),
    emit: (type) => (handlers[type] || []).forEach((fn) => fn()),
  };
}

function setup({ controller = null, waiting = null, rejects = false } = {}) {
  const registration = Object.assign(emitter(), { waiting, installing: null });
  const container = Object.assign(emitter(), {
    controller,
    register: vi.fn(() => (rejects ? Promise.reject(new Error("nope")) : Promise.resolve(registration))),
  });
  const location = { reload: vi.fn() };
  const onUpdate = vi.fn();
  const run = () => registerServiceWorker({ navigator: { serviceWorker: container }, location, onUpdate });
  return { registration, container, location, onUpdate, run };
}

function worker() {
  return Object.assign(emitter(), { state: "installing", postMessage: vi.fn() });
}

// A new build arriving: the browser sets `installing`, fires updatefound, then the worker reaches "installed".
function install(registration, w) {
  registration.installing = w;
  registration.emit("updatefound");
  w.state = "installed";
  w.emit("statechange");
}

describe("registerServiceWorker", () => {
  it("does nothing where service workers do not exist", async () => {
    const onUpdate = vi.fn();
    expect(await registerServiceWorker({ navigator: {}, location: {}, onUpdate })).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("registers the worker next to the page, never trusting the HTTP cache for it", async () => {
    const { container, run } = setup();
    expect(await run()).toBe(true);
    expect(container.register).toHaveBeenCalledWith("./sw.js", { updateViaCache: "none" });
  });

  it("returns false instead of throwing when registering fails", async () => {
    const { run, onUpdate } = setup({ rejects: true });
    expect(await run()).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not call a first install an update", async () => {
    const { registration, onUpdate, run } = setup({ controller: null });
    await run();
    install(registration, worker());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("offers an update when a new build finishes installing under a running one", async () => {
    const { registration, onUpdate, run } = setup({ controller: {} });
    await run();
    install(registration, worker());
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not offer it while the new build is still installing", async () => {
    const { registration, onUpdate, run } = setup({ controller: {} });
    await run();
    const w = worker();
    registration.installing = w;
    registration.emit("updatefound");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("offers a build that was already waiting when the page loaded", async () => {
    const { onUpdate, run } = setup({ controller: {}, waiting: worker() });
    await run();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not offer a waiting build to a page with no running one", async () => {
    const { onUpdate, run } = setup({ controller: null, waiting: worker() });
    await run();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("tells the waiting worker to take over, and reloads once it has", async () => {
    const { registration, container, location, onUpdate, run } = setup({ controller: {} });
    await run();
    const w = worker();
    install(registration, w);
    const apply = onUpdate.mock.calls[0][0];
    expect(w.postMessage).not.toHaveBeenCalled();
    apply();
    expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(location.reload).not.toHaveBeenCalled();
    container.emit("controllerchange");
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the controller changes for any other reason", async () => {
    const { container, location, run } = setup({ controller: null });
    await run();
    container.emit("controllerchange"); // the first install claiming the page
    expect(location.reload).not.toHaveBeenCalled();
  });
});
