// tests/rehearsal-tail-cmd.test.ts — rehearsal tail CLI verbs (Phase D).
// Extended by later D tasks; today: refine (stateless mid-experiment scope-narrowing).
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { refineWith, handoffExtractWith, forensicsRun, teardownWith, freshPartWith, abortWith, consensusWith, type RehearsalRefineDeps, type RehearsalTeardownDeps, type RehearsalFreshPartDeps, type RehearsalAbortDeps, type RehearsalConsensusDeps } from "../src/commands/rehearsal.js";
import { experimentDir, partStateDir, partsDir, rehearsalArtDir } from "../src/core/rehearsal.js";
import { parseState } from "../src/core/rehearsalState.js";

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

  it("--panes-only: kills partial panes, no archive / no winner symlink, preserves state, rc 0", async () => {
    const h = home();
    const opts = { home: h.home, cwd: h.home };
    const art = rehearsalArtDir("tune-model", opts);
    mkdirSync(join(art, "parts", "violin", "experiments", "exp-003", "code"), { recursive: true });
    writeFileSync(join(art, "scoreboard.md"), WINNER_SB);          // a winner exists...
    writeFileSync(join(art, "preflight-panes.txt"), "violin\t%1\nviola\t%2\n");
    writeFileSync(join(art, "metric.md"), "primary_metric: acc\n");

    const killed: string[] = [];
    let archived = false;
    const rc = await teardownWith(["tune-model", "--panes-only"], deps({
      opts, killPane: async (p) => { killed.push(p); },
      archiveTopic: () => { archived = true; return "/should/not/happen"; },
    }));
    expect(rc).toBe(0);
    expect(killed).toEqual(["%1", "%2"]);                          // partial panes killed
    expect(archived).toBe(false);                                 // NO archive
    expect(existsSync(join(art, "winner"))).toBe(false);          // ...but no winner symlink mid-retry
    expect(existsSync(join(art, "metric.md"))).toBe(true);        // state preserved for retry
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
    // Each non-blank "<instrument>\t<pane>" line passes only the PANE field (tab-split) to killPane.
    expect(killed).toEqual(["%1", "%2"]);
    // The file is removed after the kill sweep.
    expect(existsSync(join(art, "preflight-panes.txt"))).toBe(false);
  });
});

