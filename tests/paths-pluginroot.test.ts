import { describe, it, expect, afterEach } from "vitest";
import { pluginRoot } from "../src/core/paths.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
afterEach(() => { if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG; });

describe("pluginRoot", () => {
  it("returns CLAUDE_PLUGIN_ROOT when set", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/x/plugin";
    expect(pluginRoot()).toBe("/x/plugin");
  });
  it("falls back to process.cwd() when unset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(pluginRoot()).toBe(process.cwd());
  });
});
