import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as soundcheck } from "../src/commands/soundcheck.js";

// stage a CLAUDE_PLUGIN_ROOT whose config/ has contracts+instruments but (optionally) the template
function stageRoot(withTemplate: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "sc-root-"));
  mkdirSync(join(root, "config", "prompt-templates"), { recursive: true });
  writeFileSync(join(root, "config", "contracts.yaml"), "codex:\n  binary: codex\n");
  writeFileSync(join(root, "config", "instruments.yaml"), "violin:\n");
  if (withTemplate) writeFileSync(join(root, "config", "prompt-templates", "identity.md"), "x");
  return root;
}

describe("soundcheck identity-template check (M1)", () => {
  it("FAILs (rc 1) when the plugin-side identity template is missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "sc-home-"));
    const root = stageRoot(false);
    const prevHome = process.env.CONSORT_HOME, prevRoot = process.env.CLAUDE_PLUGIN_ROOT;
    process.env.CONSORT_HOME = home; process.env.CLAUDE_PLUGIN_ROOT = root;
    try { expect(await soundcheck([])).toBe(1); }
    finally {
      if (prevHome === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prevHome;
      if (prevRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = prevRoot;
      rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
    }
  });
});
