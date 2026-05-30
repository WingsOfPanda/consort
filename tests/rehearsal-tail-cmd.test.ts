// tests/rehearsal-tail-cmd.test.ts — rehearsal tail CLI verbs (Phase D).
// Extended by later D tasks; today: refine (stateless mid-experiment scope-narrowing).
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { refineWith, handoffExtractWith, forensicsRun, teardownWith, type RehearsalRefineDeps, type RehearsalTeardownDeps } from "../src/commands/rehearsal.js";
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

describe("handoff-extract", () => {
  // Parse handoff-data.kv body into a record (k=v per line).
  function parseKvBody(body: string): Record<string, string> {
    const o: Record<string, string> = {};
    for (const line of body.split("\n")) {
      if (!line) continue;
      const i = line.indexOf("=");
      if (i > 0) o[line.slice(0, i)] = line.slice(i + 1);
    }
    return o;
  }

  // Write a result.json under <art>/parts/<inst>/experiments/<exp>/.
  function writeResult(art: string, inst: string, exp: string, obj: unknown): void {
    const dir = experimentDir(art, inst, exp);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "result.json"), JSON.stringify(obj));
  }

  const WINNER_SB =
    "| rank | exp | instrument | metric | status |\n" +
    "| --- | --- | --- | --- | --- |\n" +
    "| 1 | exp-003 | violin | 0.9950 | ok |\n" +
    "| 2 | exp-002 | viola | 0.9100 | ok |\n";

  it("winner branch: full handoff-data.kv", async () => {
    home();
    const art = rehearsalArtDir("tune-model");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "topic.txt"), "Tune the model\nfor accuracy\n");
    writeFileSync(join(art, "scoreboard.md"), WINNER_SB);
    writeFileSync(join(art, "metric.md"), "Primary metric: acc\n");
    writeFileSync(join(art, "rehearsal-2026-05-30-landscape.md"), "# landscape\n");
    writeResult(art, "violin", "exp-003", { approach_label: "deep-net", notes: "best run", checkpoint_path: "ckpt.pt" });
    writeResult(art, "viola", "exp-002", { approach_label: "wide-net" });

    expect(await handoffExtractWith([art], { now: () => "T" })).toBe(0);
    const kv = parseKvBody(readFileSync(join(art, "handoff-data.kv"), "utf8"));
    expect(kv.mode).toBe("rehearsal");
    expect(kv.topic).toBe("Tune the model for accuracy");
    expect(kv.winner_instrument).toBe("violin");
    expect(kv.winner_exp).toBe("exp-003");
    expect(kv.winner_metric).toBe("0.9950");
    expect(kv.winner_approach).toBe("deep-net");
    expect(kv.winner_notes).toBe("best run");
    expect(kv.winner_checkpoint).toBe("parts/violin/experiments/exp-003/ckpt.pt");
    expect(kv.winner_code_dir).toBe("parts/violin/experiments/exp-003/code/");
    expect(kv.runner_up_1).toBe("viola/exp-002:0.9100:wide-net");
    expect(kv.landscape_doc).toBe("rehearsal-2026-05-30-landscape.md");
    expect(kv.mandates_block_path).toBe("metric.md");
    expect(kv.generated_ts).toBe("T");
  });

  it("no-winner branch: mode=rehearsal-no-winner", async () => {
    home();
    const art = rehearsalArtDir("no-win");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "topic.txt"), "nothing worked");
    writeFileSync(join(art, "scoreboard.md"),
      "| rank | exp | instrument | metric | status |\n| 1 | exp-001 | violin | n/a | fail |\n");
    expect(await handoffExtractWith([art], { now: () => "T" })).toBe(0);
    const kv = parseKvBody(readFileSync(join(art, "handoff-data.kv"), "utf8"));
    expect(kv.mode).toBe("rehearsal-no-winner");
    expect(kv.winner_instrument).toBeUndefined();
  });

  it("checkpoint: absolute path passes through verbatim; relative is prefixed", async () => {
    home();
    // absolute
    const artA = rehearsalArtDir("abs-ckpt");
    mkdirSync(artA, { recursive: true });
    writeFileSync(join(artA, "topic.txt"), "abs");
    writeFileSync(join(artA, "scoreboard.md"), WINNER_SB);
    writeResult(artA, "violin", "exp-003", { approach_label: "a", checkpoint_path: "/abs/x.pt" });
    writeResult(artA, "viola", "exp-002", {});
    expect(await handoffExtractWith([artA], { now: () => "T" })).toBe(0);
    const kvA = parseKvBody(readFileSync(join(artA, "handoff-data.kv"), "utf8"));
    expect(kvA.winner_checkpoint).toBe("/abs/x.pt");

    // relative
    const artR = rehearsalArtDir("rel-ckpt");
    mkdirSync(artR, { recursive: true });
    writeFileSync(join(artR, "topic.txt"), "rel");
    writeFileSync(join(artR, "scoreboard.md"), WINNER_SB);
    writeResult(artR, "violin", "exp-003", { approach_label: "a", checkpoint_path: "best.pt" });
    writeResult(artR, "viola", "exp-002", {});
    expect(await handoffExtractWith([artR], { now: () => "T" })).toBe(0);
    const kvR = parseKvBody(readFileSync(join(artR, "handoff-data.kv"), "utf8"));
    expect(kvR.winner_checkpoint).toBe("parts/violin/experiments/exp-003/best.pt");
  });

  it("rc 2 on missing art-dir arg", async () => {
    home();
    expect(await handoffExtractWith([], { now: () => "T" })).toBe(2);
    expect(await handoffExtractWith([rehearsalArtDir("nope")], { now: () => "T" })).toBe(2);
  });

  it("rc 2 when topic.txt is missing under the art dir", async () => {
    home();
    const art = rehearsalArtDir("no-topic");
    mkdirSync(art, { recursive: true });
    expect(await handoffExtractWith([art], { now: () => "T" })).toBe(2);
  });
});

