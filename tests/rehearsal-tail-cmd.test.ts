// tests/rehearsal-tail-cmd.test.ts — rehearsal tail CLI verbs (Phase D).
// Extended by later D tasks; today: refine (stateless mid-experiment scope-narrowing).
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { refineWith, type RehearsalRefineDeps } from "../src/commands/rehearsal.js";
import { experimentDir, rehearsalArtDir } from "../src/core/rehearsal.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
function home() { const h = freshHome(); cleanups.push(h.cleanup); return h; }

// Resolve the branch dir the way refineWith does (rehearsalArtDir(topic, opts) -> experimentDir).
function branchPath(homeDir: string, topic: string, instrument: string, expId: string): string {
  const art = rehearsalArtDir(topic, { home: homeDir, cwd: homeDir });
  return experimentDir(art, instrument, expId);
}
function mkBranch(homeDir: string, topic: string, instrument: string, expId: string): string {
  const dir = branchPath(homeDir, topic, instrument, expId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function deps(homeDir: string, over: Partial<RehearsalRefineDeps> = {}): RehearsalRefineDeps {
  return {
    send: async () => 0,
    opts: { home: homeDir, cwd: homeDir },
    ...over,
  };
}

describe("refine", () => {
  const TOPIC = "tune-model";
  const INST = "viola";
  const EXP = "exp-1";

  it("rc 2 on wrong arg count", async () => {
    const h = home();
    expect(await refineWith([TOPIC, INST, EXP], deps(h.home))).toBe(2);
    expect(await refineWith([TOPIC, INST, EXP, "narrow it", "extra"], deps(h.home))).toBe(2);
    expect(await refineWith([], deps(h.home))).toBe(2);
  });

  it("rc 2 on bad instrument", async () => {
    const h = home();
    expect(await refineWith([TOPIC, "Viola", EXP, "narrow it"], deps(h.home))).toBe(2);
  });

  it("rc 2 on bad exp-id", async () => {
    const h = home();
    expect(await refineWith([TOPIC, INST, "exp1", "narrow it"], deps(h.home))).toBe(2);
    expect(await refineWith([TOPIC, INST, "experiment-1", "narrow it"], deps(h.home))).toBe(2);
  });

  it("rc 1 when the branch dir is missing", async () => {
    const h = home();
    expect(await refineWith([TOPIC, INST, EXP, "narrow it"], deps(h.home))).toBe(1);
  });

  it("writes refine-1.md, then a second call writes refine-2.md", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    expect(await refineWith([TOPIC, INST, EXP, "focus on dropout"], deps(h.home))).toBe(0);
    expect(existsSync(join(dir, "refine-1.md"))).toBe(true);
    expect(await refineWith([TOPIC, INST, EXP, "now lower lr"], deps(h.home))).toBe(0);
    expect(existsSync(join(dir, "refine-2.md"))).toBe(true);
  });

  it("fills the FIRST free slot (refine-1 + refine-3 present -> writes refine-2, not refine-4)", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    writeFileSync(join(dir, "refine-1.md"), "old1\n");
    writeFileSync(join(dir, "refine-3.md"), "old3\n");
    expect(await refineWith([TOPIC, INST, EXP, "fill the gap"], deps(h.home))).toBe(0);
    expect(existsSync(join(dir, "refine-2.md"))).toBe(true);
    expect(existsSync(join(dir, "refine-4.md"))).toBe(false);
    expect(readFileSync(join(dir, "refine-2.md"), "utf8")).toBe("fill the gap\n");
  });

  it("body = the refinement text + a single trailing newline", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    expect(await refineWith([TOPIC, INST, EXP, "keep it under 100k params"], deps(h.home))).toBe(0);
    expect(readFileSync(join(dir, "refine-1.md"), "utf8")).toBe("keep it under 100k params\n");
  });

  it("dryRun: true -> send is NOT called; rc 0", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    const throwingSend = async (): Promise<number> => { throw new Error("send must not run under dryRun"); };
    expect(await refineWith([TOPIC, INST, EXP, "no nudge"], deps(h.home, { dryRun: true, send: throwingSend }))).toBe(0);
    expect(existsSync(join(dir, "refine-1.md"))).toBe(true);
  });

  it("nudge failure is non-fatal: send returning 1 -> rc still 0, a warning is logged", async () => {
    const h = home();
    mkBranch(h.home, TOPIC, INST, EXP);
    const warns: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { warns.push(String(c)); return true; });
    try {
      expect(await refineWith([TOPIC, INST, EXP, "nudge fails"], deps(h.home, { send: async () => 1 }))).toBe(0);
    } finally { spy.mockRestore(); }
    expect(warns.join("\n")).toContain("send nudge failed");
  });

  it("nudge throwing is non-fatal: send throws -> rc still 0", async () => {
    const h = home();
    mkBranch(h.home, TOPIC, INST, EXP);
    const throwingSend = async (): Promise<number> => { throw new Error("boom"); };
    expect(await refineWith([TOPIC, INST, EXP, "throw nudge"], deps(h.home, { send: throwingSend }))).toBe(0);
  });

  it("passes the consort send signature [--from maestro, instrument, topic, msg] referencing the refine path + exp-id", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    let captured: string[] = [];
    const sent = async (a: string[]): Promise<number> => { captured = a; return 0; };
    expect(await refineWith([TOPIC, INST, EXP, "capture me"], deps(h.home, { send: sent }))).toBe(0);
    expect(captured[0]).toBe("--from");
    expect(captured[1]).toBe("maestro");
    expect(captured[2]).toBe(INST);
    expect(captured[3]).toBe(TOPIC);
    expect(captured[4]).toContain(join(dir, "refine-1.md"));
    expect(captured[4]).toContain(EXP);
  });

  it("NO state mutation: a scaffolded state.txt is byte-unchanged after refine", async () => {
    const h = home();
    const dir = mkBranch(h.home, TOPIC, INST, EXP);
    // Scaffold a part-level state.txt alongside the experiment branch.
    const partDir = join(dir, "..", "..");
    const stateTxt = join(partDir, "state.txt");
    const stateBody = "phase\tworking\ncurrent_exp_id\texp-1\nlast_event_ts\t2026-05-30T00:00:00Z\n";
    writeFileSync(stateTxt, stateBody);
    const before = readFileSync(stateTxt);
    expect(await refineWith([TOPIC, INST, EXP, "must not touch state"], deps(h.home))).toBe(0);
    const after = readFileSync(stateTxt);
    expect(after.equals(before)).toBe(true);
  });
});