describe("fresh-part", () => {
  const TOPIC = "tune-model";
  const INST = "violin";

  // Scaffold <art>/parts/<inst>/state.txt by hand with the given KV body.
  function scaffoldState(homeDir: string, topic: string, instrument: string, body: string): string {
    const art = rehearsalArtDir(topic, { home: homeDir, cwd: homeDir });
    const dir = partStateDir(art, instrument);
    mkdirSync(dir, { recursive: true });
    const stateTxt = join(dir, "state.txt");
    writeFileSync(stateTxt, body);
    return stateTxt;
  }

  function fpDeps(homeDir: string, over: Partial<RehearsalFreshPartDeps> = {}): RehearsalFreshPartDeps {
    return {
      teardown: async () => {},
      spawn: async () => 0,
      now: () => "T",
      opts: { home: homeDir, cwd: homeDir },
      ...over,
    };
  }

  it("rc 2 on wrong arg count", async () => {
    const h = home();
    expect(await freshPartWith([TOPIC], fpDeps(h.home))).toBe(2);
    expect(await freshPartWith([TOPIC, INST, "extra"], fpDeps(h.home))).toBe(2);
    expect(await freshPartWith([], fpDeps(h.home))).toBe(2);
  });

  it("rc 2 on bad instrument", async () => {
    const h = home();
    expect(await freshPartWith([TOPIC, "Violin"], fpDeps(h.home))).toBe(2);
  });

  it("rc 1 when state.txt is missing", async () => {
    const h = home();
    expect(await freshPartWith([TOPIC, INST], fpDeps(h.home))).toBe(1);
  });

  it("rc 1 REFUSAL when phase=working; no teardown, no spawn", async () => {
    const h = home();
    scaffoldState(h.home, TOPIC, INST, "phase=working\nexp_counter=3\ncurrent_exp_id=exp-003\n");
    const tearDowns: Array<[string, string]> = [];
    const spawns: string[][] = [];
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    try {
      const rc = await freshPartWith([TOPIC, INST], fpDeps(h.home, {
        teardown: async (t, i) => { tearDowns.push([t, i]); },
        spawn: async (a) => { spawns.push(a); return 0; },
      }));
      expect(rc).toBe(1);
    } finally { spy.mockRestore(); }
    expect(errs.join("\n")).toContain(`part ${INST} is mid-experiment (phase=working); abort or wait for done before fresh-part.`);
    expect(tearDowns.length).toBe(0);
    expect(spawns.length).toBe(0);
  });

  it("happy path: tears down + respawns + resets runtime state, PRESERVES exp_counter", async () => {
    const h = home();
    const stateTxt = scaffoldState(h.home, TOPIC, INST,
      "phase=idle\nexp_counter=7\ncurrent_exp_id=exp-007\nprobe_sent_ts=xyz\nlast_event=done\n");
    const tearDowns: Array<[string, string]> = [];
    const spawns: string[][] = [];
    const rc = await freshPartWith([TOPIC, INST], fpDeps(h.home, {
      teardown: async (t, i) => { tearDowns.push([t, i]); },
      spawn: async (a) => { spawns.push(a); return 0; },
    }));
    expect(rc).toBe(0);
    expect(tearDowns).toEqual([[TOPIC, INST]]);
    expect(spawns).toEqual([[INST, "codex", TOPIC]]);
    const st = parseState(readFileSync(stateTxt, "utf8"));
    expect(st.phase).toBe("idle");
    expect(st.current_exp_id).toBe("");      // cleared to empty (mergeState preserves empty-value keys)
    expect(st.probe_sent_ts).toBe("");       // cleared to empty
    expect(st.exp_counter).toBe("7");        // PRESERVED
    expect(st.last_event).toBe("fresh-part-respawn");
    expect(st.last_event_ts).toBe("T");
  });

  it("non-numeric exp_counter resets to 0", async () => {
    const h = home();
    const stateTxt = scaffoldState(h.home, TOPIC, INST, "phase=idle\nexp_counter=NaN\n");
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown): boolean => { lines.push(String(c)); return true; });
    try {
      expect(await freshPartWith([TOPIC, INST], fpDeps(h.home))).toBe(0);
    } finally { spy.mockRestore(); }
    expect(parseState(readFileSync(stateTxt, "utf8")).exp_counter).toBe("0");
  });

  it("spawn-fail -> rc 1 + 'spawn failed'; state NOT reset", async () => {
    const h = home();
    const body = "phase=idle\nexp_counter=7\ncurrent_exp_id=exp-007\nprobe_sent_ts=xyz\nlast_event=done\n";
    const stateTxt = scaffoldState(h.home, TOPIC, INST, body);
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    let rc: number;
    try {
      rc = await freshPartWith([TOPIC, INST], fpDeps(h.home, { spawn: async () => 1 }));
    } finally { spy.mockRestore(); }
    expect(rc).toBe(1);
    expect(errs.join("\n")).toContain(`spawn failed for ${INST} on ${TOPIC}`);
    // Reset happens only after a successful spawn — state.txt byte-unchanged.
    expect(readFileSync(stateTxt, "utf8")).toBe(body);
  });

  it("teardown best-effort: a throwing teardown does not block respawn+reset (rc 0)", async () => {
    const h = home();
    const stateTxt = scaffoldState(h.home, TOPIC, INST, "phase=idle\nexp_counter=2\ncurrent_exp_id=exp-002\n");
    const spawns: string[][] = [];
    const rc = await freshPartWith([TOPIC, INST], fpDeps(h.home, {
      teardown: async () => { throw new Error("dead pane"); },
      spawn: async (a) => { spawns.push(a); return 0; },
    }));
    expect(rc).toBe(0);
    expect(spawns).toEqual([[INST, "codex", TOPIC]]);
    const st = parseState(readFileSync(stateTxt, "utf8"));
    expect(st.phase).toBe("idle");
    expect(st.last_event).toBe("fresh-part-respawn");
    expect(st.exp_counter).toBe("2");
    expect(st.current_exp_id).toBe("");
  });
});