describe("forensics", () => {
  it("rc 2 when no topic", async () => {
    home();
    expect(await forensicsRun([])).toBe(2);
  });

  it("rc 0 with no findings (empty art) -> log.info, no stdout path", async () => {
    home();
    const art = rehearsalArtDir("clean");
    mkdirSync(art, { recursive: true });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await forensicsRun(["clean"])).toBe(0);
    } finally { stdout.mockRestore(); }
    expect(stdout).not.toHaveBeenCalled();
  });

  it("rc 0 + stdout path when scrapeable findings exist", async () => {
    home();
    const topic = "buggy";
    const art = rehearsalArtDir(topic);
    mkdirSync(art, { recursive: true });
    // Sibling part dir under the topic dir carries an error event in its outbox.
    const partDir = join(art, "..", "violin-codex");
    mkdirSync(partDir, { recursive: true });
    writeFileSync(join(partDir, "outbox.jsonl"), '{"event":"error","reason":"boom"}\n');

    const lines: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown): boolean => { lines.push(String(c)); return true; });
    try {
      expect(await forensicsRun([topic])).toBe(0);
    } finally { stdout.mockRestore(); }
    expect(lines.length).toBe(1);
    expect(lines[0].trim()).toMatch(/forensics\/.*-rehearsal-buggy\.md$/);
  });
});

