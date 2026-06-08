// tests/duet-turn.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeDuetBrief, composeDuetFollowup } from "../src/core/duetTurn.js";
import { inboxWrite, inboxPath } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";
import { freshHome } from "./helpers/tmpHome.js";

describe("composeDuetBrief", () => {
  const p = composeDuetBrief("implement X", "/abs/repoB", "feat/duet-demo");
  it("names repo B's path, the branch, and the cross-repo framing + carries the task", () => {
    expect(p).toContain("/abs/repoB");
    expect(p).toContain("feat/duet-demo");
    expect(p).toMatch(/separate repository|conductor/i);
    expect(p).toContain("implement X");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION (inboxWrite owns them)", () => {
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("composeDuetFollowup", () => {
  const p = composeDuetFollowup("now also handle Y", 2);
  it("frames it as round N and inlines the conductor's text", () => {
    expect(p).toContain("round 2");
    expect(p).toContain("now also handle Y");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION", () => {
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("duet inbox carries a single done contract (no duplicate END_OF_INSTRUCTION)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());
  const count = (s: string, sub: string): number => s.split(sub).length - 1;
  it("brief → exactly one END_OF_INSTRUCTION and one done line", () => {
    const d = partDir("viola", "codex", "demo"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "outbox.jsonl"), "");
    inboxWrite("viola", "codex", "demo", composeDuetBrief("t", "/abs/repoB", "feat/duet-demo"));
    const txt = readFileSync(inboxPath("viola", "codex", "demo"), "utf8");
    expect(count(txt, "END_OF_INSTRUCTION")).toBe(1);
    expect(count(txt, '"event":"done"')).toBe(1);
    expect(txt.trimEnd().endsWith("END_OF_INSTRUCTION")).toBe(true);
  });
});
