import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIfExists, readIfExistsOrNull } from "../src/core/fsread.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fsread-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("readIfExists", () => {
  it("returns file contents when present", () => {
    const p = join(dir, "a.txt"); writeFileSync(p, "hello");
    expect(readIfExists(p)).toBe("hello");
  });
  it("returns empty string when absent", () => {
    expect(readIfExists(join(dir, "nope.txt"))).toBe("");
  });
});
describe("readIfExistsOrNull", () => {
  it("returns file contents when present", () => {
    const p = join(dir, "b.txt"); writeFileSync(p, "x");
    expect(readIfExistsOrNull(p)).toBe("x");
  });
  it("returns null when absent", () => {
    expect(readIfExistsOrNull(join(dir, "nope.txt"))).toBeNull();
  });
});