describe("teardown", () => {
  // Scoreboard with a top-1 ok row -> winner violin/exp-003.
  const WINNER_SB =
    "| rank | exp | instrument | metric | status |\n" +
    "| --- | --- | --- | --- | --- |\n" +
    "| 1 | exp-003 | violin | 0.9950 | ok |\n" +
    "| 2 | exp-002 | viola | 0.9100 | ok |\n";
  // Scoreboard whose only data row is partial (~) -> no ok row -> no winner.
  const PARTIAL_SB =
    "| rank | exp | instrument | metric | status |\n" +
    "| --- | --- | --- | --- | --- |\n" +
    "| ~1 | exp-001 | violin | n/a | ~partial |\n";

  function deps(over: Partial<RehearsalTeardownDeps> = {}): RehearsalTeardownDeps {
    return {
      killPane: async () => {},
      archiveTopic: () => "/fake/archive/dest",
      now: () => "T",
      ...over,
    };
  }

  it("rc 2 when no topic", async () => {
    home();
    expect(await teardownWith([], deps())).toBe(2);
  });

  it("rc 1 when the art dir is missing", async () => {
    const h = home();
    expect(await teardownWith(["nope"], deps({ opts: { home: h.home, cwd: h.home } }))).toBe(1);
  });

  it("winner symlink is created BEFORE archive; dest written to stdout; rc 0", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("tune-model", opts);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "scoreboard.md"), WINNER_SB);
    // REAL top-1 code dir.
    mkdirSync(join(art, "parts", "violin", "experiments", "exp-003", "code"), { recursive: true });

    // Fake archiveTopic asserts the symlink already exists at call time (ordering proof).
    let symlinkAtArchive: { isLink: boolean; target: string } | null = null;
    const fakeArchive = (topic: string, suite: "rehearsal"): string => {
      expect(topic).toBe("tune-model");
      expect(suite).toBe("rehearsal");
      const w = join(art, "winner");
      symlinkAtArchive = { isLink: lstatSync(w).isSymbolicLink(), target: readlinkSync(w) };
      return "/archive/here/_rehearsal-20260530T000000Z";
    };
    const lines: string[] = [];
    const rc = await teardownWith(["tune-model"], deps({
      opts, archiveTopic: fakeArchive, stdout: (l) => { lines.push(l); },
    }));
    expect(rc).toBe(0);
    // Symlink existed at archive time, relative target rides along inside _rehearsal.
    expect(symlinkAtArchive).not.toBeNull();
    expect(symlinkAtArchive!.isLink).toBe(true);
    expect(symlinkAtArchive!.target).toBe("parts/violin/experiments/exp-003/code");
    // The archive dest is written to stdout for the directive.
    expect(lines).toContain("/archive/here/_rehearsal-20260530T000000Z");
  });

  it("no ok row in scoreboard -> no winner symlink, still archives (rc 0)", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("partial-topic", opts);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "scoreboard.md"), PARTIAL_SB);

    let archived = false;
    const rc = await teardownWith(["partial-topic"], deps({
      opts, archiveTopic: () => { archived = true; return "/d"; },
    }));
    expect(rc).toBe(0);
    expect(existsSync(join(art, "winner"))).toBe(false);
    expect(archived).toBe(true);
  });

  it("killPane is NOT called when preflight-panes.txt is absent", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("no-panes", opts);
    mkdirSync(art, { recursive: true });

    const killPane = vi.fn(async () => {});
    const rc = await teardownWith(["no-panes"], deps({ opts, killPane }));
    expect(rc).toBe(0);
    expect(killPane).not.toHaveBeenCalled();
  });

  it("sweeps *.tmp and *.lock under shared/ (depth <=2), leaves other files", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("sweep-topic", opts);
    mkdirSync(join(art, "shared", "sub"), { recursive: true });
    writeFileSync(join(art, "scoreboard.md"), PARTIAL_SB);
    writeFileSync(join(art, "shared", "a.tmp"), "x");
    writeFileSync(join(art, "shared", "b.lock"), "x");
    writeFileSync(join(art, "shared", "keep.txt"), "x");
    writeFileSync(join(art, "shared", "sub", "c.tmp"), "x");
    // A .tmp OUTSIDE shared/ must survive.
    writeFileSync(join(art, "outside.tmp"), "x");

    const rc = await teardownWith(["sweep-topic"], deps({ opts }));
    expect(rc).toBe(0);
    expect(existsSync(join(art, "shared", "a.tmp"))).toBe(false);
    expect(existsSync(join(art, "shared", "b.lock"))).toBe(false);
    expect(existsSync(join(art, "shared", "sub", "c.tmp"))).toBe(false);
    expect(existsSync(join(art, "shared", "keep.txt"))).toBe(true);
    expect(existsSync(join(art, "outside.tmp"))).toBe(true);
  });

  it("preflight orphan kill: reads non-blank pane ids from preflight-panes.txt", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("kill-topic", opts);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "preflight-panes.txt"), "violin\t%1\n\nviola\t%2\n");

    const killed: string[] = [];
    const rc = await teardownWith(["kill-topic"], deps({
      opts, killPane: async (p) => { killed.push(p); },
    }));
    expect(rc).toBe(0);
    // Each non-blank line is passed to killPane (whole line; best-effort).
    expect(killed.length).toBe(2);
  });
});
