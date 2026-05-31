import { describe, it, expect, afterEach } from "vitest";
import { identityWrite } from "../src/core/ipc.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
afterEach(() => { if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG; });

describe("identityWrite", () => {
  it("throws a clear error naming the resolved root when the template is missing", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/nonexistent-plugin-root-xyz";
    expect(() => identityWrite("trumpet", "codex", "some-topic")).toThrow(/identity template not found/);
    expect(() => identityWrite("trumpet", "codex", "some-topic")).toThrow(/CLAUDE_PLUGIN_ROOT/);
  });
});
