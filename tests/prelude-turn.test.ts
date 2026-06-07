import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composePreludeResearchPrompt, composeAdversaryPrompt, litGuidance } from "../src/core/preludeTurn.js";
import { inboxWrite, inboxPath } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";

describe("litGuidance", () => {
  it("ON block prioritizes peer-reviewed papers", () => {
    expect(litGuidance("ON")).toMatch(/peer-reviewed/);
  });
  it("OFF block allows a brief SOTA section", () => {
    expect(litGuidance("OFF")).toMatch(/Not applicable|Brief SOTA/i);
  });
});

describe("composePreludeResearchPrompt", () => {
  const p = composePreludeResearchPrompt("attention kernels", "/art/findings-rex.md", litGuidance("ON"));
  it("contains topic, write-to, and the lit-guidance", () => {
    expect(p).toContain("attention kernels");
    expect(p).toContain("/art/findings-rex.md");
    expect(p).toContain("peer-reviewed");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION (inboxWrite owns them)", () => {
    // The template must not carry a done contract; inboxWrite appends exactly one. Embedding a
    // second here is the duplicate-END_OF_INSTRUCTION bug that desynced codex parts' done events.
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
  it("frames it as landscape exposure, not recommendation", () => {
    expect(p).toMatch(/not a recommendation/i);
  });
});

describe("composeAdversaryPrompt", () => {
  const p = composeAdversaryPrompt("## Topic\nflash\n## Approaches\n1. A", "viola", "/art/adversary-viola.md");
  it("inlines the draft, names the instrument, targets the out-path", () => {
    expect(p).toContain("## Approaches");
    expect(p).toContain("viola");
    expect(p).toContain("/art/adversary-viola.md");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION (inboxWrite owns them)", () => {
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

// Regression: the prelude send path is `inboxWrite(i, m, t, composeX(...))`. Before the fix the
// templates embedded their own done line + END_OF_INSTRUCTION AND inboxWrite appended a second of
// each, so the inbox carried two of each — the malformed-inbox condition the forensics tied to
// codex parts missing their terminal `done` event. The inbox must carry exactly one of each.
describe("prelude inbox carries a single done contract (no duplicate END_OF_INSTRUCTION)", () => {
  beforeEach(() => { process.env.CLAUDE_PLUGIN_ROOT = process.cwd(); });
  afterEach(() => { delete process.env.CONSORT_HOME; });
  const count = (s: string, sub: string): number => s.split(sub).length - 1;
  function seedPart(i: string, m: string, t: string): void {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "pt-"));
    const d = partDir(i, m, t); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "outbox.jsonl"), "");
  }

  it("research prompt → exactly one END_OF_INSTRUCTION and one done line", () => {
    seedPart("rex", "codex", "demo");
    inboxWrite("rex", "codex", "demo", composePreludeResearchPrompt("attn", "/art/findings-rex.md", litGuidance("ON")));
    const txt = readFileSync(inboxPath("rex", "codex", "demo"), "utf8");
    expect(count(txt, "END_OF_INSTRUCTION")).toBe(1);
    expect(count(txt, '"event":"done"')).toBe(1);
    expect(txt.trimEnd().endsWith("END_OF_INSTRUCTION")).toBe(true);
  });

  it("adversary prompt → exactly one END_OF_INSTRUCTION and one done line", () => {
    seedPart("viola", "codex", "demo");
    inboxWrite("viola", "codex", "demo", composeAdversaryPrompt("## Approaches\n1. A", "viola", "/art/adversary-viola.md"));
    const txt = readFileSync(inboxPath("viola", "codex", "demo"), "utf8");
    expect(count(txt, "END_OF_INSTRUCTION")).toBe(1);
    expect(count(txt, '"event":"done"')).toBe(1);
  });
});