describe("abort", () => {
  const TOPIC = "tune-model";

  function abDeps(homeDir: string, over: Partial<RehearsalAbortDeps> = {}): RehearsalAbortDeps {
    return {
      finalize: async () => 0,
      teardown: async () => 0,
      now: () => "T",
      opts: { home: homeDir, cwd: homeDir },
      ...over,
    };
  }

  // Scaffold the art dir; optionally write monitor-tasks.txt with the given ids.
  function scaffoldArt(homeDir: string, topic: string, ids?: string[]): string {
    const art = rehearsalArtDir(topic, { home: homeDir, cwd: homeDir });
    mkdirSync(art, { recursive: true });
    if (ids) writeFileSync(join(art, "monitor-tasks.txt"), ids.join("\n") + "\n");
    return art;
  }

  it("rc 2 on wrong arg count (0 and 3 positionals)", async () => {
    const h = home();
    expect(await abortWith([], abDeps(h.home))).toBe(2);
    expect(await abortWith([TOPIC, "reason", "extra"], abDeps(h.home))).toBe(2);
  });

  it("rc 1 when the art dir is missing", async () => {
    const h = home();
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    try {
      expect(await abortWith([TOPIC], abDeps(h.home))).toBe(1);
    } finally { spy.mockRestore(); }
    expect(errs.join("\n")).toContain("no active rehearsal session for topic");
  });

  it("happy path (default reason): writes halt.flag, finalize THEN teardown, TaskStop hint, rc 0", async () => {
    const h = home();
    const art = scaffoldArt(h.home, TOPIC, ["task-aaa", "task-bbb"]);
    const order: string[] = [];
    const infos: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { infos.push(String(c)); return true; });
    let rc: number;
    try {
      rc = await abortWith([TOPIC], abDeps(h.home, {
        finalize: async () => { order.push("finalize"); return 0; },
        teardown: async () => { order.push("teardown"); return 0; },
        now: () => "NOW-ISO",
      }));
    } finally { spy.mockRestore(); }
    expect(rc).toBe(0);
    // halt.flag written (plain, NOT atomic) with structured key=value body.
    const flag = readFileSync(join(art, "halt.flag"), "utf8");
    expect(flag).toBe("halted_by=user\nhalted_at=NOW-ISO\nreason=unspecified\n");
    // finalize runs before teardown.
    expect(order).toEqual(["finalize", "teardown"]);
    // TaskStop deferral hint names both Monitor task ids.
    const log = infos.join("\n");
    expect(log).toContain("2 Monitor task(s) still active");
    expect(log).toContain("task-aaa");
    expect(log).toContain("task-bbb");
    expect(log).toContain(`rehearsal session ${TOPIC} aborted`);
  });

  it("explicit reason is recorded in halt.flag", async () => {
    const h = home();
    const art = scaffoldArt(h.home, TOPIC);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await abortWith([TOPIC, "budget exhausted"], abDeps(h.home, { now: () => "NOW-ISO" }))).toBe(0);
    } finally { spy.mockRestore(); }
    expect(readFileSync(join(art, "halt.flag"), "utf8")).toBe("halted_by=user\nhalted_at=NOW-ISO\nreason=budget exhausted\n");
  });

  it("no Monitor tasks -> 'no Monitor tasks to stop' hint", async () => {
    const h = home();
    scaffoldArt(h.home, TOPIC);
    const infos: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { infos.push(String(c)); return true; });
    try {
      expect(await abortWith([TOPIC], abDeps(h.home))).toBe(0);
    } finally { spy.mockRestore(); }
    expect(infos.join("\n")).toContain("no Monitor tasks to stop");
  });

  it("finalize failure -> rc 1, 'finalize failed', teardown NOT called", async () => {
    const h = home();
    scaffoldArt(h.home, TOPIC);
    const order: string[] = [];
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    let rc: number;
    try {
      rc = await abortWith([TOPIC], abDeps(h.home, {
        finalize: async () => { order.push("finalize"); return 1; },
        teardown: async () => { order.push("teardown"); return 0; },
      }));
    } finally { spy.mockRestore(); }
    expect(rc).toBe(1);
    expect(errs.join("\n")).toContain("finalize failed");
    expect(order).toEqual(["finalize"]);
  });

  it("teardown failure -> rc 1, 'teardown failed' (after finalize ok)", async () => {
    const h = home();
    scaffoldArt(h.home, TOPIC);
    const order: string[] = [];
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    let rc: number;
    try {
      rc = await abortWith([TOPIC], abDeps(h.home, {
        finalize: async () => { order.push("finalize"); return 0; },
        teardown: async () => { order.push("teardown"); return 1; },
      }));
    } finally { spy.mockRestore(); }
    expect(rc).toBe(1);
    expect(errs.join("\n")).toContain("teardown failed");
    expect(order).toEqual(["finalize", "teardown"]);
  });

  it("monitor-tasks.txt is read BEFORE teardown and halt.flag persists", async () => {
    const h = home();
    const art = scaffoldArt(h.home, TOPIC, ["task-1", "", "task-2"]);
    const infos: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { infos.push(String(c)); return true; });
    try {
      // Fakes don't move monitor-tasks.txt; assert ids captured from the pre-teardown read.
      expect(await abortWith([TOPIC], abDeps(h.home))).toBe(0);
    } finally { spy.mockRestore(); }
    const log = infos.join("\n");
    // Blank line filtered out -> exactly 2 ids reported.
    expect(log).toContain("2 Monitor task(s) still active");
    expect(log).toContain("task-1");
    expect(log).toContain("task-2");
    // halt.flag captured before teardown (fakes don't archive it) -> still present with default reason.
    expect(existsSync(join(art, "halt.flag"))).toBe(true);
    expect(readFileSync(join(art, "halt.flag"), "utf8")).toContain("halted_by=user");
  });
});

