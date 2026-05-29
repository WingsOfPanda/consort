import { describe, it, expect } from "vitest";
import { validateSlug, resolveMode } from "../src/commands/spawn.js";

describe("spawn pure helpers", () => {
  it("validateSlug accepts lowercase/digit/hyphen ≤32, rejects others", () => {
    expect(validateSlug("auth-review")).toBe(true);
    expect(validateSlug("Bad")).toBe(false);
    expect(validateSlug("has space")).toBe(false);
    expect(validateSlug("x".repeat(33))).toBe(false);
    expect(validateSlug("")).toBe(false);
  });
  it("resolveMode: explicit > default > full", () => {
    expect(resolveMode("read-only", "full")).toBe("read-only");
    expect(resolveMode(undefined, "full")).toBe("full");
    expect(resolveMode(undefined, undefined)).toBe("full");
  });
});
