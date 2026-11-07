import { describe, expect, it } from "vitest";
import { selectProfile } from "./midi-devices.js";

const profile = (id, pattern) => ({ id, match: (name) => pattern.test(name), translate: () => [] });
const catchAll = { id: "any", match: () => true, translate: () => [] };

describe("selectProfile", () => {
  it("returns the first profile that matches", () => {
    const profiles = [profile("a", /alpha/i), profile("b", /alpha|beta/i), catchAll];
    expect(selectProfile(profiles, "Alpha 2").id).toBe("a");
    expect(selectProfile(profiles, "Beta").id).toBe("b");
  });

  it("falls through to a catch-all profile placed last", () => {
    expect(selectProfile([profile("a", /alpha/), catchAll], "Gamma").id).toBe("any");
  });

  it("returns null when nothing matches", () => {
    expect(selectProfile([profile("a", /alpha/)], "Gamma")).toBeNull();
  });

  it("treats a missing name as an empty string", () => {
    expect(selectProfile([catchAll], undefined).id).toBe("any");
  });
});
