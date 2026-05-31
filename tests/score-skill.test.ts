import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTopic, skillHintAppend } from "../src/core/scoreSkill.js";

describe("score classifyTopic", () => {
  it("brainstorming triggers", () => {
    expect(classifyTopic("how should we structure the cache?")).toBe("brainstorming");
    expect(classifyTopic("decide between LRU and LFU")).toBe("brainstorming");
    expect(classifyTopic("what's the best way to shard?")).toBe("brainstorming");
    expect(classifyTopic("which design patterns fit here")).toBe("brainstorming");
  });
  it("systematic-debugging triggers", () => {
    expect(classifyTopic("why is the build failing?")).toBe("systematic-debugging");
    expect(classifyTopic("login is broken on edge cases")).toBe("systematic-debugging");
    expect(classifyTopic("the parser doesn't work")).toBe("systematic-debugging");
  });
  it("brainstorming wins ties", () => {
    expect(classifyTopic("why is this design pattern best")).toBe("brainstorming");
  });
  it("bare design/structure/approach do NOT trigger", () => {
    expect(classifyTopic("the design")).toBe("none");
    expect(classifyTopic("system structure approach")).toBe("none");
    expect(classifyTopic("")).toBe("none");
  });
});

describe("score skillHintAppend", () => {
  const saved = process.env.CLAUDE_PLUGIN_ROOT;
  const savedOv = process.env.CONSORT_SCORE_SKILL_OVERRIDE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = saved;
    if (savedOv === undefined) delete process.env.CONSORT_SCORE_SKILL_OVERRIDE; else process.env.CONSORT_SCORE_SKILL_OVERRIDE = savedOv;
  });
  function root(): string {
    const r = mkdtempSync(join(tmpdir(), "sk-"));
    mkdirSync(join(r, "config", "skill-hints"), { recursive: true });
    writeFileSync(join(r, "config", "skill-hints", "brainstorming.md"), "HINT-BRAIN\n");
    return r;
  }
  it("appends the hint file when skill.txt names a real skill", () => {
    const r = root(); process.env.CLAUDE_PLUGIN_ROOT = r; delete process.env.CONSORT_SCORE_SKILL_OVERRIDE;
    const st = join(r, "skill.txt"); writeFileSync(st, "brainstorming\n");
    expect(skillHintAppend(st, "BASE")).toBe("BASE\n\n---\n\nHINT-BRAIN\n");
    rmSync(r, { recursive: true, force: true });
  });
  it("returns base unchanged when skill is none, file missing, or override=none", () => {
    const r = root(); process.env.CLAUDE_PLUGIN_ROOT = r;
    const none = join(r, "n.txt"); writeFileSync(none, "none\n");
    expect(skillHintAppend(none, "BASE")).toBe("BASE");
    const dbg = join(r, "d.txt"); writeFileSync(dbg, "systematic-debugging\n");
    expect(skillHintAppend(dbg, "BASE")).toBe("BASE");
    const brain = join(r, "b.txt"); writeFileSync(brain, "brainstorming\n");
    process.env.CONSORT_SCORE_SKILL_OVERRIDE = "none";
    expect(skillHintAppend(brain, "BASE")).toBe("BASE");
    rmSync(r, { recursive: true, force: true });
  });
});
