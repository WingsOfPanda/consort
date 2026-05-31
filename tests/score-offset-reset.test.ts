import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir } from "../src/core/paths.js";
import { offsetResetRun } from "../src/commands/score.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("score offset-reset", () => {
  it("research: removes state+question+findings+cascade; keeps verify.md", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=5\n");
    writeFileSync(join(art, "research-viola.done"), "ok\n");
    writeFileSync(join(art, "question-viola.txt"), "{}\n");
    writeFileSync(join(art, "diff.md"), "x\n");
    writeFileSync(join(art, "viola_only_items.txt"), "x\n");
    writeFileSync(join(art, "cello_only_items.txt"), "x\n");
    writeFileSync(join(art, "adjudicated-draft.md"), "x\n");
    const pd = partDir("viola", "codex", "t"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "findings.md"), "stale\n");
    writeFileSync(join(pd, "verify.md"), "keep\n");

    expect(await offsetResetRun(["t", "viola", "research"])).toBe(0);
    for (const f of ["research-viola.txt", "research-viola.done", "question-viola.txt", "diff.md", "viola_only_items.txt", "cello_only_items.txt", "adjudicated-draft.md"])
      expect(existsSync(join(art, f))).toBe(false);
    expect(existsSync(join(pd, "findings.md"))).toBe(false);
    expect(existsSync(join(pd, "verify.md"))).toBe(true);
  });

  it("--keep-findings: removes only state+question, keeps cascade+part files", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "verify-viola.txt"), "OFFSET=2\n");
    writeFileSync(join(art, "question-viola.txt"), "{}\n");
    writeFileSync(join(art, "adjudicated-draft.md"), "x\n");
    const pd = partDir("viola", "codex", "t"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "verify.md"), "keep\n");
    expect(await offsetResetRun(["t", "viola", "verify", "--keep-findings"])).toBe(0);
    expect(existsSync(join(art, "verify-viola.txt"))).toBe(false);
    expect(existsSync(join(art, "question-viola.txt"))).toBe(false);
    expect(existsSync(join(art, "adjudicated-draft.md"))).toBe(true);
    expect(existsSync(join(pd, "verify.md"))).toBe(true);
  });

  it("bad phase → 2; missing art → 1; idempotent on empty art → 0", async () => {
    expect(await offsetResetRun(["t", "viola", "bogus"])).toBe(2);
    expect(await offsetResetRun(["t", "viola", "research"])).toBe(1);
    mkdirSync(scoreArtDir("t"), { recursive: true });
    expect(await offsetResetRun(["t", "viola", "research"])).toBe(0);
  });
});
