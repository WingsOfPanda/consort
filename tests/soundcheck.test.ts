import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync as exists } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencodePermissionCheck, run as soundcheck } from "../src/commands/soundcheck.js";

function cfg(content: string) {
  const f = join(mkdtempSync(join(tmpdir(), "oc-")), "opencode.json");
  writeFileSync(f, content);
  return f;
}

describe("opencode permission check (JSON.parse, not grep)", () => {
  it("allow → rc 0", () => { expect(opencodePermissionCheck(cfg(`{"permission":"allow"}`)).rc).toBe(0); });
  it("ask → rc 1 names value", () => { const r = opencodePermissionCheck(cfg(`{"permission":"ask"}`)); expect(r.rc).toBe(1); expect(r.message).toContain("'ask'"); });
  it("object form → rc 2", () => { expect(opencodePermissionCheck(cfg(`{"permission":{"bash":"allow"}}`)).rc).toBe(2); });
  it("nested per-agent only → rc 1 (no false positive)", () => { expect(opencodePermissionCheck(cfg(`{"agents":{"x":{"permission":"allow"}}}`)).rc).toBe(1); });
  it("mixed case Allow → rc 1", () => { expect(opencodePermissionCheck(cfg(`{"permission":"Allow"}`)).rc).toBe(1); });
  it("missing file → rc 1", () => { expect(opencodePermissionCheck("/nope/opencode.json").rc).toBe(1); });
});

describe("soundcheck ensures global config root", () => {
  it("ensures globalRoot and copies config when CONSORT_HOME dir does not pre-exist", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "sc-")), "nested-not-yet"); // does NOT exist
    const prev = process.env.CONSORT_HOME; process.env.CONSORT_HOME = home;
    process.env.CLAUDE_PLUGIN_ROOT = process.cwd();
    try {
      await soundcheck([]);                 // must not throw; must create home + copy config
      expect(exists(join(home, "contracts.yaml"))).toBe(true);
      expect(exists(join(home, "instruments.yaml"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prev;
    }
  });
});
