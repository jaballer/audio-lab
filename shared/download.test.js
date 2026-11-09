import { describe, expect, it, vi } from "vitest";
import { saveBlob } from "./download.js";

function fakeDocument() {
  const events = [];
  const link = {
    click: vi.fn(() => events.push("click")),
    remove: vi.fn(() => events.push("remove")),
  };
  const doc = {
    createElement: vi.fn(() => link),
    body: { append: vi.fn(() => events.push("append")) },
  };
  return { doc, link, events };
}

describe("saveBlob", () => {
  it("clicks a link to the blob with the file's name, with the link in the page while it is clicked", () => {
    const { doc, link, events } = fakeDocument();
    const urls = { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() };
    const blob = new Blob(["abc"]);
    saveBlob(blob, "beat.wav", { doc, urls, wait: vi.fn() });
    expect(urls.createObjectURL).toHaveBeenCalledWith(blob);
    expect(link.href).toBe("blob:x");
    expect(link.download).toBe("beat.wav");
    expect(events).toEqual(["append", "click", "remove"]);
  });

  it("lets go of the address a while after, not at once (the download has to start)", () => {
    const { doc } = fakeDocument();
    const urls = { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() };
    const wait = vi.fn();
    saveBlob(new Blob(["a"]), "a.wav", { doc, urls, wait });
    expect(urls.revokeObjectURL).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    wait.mock.calls[0][0]();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});