describe("consensus", () => {
  const TOPIC = "tune-model";

  function csDeps(homeDir: string, over: Partial<RehearsalConsensusDeps> = {}): RehearsalConsensusDeps {
    return {
      now: () => "T",
      opts: { home: homeDir, cwd: homeDir },
      ...over,
    };
  }

  // Write a result.json into <art>/parts/<inst>/experiments/<exp>/.
  function writeResult(homeDir: string, topic: string, inst: string, exp: string, obj: unknown): void {
    const art = rehearsalArtDir(topic, { home: homeDir, cwd: homeDir });
    const dir = experimentDir(art, inst, exp);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "result.json"), JSON.stringify(obj));
  }

  it("rc 2 when no topic", async () => {
    const h = home();
    expect(await consensusWith([], csDeps(h.home))).toBe(2);
  });

  it("rc 2 on an unknown flag", async () => {
    const h = home();
    expect(await consensusWith(["--bogus", TOPIC], csDeps(h.home))).toBe(2);
  });

  it("rc 1 when the parts/ dir is missing", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, { home: h.home, cwd: h.home });
    mkdirSync(art, { recursive: true });
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    try {
      expect(await consensusWith([TOPIC], csDeps(h.home))).toBe(1);
    } finally { spy.mockRestore(); }
    expect(errs.join("\n")).toContain("no parts dir");
  });

  it("rc 1 when parts exist but no ok result.json", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, { home: h.home, cwd: h.home });
    mkdirSync(partsDir(art), { recursive: true });
    writeResult(h.home, TOPIC, "violin", "exp-001", { status: "fail", metric_value: 0.1 });
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown): boolean => { errs.push(String(c)); return true; });
    try {
      expect(await consensusWith([TOPIC], csDeps(h.home))).toBe(1);
    } finally { spy.mockRestore(); }
    expect(errs.join("\n")).toContain("no ok result.json files found");
  });

  it("happy path: writes consensus.md with Agreed/Contested/All-missing; latest-ok per part drives the matrix", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, { home: h.home, cwd: h.home });
    mkdirSync(partsDir(art), { recursive: true });
    // violin: an EARLIER ok exp + a LATER ok exp — the later one must win.
    writeResult(h.home, TOPIC, "violin", "exp-001", { status: "ok", metric_name: "acc", metric_value: 0.10, approach_label: "early" });
    writeResult(h.home, TOPIC, "violin", "exp-009", { status: "ok", metric_name: "acc", metric_value: 0.90, approach_label: "late" });
    // viola: a single ok exp. metric_name matches violin (Agreed); approach_label differs (Contested).
    writeResult(h.home, TOPIC, "viola", "exp-002", { status: "ok", metric_name: "acc", metric_value: 0.50, approach_label: "wide" });

    const lines: string[] = [];
    const sso = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown): boolean => { lines.push(String(c)); return true; });
    try {
      expect(await consensusWith([TOPIC], csDeps(h.home))).toBe(0);
    } finally { out.mockRestore(); sso.mockRestore(); }

    const md = readFileSync(join(art, "consensus.md"), "utf8");
    expect(md).toContain("## Agreed");
    expect(md).toContain("## Contested");
    expect(md).toContain("## All-missing");
    // metric_name agrees across both parts.
    expect(md).toContain("| metric_name | acc |");
    // latest-ok selection: violin's LATER exp (late / 0.90) drives the matrix, not the earlier (early / 0.10).
    expect(md).toContain("late");
    expect(md).not.toContain("early");
    // approach_label contested -> both differing values appear.
    expect(md).toContain("wide");
  });

  it("--epsilon=0.05 is parsed (metric_value within 0.05 counts as Agreed)", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, { home: h.home, cwd: h.home });
    mkdirSync(partsDir(art), { recursive: true });
    writeResult(h.home, TOPIC, "violin", "exp-001", { status: "ok", metric_value: 0.50 });
    writeResult(h.home, TOPIC, "viola", "exp-001", { status: "ok", metric_value: 0.53 });

    const sso = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await consensusWith([`--epsilon=0.05`, TOPIC], csDeps(h.home))).toBe(0);
    } finally { out.mockRestore(); sso.mockRestore(); }
    const md = readFileSync(join(art, "consensus.md"), "utf8");
    expect(md).toContain("Epsilon for metric_value: 0.05");
    // 0.50 vs 0.53 within epsilon 0.05 -> metric_value is Agreed (single value column).
    expect(md).toMatch(/\| metric_value \| 0\.5[03] \|/);
  });
});
