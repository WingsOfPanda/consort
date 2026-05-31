import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginRoot } from "../src/core/paths.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
const ORIG_ARGV1 = process.argv[1];
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG;
  process.argv[1] = ORIG_ARGV1;
});

describe("pluginRoot", () => {
  it("returns CLAUDE_PLUGIN_ROOT when set", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/x/plugin";
    expect(pluginRoot()).toBe("/x/plugin");
  });

  it("self-locates from the bundle path when CLAUDE_PLUGIN_ROOT is unset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const root = mkdtempSync(join(tmpdir(), "consort-plugin-"));
    mkdirSync(join(root, "dist"), { recursive: true });
    mkdirSync(join(root, "config", "prompt-templates"), { recursive: true });
    writeFileSync(join(root, "config", "prompt-templates", "identity.md"), "x");
    writeFileSync(join(root, "dist", "consort.cjs"), "//");
    process.argv[1] = join(root, "dist", "consort.cjs");
    try { expect(pluginRoot()).toBe(realpathSync(root)); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("falls back to cwd when the bundle path has no config asset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const root = mkdtempSync(join(tmpdir(), "consort-noasset-"));
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "consort.cjs"), "//");
    process.argv[1] = join(root, "dist", "consort.cjs");
    try { expect(pluginRoot()).toBe(process.cwd()); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("falls back to process.cwd() when unset and argv[1] is not a bundle", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    process.argv[1] = "/definitely/not/a/consort/bundle/path.js";
    expect(pluginRoot()).toBe(process.cwd());
  });
});
