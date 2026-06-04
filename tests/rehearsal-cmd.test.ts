// tests/rehearsal-cmd.test.ts — rehearsal CLI verbs (Phase B).
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { freshHome } from "./helpers/tmpHome.js";
import { initWith, type RehearsalInitDeps } from "../src/commands/rehearsal.js";
import { metricWith, sotaWith } from "../src/commands/rehearsal.js";
import { spawnAllWith, type SpawnAllDeps } from "../src/commands/rehearsal.js";
import { dropPartWith, type DropPartDeps } from "../src/commands/rehearsal.js";
import { experimentSendWith, type ExperimentSendDeps } from "../src/commands/rehearsal.js";
import { experimentTimeoutDefault } from "../src/commands/rehearsal.js";
import { consultTimeout } from "../src/core/contracts.js";
import { scoreWith, liveScoreDeps } from "../src/commands/rehearsal.js";
import { monitorRun } from "../src/commands/rehearsal.js";
import { statusBriefWith } from "../src/commands/rehearsal.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rehearsalArtDir, partStateDir, experimentDir } from "../src/core/rehearsal.js";
import { partDir } from "../src/core/paths.js";
import { inboxPath } from "../src/core/ipc.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function home() { const h = freshHome(); cleanups.push(h.cleanup); return h; }

const okDeps = (over: Partial<RehearsalInitDeps> = {}): RehearsalInitDeps => ({
  haveCmd: () => true,
  instrumentBinary: (n) => (n === "codex" ? "codex" : undefined),
  now: () => "2026-05-30T00:00:00Z",
  probeHardware: () => {},
  configRoot: () => process.cwd(),
  ...over,
});

describe("rehearsal init", () => {
  it("scaffolds the _rehearsal art dir, topic.txt, and a metric.txt seed; prints TOPIC + ART", async () => {
    const h = home();
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    const rc = await initWith(["maximize accuracy under 100k params"],
      okDeps({ stdout: log, opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    // deriveSlug caps at 20 chars (canonical frozen pipeline) → "maximize-accuracy-un".
    const art = rehearsalArtDir("maximize-accuracy-un", { home: h.home, cwd: h.home });
    expect(existsSync(art)).toBe(true);
    expect(readFileSync(`${art}/topic.txt`, "utf8")).toBe("maximize accuracy under 100k params");
    expect(readFileSync(`${art}/metric.txt`, "utf8").trim()).toBe("accuracy");
    expect(out.join("\n")).toContain(`ART=${art}`);
    expect(out.join("\n")).toContain("TOPIC=maximize-accuracy-un");
  });
  it("seeds <art>/lib/ from config/rehearsal-lib-seed", async () => {
    const h = home();
    const rc = await initWith(["seed lib topic"], okDeps({ configRoot: () => process.cwd(), opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    const art = rehearsalArtDir("seed-lib-topic", { home: h.home, cwd: h.home });
    for (const f of ["arena.py", "__init__.py", "README.md"]) expect(existsSync(join(art, "lib", f))).toBe(true);
    expect(readFileSync(join(art, "lib", "arena.py"), "utf8")).toContain("def arena_color_rotated");
  });
  it("gates on codex availability (rc 3)", async () => {
    const h = home();
    const rc = await initWith(["x topic"], okDeps({ haveCmd: () => false, opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(3);
  });
  it("rejects an empty slug (rc 2)", async () => {
    const h = home();
    const rc = await initWith(["!!!"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(2);
  });
  it("refuses an already-in-flight topic (rc 2)", async () => {
    const h = home();
    const d = okDeps({ opts: { home: h.home, cwd: h.home } });
    expect(await initWith(["same topic"], d)).toBe(0);
    expect(await initWith(["same topic"], d)).toBe(2);
  });
  it("--metric pre-writes metric.md; --time-budget pre-writes time-budget.txt + session-start.txt", async () => {
    const h = home();
    const rc = await initWith([
      "--metric", "primary_metric=accuracy,direction=maximize,min_acceptable=>= 0.9,target=>= 0.99",
      "--time-budget", "4h", "tune model",
    ], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    const art = rehearsalArtDir("tune-model", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/metric.md`, "utf8")).toContain("**Primary metric:** accuracy");
    expect(readFileSync(`${art}/time-budget.txt`, "utf8").trim()).toBe("14400");
    expect(readFileSync(`${art}/session-start.txt`, "utf8").trim()).toBe("2026-05-30T00:00:00Z");
  });
  it("--slug overrides derivation; --time-budget none resolves", async () => {
    const h = home();
    expect(await initWith(["--slug", "myrun", "--time-budget", "none", "anything"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art = rehearsalArtDir("myrun", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/time-budget.txt`, "utf8").trim()).toBe("none");
  });
  it("unknown flag -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--bogus", "x topic"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--seed-from with a missing path -> rc 1", async () => {
    const h = home();
    expect(await initWith(["--seed-from", "/no/such/file", "seed topic"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(1);
  });
  it("--metric with a malformed block (missing direction) -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--metric", "primary_metric=auc", "bad metric topic"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--slug rejects a value not matching ^[a-z][a-z0-9-]{0,19}$ -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--slug", "9bad", "x"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
    expect(await initWith(["--slug", "WAY-too-long-a-slug-value-here", "x"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
  it("--time-budget accepts <N>s and bare integer seconds", async () => {
    const h = home();
    expect(await initWith(["--slug", "tbsec", "--time-budget", "900s", "t"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art1 = rehearsalArtDir("tbsec", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art1}/time-budget.txt`, "utf8").trim()).toBe("900");
    expect(await initWith(["--slug", "tbint", "--time-budget", "1800", "t"],
      okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(0);
    const art2 = rehearsalArtDir("tbint", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art2}/time-budget.txt`, "utf8").trim()).toBe("1800");
  });
  it("--time-budget rejects a malformed value -> rc 2", async () => {
    const h = home();
    expect(await initWith(["--time-budget", "0h", "t"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
    expect(await initWith(["--time-budget", "abc", "t"], okDeps({ opts: { home: h.home, cwd: h.home } }))).toBe(2);
  });
});

describe("rehearsal metric / sota verbs", () => {
  it("metric writes metric.md from --kv", async () => {
    const h = home();
    await initWith(["--slug", "r1", "topic one"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await metricWith(["r1", "--kv", "primary_metric=auc,direction=maximize,min_acceptable=>= 0.8"],
      { opts: { home: h.home, cwd: h.home } });
    expect(rc).toBe(0);
    const art = rehearsalArtDir("r1", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/metric.md`, "utf8")).toContain("**Primary metric:** auc");
  });
  it("metric returns 2 on a bad block (missing direction)", async () => {
    const h = home();
    await initWith(["--slug", "r2", "topic two"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    expect(await metricWith(["r2", "--kv", "primary_metric=auc"], { opts: { home: h.home, cwd: h.home } })).toBe(2);
  });
  it("sota writes sota.md from --kv with ref rows", async () => {
    const h = home();
    await initWith(["--slug", "r3", "topic three"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await sotaWith(["r3", "--kv",
      "topic=mnist,metric=accuracy,sweep_date=2026-05-30,ref_1=cnn|0.99|fits|url|note"],
      { opts: { home: h.home, cwd: h.home } });
    expect(rc).toBe(0);
    const art = rehearsalArtDir("r3", { home: h.home, cwd: h.home });
    const md = readFileSync(`${art}/sota.md`, "utf8");
    expect(md).toContain("# SOTA reference — mnist");
    expect(md).toContain("| cnn | 0.99 | fits | url | note |");
  });
});

describe("rehearsal spawn-all", () => {
  function deps(over: Partial<SpawnAllDeps> = {}): SpawnAllDeps {
    return {
      preflight: async (a) => {
        const art = a[a.indexOf("--art-dir") + 1];
        const roster = a[a.indexOf("--roster") + 1]; // "inst:codex,inst2:codex"
        const lines = roster.split(",").map((e, i) => `${e.split(":")[0]}\t%${i + 1}`).join("\n");
        mkdirSync(art, { recursive: true });
        writeFileSync(`${art}/preflight-panes.txt`, lines + "\n");
        return 0;
      },
      spawn: async () => 0,
      repoRoot: () => "/repo",
      pickInstruments: (_t, n) => Array.from({ length: n }, (_, i) => `inst${i + 1}`),
      ...over,
    };
  }
  it("picks N codex parts, spawns them, writes parts.txt + spawn-results.tsv, rc 0", async () => {
    const h = home();
    await initWith(["--slug", "s1", "spawn topic"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await spawnAllWith(["s1", "2"], deps(), { home: h.home, cwd: h.home });
    expect(rc).toBe(0);
    const art = rehearsalArtDir("s1", { home: h.home, cwd: h.home });
    expect(readFileSync(`${art}/parts.txt`, "utf8").trim().split("\n")).toEqual(["inst1", "inst2"]);
    expect(readFileSync(`${art}/spawn-results.tsv`, "utf8")).toContain("inst1\tcodex\t0");
  });
  it("rc 1 when one part fails to come up", async () => {
    const h = home();
    await initWith(["--slug", "s2", "spawn topic 2"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await spawnAllWith(["s2", "2"], deps({ spawn: async (a) => (a[0] === "inst2" ? 1 : 0) }), { home: h.home, cwd: h.home });
    expect(rc).toBe(1);
  });
  it("rc 3 when fewer than 2 instruments can be picked", async () => {
    const h = home();
    await initWith(["--slug", "s3", "spawn topic 3"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await spawnAllWith(["s3", "2"], deps({ pickInstruments: () => ["only1"] }), { home: h.home, cwd: h.home });
    expect(rc).toBe(3);
  });
  it("rc 3 when preflight omits a pane for some part (orphan guard)", async () => {
    const h = home();
    await initWith(["--slug", "s4", "spawn topic 4"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const d = deps({
      preflight: async (a) => {
        const art = a[a.indexOf("--art-dir") + 1];
        mkdirSync(art, { recursive: true });
        // only allocate a pane for inst1, omit inst2 -> orphan
        writeFileSync(`${art}/preflight-panes.txt`, "inst1\t%1\n");
        return 0;
      },
    });
    expect(await spawnAllWith(["s4", "2"], d, { home: h.home, cwd: h.home })).toBe(3);
  });
});

describe("rehearsal drop-part", () => {
  const TOPIC = "dp-topic";
  const opts = (h: { home: string }) => ({ home: h.home, cwd: process.cwd() });
  const noKill: DropPartDeps = { killPane: () => {} };
  it("prunes the named instrument from parts.txt and reports remaining N", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, opts(h));
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "rex\nkeeli\ncolt\n");
    expect(await dropPartWith([TOPIC, "keeli"], noKill, opts(h))).toBe(0);
    expect(readFileSync(join(art, "parts.txt"), "utf8")).toBe("rex\ncolt\n");
  });
  it("writes an empty parts.txt when the last instrument is dropped", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, opts(h));
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "rex\n");
    expect(await dropPartWith([TOPIC, "rex"], noKill, opts(h))).toBe(0);
    expect(readFileSync(join(art, "parts.txt"), "utf8")).toBe("");
  });
  it("rc 1 when parts.txt is missing", async () => {
    const h = home();
    expect(await dropPartWith([TOPIC, "rex"], noKill, opts(h))).toBe(1);
  });
  it("rc 1 when the instrument is not present", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, opts(h));
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "rex\n");
    expect(await dropPartWith([TOPIC, "ghost"], noKill, opts(h))).toBe(1);
  });
  it("rc 2 on bad usage", async () => {
    const h = home();
    expect(await dropPartWith([TOPIC], noKill, opts(h))).toBe(2);
  });
  it("best-effort kills the dropped instrument's preflight pane", async () => {
    const h = home();
    const art = rehearsalArtDir(TOPIC, opts(h));
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "rex\nkeeli\n");
    writeFileSync(join(art, "preflight-panes.txt"), "rex\t%5\nkeeli\t%6\n");
    const killed: string[] = [];
    await dropPartWith([TOPIC, "keeli"], { killPane: (p) => killed.push(p) }, opts(h));
    expect(killed).toEqual(["%6"]);
  });
});

describe("rehearsal experiment timeout env override", () => {
  const KEY = "CONSORT_REHEARSAL_EXPERIMENT_TIMEOUT_OVERRIDE";
  const orig = process.env[KEY];
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
  it("honors a positive-integer override", () => {
    process.env[KEY] = "900";
    expect(experimentTimeoutDefault()).toBe(900);
  });
  it("falls through to the contracts default on a non-positive / non-integer value", () => {
    process.env[KEY] = "0";
    expect(experimentTimeoutDefault()).toBe(consultTimeout("experiment"));
    process.env[KEY] = "abc";
    expect(experimentTimeoutDefault()).toBe(consultTimeout("experiment"));
  });
});

// ---- Phase C: experiment-send — dispatch ONE experiment to a persistent codex part ----

describe("rehearsal experiment-send", () => {
  const TOPIC = "es-topic";
  const INST = "violin";
  const MODEL = "codex";
  // resolveModel (in ipc.ts) looks up the part via topicDir(topic) with NO cwd opt,
  // so it hashes process.cwd(). Scaffold under the same cwd so the part dir + art dir
  // (which thread opts) and resolveModel's lookup all land on one repoHash. home is set
  // via CONSORT_HOME (freshHome) so the state root agrees regardless.
  const opts = (h: { home: string }) => ({ home: h.home, cwd: process.cwd() });

  /** Scaffold an in-flight topic: art dir + metric.md + topic.txt + part state.txt (idle) +
   *  a live part dir (pane.json + outbox.jsonl) so resolveModel/outbox/paneMetaRead resolve. */
  function scaffold(h: { home: string }, over: { phase?: string; metric?: boolean; state?: boolean; outbox?: boolean; sota?: string } = {}) {
    const o = opts(h);
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    if (over.metric !== false) writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    writeFileSync(join(art, "topic.txt"), "improve accuracy");
    if (over.sota) writeFileSync(join(art, "sota.md"), over.sota);
    const sd = partStateDir(art, INST);
    if (over.state !== false) { mkdirSync(sd, { recursive: true }); writeFileSync(join(sd, "state.txt"), `phase=${over.phase ?? "idle"}\nexp_counter=0\n`); }
    else mkdirSync(sd, { recursive: true });
    const pd = partDir(INST, MODEL, TOPIC, o);
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "pane.json"), JSON.stringify({ pane_id: "%7", instrument: INST, model: MODEL, spawned_at: "t" }));
    if (over.outbox !== false) writeFileSync(join(pd, "outbox.jsonl"), "");
    return { art, sd, pd, o };
  }

  function deps(h: { home: string }, over: Partial<ExperimentSendDeps> = {}): ExperimentSendDeps {
    return {
      now: () => "T",
      probeHardware: () => "no-gpu",
      paneSend: async () => {},
      consultTimeout: () => 1800,
      dryRun: true,
      opts: opts(h),
      ...over,
    };
  }

  it("idle part -> rc 0: renders prompt.md, writes inbox + transitions state", async () => {
    const h = home();
    const { art, sd, o } = scaffold(h);
    const rc = await experimentSendWith([TOPIC, INST, "exp-001", "baseline", "a plain baseline"], deps(h));
    expect(rc).toBe(0);
    const promptPath = join(art, "parts", INST, "experiments", "exp-001", "prompt.md");
    expect(existsSync(promptPath)).toBe(true);
    const prompt = readFileSync(promptPath, "utf8");
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("baseline");
    expect(prompt).toContain("a plain baseline");
    // inbox carries the prompt + the canonical fence
    const inbox = readFileSync(inboxPath(INST, MODEL, TOPIC), "utf8");
    expect(inbox).toContain("a plain baseline");
    expect(inbox).toContain("END_OF_INSTRUCTION");
    // A1: the experiment template owns the SOLE done contract — no generic wrapper.
    expect(inbox).not.toContain("<one-line summary>");
    expect((inbox.match(/"event":"done"/g) ?? []).length).toBe(1);
    expect(inbox).toContain("experiment exp-001 metric=<value> status=<status>");
    // state transition
    const st = readFileSync(join(sd, "state.txt"), "utf8");
    expect(st).toContain("phase=working");
    expect(st).toContain("current_exp_id=exp-001");
    expect(st).toContain("exp_counter=1");
    expect(st).toContain("last_event=dispatched");
    void art; void o;
  });

  it("inbox carries exactly one done contract — the template's specific one, not the generic wrapper", async () => {
    const h = home();
    scaffold(h);
    await experimentSendWith([TOPIC, INST, "exp-001", "baseline", "a plain baseline"], deps(h));
    const inbox = readFileSync(inboxPath(INST, MODEL, TOPIC), "utf8");
    expect(inbox).toContain("END_OF_INSTRUCTION");
    expect(inbox).not.toContain("<one-line summary>");
    expect((inbox.match(/"event":"done"/g) ?? []).length).toBe(1);
  });

  it("phase=working -> rc 1 (state untouched)", async () => {
    const h = home();
    const { sd } = scaffold(h, { phase: "working" });
    expect(await experimentSendWith([TOPIC, INST, "exp-002", "x", "y"], deps(h))).toBe(1);
    expect(readFileSync(join(sd, "state.txt"), "utf8")).toContain("phase=working");
  });

  it("phase=abandoned -> rc 2 (distinct)", async () => {
    const h = home();
    scaffold(h, { phase: "abandoned" });
    expect(await experimentSendWith([TOPIC, INST, "exp-002", "x", "y"], deps(h))).toBe(2);
  });

  it("bad exp-id -> rc 2", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith([TOPIC, INST, "exp1", "x", "y"], deps(h))).toBe(2);
  });

  it("bad instrument -> rc 2", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith([TOPIC, "Viola", "exp-001", "x", "y"], deps(h))).toBe(2);
  });

  it("bad --timeout -> rc 2", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith(["--timeout", "x", TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(2);
  });

  it("wrong positional count -> rc 2", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith([TOPIC, INST, "exp-001"], deps(h))).toBe(2);
  });

  it("missing metric.md -> rc 1", async () => {
    const h = home();
    scaffold(h, { metric: false });
    expect(await experimentSendWith([TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(1);
  });

  it("missing state.txt -> rc 1", async () => {
    const h = home();
    scaffold(h, { state: false });
    expect(await experimentSendWith([TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(1);
  });

  it("missing outbox -> rc 1", async () => {
    const h = home();
    scaffold(h, { outbox: false });
    expect(await experimentSendWith([TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(1);
  });

  it("missing art dir -> rc 1", async () => {
    const h = home();
    // no scaffold at all
    expect(await experimentSendWith([TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(1);
  });

  it("--context-file unreadable -> rc 2", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith(["--context-file", "/no/such/file", TOPIC, INST, "exp-001", "x", "y"], deps(h))).toBe(2);
  });

  it("--context-file readable -> its content appears in prompt.md", async () => {
    const h = home();
    const { art } = scaffold(h);
    const ctx = join(h.home, "ctx.txt");
    writeFileSync(ctx, "SPECIAL_CONTEXT_MARKER");
    const rc = await experimentSendWith(["--context-file", ctx, TOPIC, INST, "exp-003", "x", "y"], deps(h));
    expect(rc).toBe(0);
    const prompt = readFileSync(join(art, "parts", INST, "experiments", "exp-003", "prompt.md"), "utf8");
    expect(prompt).toContain("SPECIAL_CONTEXT_MARKER");
  });

  it("--smoke-test failing -> rc 2, smoke-test.err written, state still idle", async () => {
    const h = home();
    const { art, sd } = scaffold(h);
    const script = join(h.home, "smoke.sh");
    writeFileSync(script, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const rc = await experimentSendWith(["--smoke-test", script, TOPIC, INST, "exp-004", "x", "y"],
      deps(h, { runSmokeTest: () => ({ ok: false, stderr: "boom" }) }));
    expect(rc).toBe(2);
    expect(readFileSync(join(art, "parts", INST, "experiments", "exp-004", "smoke-test.err"), "utf8")).toContain("boom");
    expect(readFileSync(join(sd, "state.txt"), "utf8")).toContain("phase=idle");
  });

  it("sota.md present -> prompt.md contains the SOTA reference heading", async () => {
    const h = home();
    const { art } = scaffold(h, { sota: "# SOTA reference — mnist\n\n| a | b |\n" });
    const rc = await experimentSendWith([TOPIC, INST, "exp-005", "x", "y"], deps(h));
    expect(rc).toBe(0);
    const prompt = readFileSync(join(art, "parts", INST, "experiments", "exp-005", "prompt.md"), "utf8");
    expect(prompt).toContain("## Reference: SOTA");
  });

  it("best-effort nudge: a throwing paneSend still yields rc 0 with inbox + state written", async () => {
    const h = home();
    const { sd } = scaffold(h);
    const rc = await experimentSendWith([TOPIC, INST, "exp-006", "x", "y"],
      deps(h, { dryRun: false, paneSend: async () => { throw new Error("tmux down"); } }));
    expect(rc).toBe(0);
    expect(readFileSync(inboxPath(INST, MODEL, TOPIC), "utf8")).toContain("END_OF_INSTRUCTION");
    expect(readFileSync(join(sd, "state.txt"), "utf8")).toContain("phase=working");
  });
});

// ---- Phase C: score — thin FS shell over computeScore ----

describe("rehearsal score", () => {
  const SCORE_OPTS = (h: { home: string }) => ({ ...liveScoreDeps, opts: { home: h.home } });

  /** Write a valid result.json for one experiment. metric_name defaults to accuracy. */
  function result(over: { metric?: number; metricName?: string; approach?: string } = {}): string {
    return JSON.stringify({
      branch_id: "b", approach_label: over.approach ?? "approach",
      metric_name: over.metricName ?? "accuracy",
      metric_value: over.metric ?? 0.9, status: "ok", runtime_s: 10,
      log_paths: [], checkpoint_path: null, notes: "",
    });
  }

  /** Scaffold an in-flight rehearsal art dir with metric.md + two working parts each with one
   *  experiment result.json. `over.experiments` patches the per-instrument result body/expId. */
  function scaffold(h: { home: string }, parts: Record<string, { expId: string; body: string; experiments?: boolean }>) {
    const art = rehearsalArtDir("topic", { home: h.home });
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    for (const [inst, p] of Object.entries(parts)) {
      const sd = partStateDir(art, inst);
      mkdirSync(sd, { recursive: true });
      writeFileSync(join(sd, "state.txt"), `phase=working\ncurrent_exp_id=${p.expId}\n`);
      if (p.experiments !== false) {
        const expDir = join(sd, "experiments", p.expId);
        mkdirSync(expDir, { recursive: true });
        writeFileSync(join(expDir, "result.json"), p.body);
      }
    }
    return art;
  }

  it("rc 0; writes scoreboard.md (ranked) + results.tsv + clears phases to idle", async () => {
    const h = home();
    const art = scaffold(h, {
      alto: { expId: "exp-001", body: result({ metric: 0.95 }) },
      bass: { expId: "exp-001", body: result({ metric: 0.90 }) },
    });
    const rc = await scoreWith(["topic"], SCORE_OPTS(h));
    expect(rc).toBe(0);

    const sb = readFileSync(join(art, "scoreboard.md"), "utf8");
    expect(existsSync(join(art, "scoreboard.md"))).toBe(true);
    // 0.95 part ranked #1, 0.90 ranked #2.
    const rank1 = sb.split("\n").find((l) => l.startsWith("| 1 |"))!;
    const rank2 = sb.split("\n").find((l) => l.startsWith("| 2 |"))!;
    expect(rank1).toContain("exp-001");
    expect(rank1).toContain("0.9500");
    expect(rank2).toContain("0.9000");

    const tsv = readFileSync(join(art, "results.tsv"), "utf8");
    expect(existsSync(join(art, "results.tsv"))).toBe(true);
    const tsvLines = tsv.trimEnd().split("\n");
    expect(tsvLines[0]).toBe("exp_id\tinstrument\tapproach\tmetric\tstatus\truntime_s\tmetric_name");
    expect(tsvLines).toHaveLength(3); // header + 2 rows
    // ascending walk order (alto before bass)
    expect(tsvLines[1]).toContain("alto");
    expect(tsvLines[2]).toContain("bass");

    // phase cleared on both parts
    for (const inst of ["alto", "bass"]) {
      const st = readFileSync(join(partStateDir(art, inst), "state.txt"), "utf8");
      expect(st).toContain("phase=idle");
      expect(st).toContain("current_exp_id=");
      expect(st).not.toMatch(/current_exp_id=exp-001/);
    }
  });

  it("a bad result (metric_name mismatch) writes result-validation.txt and is absent from scoreboard; rc 0", async () => {
    const h = home();
    const art = scaffold(h, {
      good: { expId: "exp-001", body: result({ metric: 0.95 }) },
      bad: { expId: "exp-001", body: result({ metric: 0.80, metricName: "auc" }) },
    });
    const rc = await scoreWith(["topic"], SCORE_OPTS(h));
    expect(rc).toBe(0);
    const sidecar = join(partStateDir(art, "bad"), "experiments", "exp-001", "result-validation.txt");
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toContain("FAILED");
    const sb = readFileSync(join(art, "scoreboard.md"), "utf8");
    expect(sb).toContain("0.9500"); // good row present
    expect(sb).not.toContain("0.8000"); // bad row absent
  });

  it("no topic -> rc 2", async () => {
    const h = home();
    expect(await scoreWith([], SCORE_OPTS(h))).toBe(2);
  });

  it(">1 positional -> rc 2", async () => {
    const h = home();
    expect(await scoreWith(["a", "b"], SCORE_OPTS(h))).toBe(2);
  });

  it("missing parts dir -> rc 1", async () => {
    const h = home();
    const art = rehearsalArtDir("topic", { home: h.home });
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    expect(await scoreWith(["topic"], SCORE_OPTS(h))).toBe(1);
  });

  it("ENOENT-safe: a part with state.txt but no experiments/ dir does not crash -> rc 0", async () => {
    const h = home();
    const art = rehearsalArtDir("topic", { home: h.home });
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    const sd = partStateDir(art, "solo");
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "state.txt"), "phase=working\ncurrent_exp_id=exp-001\n");
    // NO experiments/ dir under solo -> live listDir must return [] not throw.
    expect(await scoreWith(["topic"], SCORE_OPTS(h))).toBe(0);
  });
});

// ---- Phase C: monitor — per-part liveness scan loop (C7) ----

describe("rehearsal monitor", () => {
  const TOPIC = "mon-topic";
  const INST = "viola";
  const MODEL = "codex";
  // resolveModel hashes process.cwd() (no cwd opt), so scaffold under process.cwd().
  const opts = (h: { home: string }) => ({ home: h.home, cwd: process.cwd() });

  /** Scaffold an in-flight topic with a live codex part (pane.json + outbox.jsonl carrying
   *  one done event) and a working state.txt under the art's part state dir. */
  function scaffold(h: { home: string }) {
    const o = opts(h);
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    const pd = partDir(INST, MODEL, TOPIC, o);
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "pane.json"), JSON.stringify({ instrument: INST, model: MODEL, pane_id: "%1" }));
    writeFileSync(join(pd, "outbox.jsonl"), '{"event":"done","summary":"finished","ts":"T"}\n');
    const sd = partStateDir(art, INST);
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "state.txt"), "phase=working\n");
    return { art, pd, sd, o };
  }

  /** Capture process.stdout.write lines for the duration of fn. */
  async function capture(fn: () => Promise<number>): Promise<{ rc: number; lines: string[] }> {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const rc = await fn();
      return { rc, lines: lines.join("").split("\n").filter(Boolean) };
    } finally {
      spy.mockRestore();
    }
  }

  it("--once: emits the existing done event past a 0 cursor and persists the byte cursor; rc 0", async () => {
    const h = home();
    const { sd, pd } = scaffold(h);
    // Pre-seed the cursor at 0 so a fresh monitor's byte-tail sees the existing done line.
    writeFileSync(join(sd, "liveness-cursor.txt"), "0");
    const { rc, lines } = await capture(() => monitorRun([TOPIC, INST, "--once"], opts(h)));
    expect(rc).toBe(0);
    const events = lines.map((l) => JSON.parse(l) as { part: string; event: string });
    expect(events.some((e) => e.part === INST && e.event === "done")).toBe(true);
    // cursor advanced to the outbox byte size
    const size = readFileSync(join(pd, "outbox.jsonl")).length;
    expect(readFileSync(join(sd, "liveness-cursor.txt"), "utf8")).toBe(String(size));
  });

  it("wrong arg count -> rc 2", async () => {
    const h = home();
    scaffold(h);
    const { rc } = await capture(() => monitorRun([TOPIC], opts(h)));
    expect(rc).toBe(2);
  });

  it("missing art dir -> rc 2", async () => {
    const h = home();
    scaffold(h);
    const { rc } = await capture(() => monitorRun(["nope", INST, "--once"], opts(h)));
    expect(rc).toBe(2);
  });

  it("null model (no part dir) -> rc 1", async () => {
    const h = home();
    scaffold(h);
    const { rc } = await capture(() => monitorRun([TOPIC, "ghost", "--once"], opts(h)));
    expect(rc).toBe(1);
  });

  it("--once flag is position-independent (leading flag) -> rc 0", async () => {
    const h = home();
    const { sd } = scaffold(h);
    writeFileSync(join(sd, "liveness-cursor.txt"), "0");
    const { rc } = await capture(() => monitorRun(["--once", TOPIC, INST], opts(h)));
    expect(rc).toBe(0);
  });
});

// ---- Phase C: status-brief — render a compact chat-shaped status update (C8) ----

describe("rehearsal status-brief", () => {
  const TOPIC = "sb-topic";
  const INST = "viola";

  /** Scaffold an in-flight topic: art + metric.md + scoreboard.md (one OK row) +
   *  parts.txt (one instrument) + the part's working state.txt + its prompt.md. */
  function scaffold(h: { home: string }) {
    const o = { home: h.home };
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    writeFileSync(join(art, "scoreboard.md"), [
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
      "| 1 | exp-001 | viola | 0.9500 | ok | 10.00s | baseline | accuracy |",
    ].join("\n") + "\n");
    writeFileSync(join(art, "parts.txt"), INST + "\n");
    const sd = partStateDir(art, INST);
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "state.txt"), "phase=working\ncurrent_exp_id=exp-001\n");
    const expDir = experimentDir(art, INST, "exp-001");
    mkdirSync(expDir, { recursive: true });
    writeFileSync(join(expDir, "prompt.md"), "Some preamble\n  Approach label:  baseline\nmore text\n");
    return { art, o };
  }

  async function capture(fn: (stdout: (l: string) => void) => Promise<number>): Promise<{ rc: number; text: string }> {
    const lines: string[] = [];
    const rc = await fn((l) => lines.push(l));
    return { rc, text: lines.join("\n") };
  }

  it("renders header, the | Part | table with the working row, scoreboard top-3, and completion line; rc 0", async () => {
    const h = home();
    const { o } = scaffold(h);
    const { rc, text } = await capture((stdout) => statusBriefWith([TOPIC], { opts: o, stdout }));
    expect(rc).toBe(0);
    expect(text).toContain("## Experiment status");
    expect(text).toContain("| Part | Phase | Current/last | Approach | Metric |");
    expect(text).not.toContain("| Trooper |");
    // working part row: phase working, approach from prompt.md, metric (running)
    expect(text).toContain("| viola | working | exp-001 | baseline | (running) |");
    // scoreboard top-3 line
    expect(text).toContain("1. viola/exp-001 — 0.9500 — accuracy");
    // completion line
    expect(text).toContain("**Completion check:** floor_met=");
  });

  it("--latest-instrument/--latest-exp name the just-landed experiment in the header", async () => {
    const h = home();
    const { o } = scaffold(h);
    const { rc, text } = await capture((stdout) =>
      statusBriefWith([TOPIC, "--latest-instrument", INST, "--latest-exp", "exp-001"], { opts: o, stdout }));
    expect(rc).toBe(0);
    expect(text).toContain("## Experiment status — exp-001 (viola) just landed");
  });

  it("non-working part: approach comes from result.json (wins over prompt.md), metric is '<value> <status>'", async () => {
    const h = home();
    const o = { home: h.home };
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "metric.md"), "# Research goal\n\n**Primary metric:** accuracy\n**Direction:** maximize\n");
    writeFileSync(join(art, "parts.txt"), INST + "\n");
    const sd = partStateDir(art, INST);
    mkdirSync(sd, { recursive: true });
    // Finished part: idle, current/last exp via current_exp_id.
    writeFileSync(join(sd, "state.txt"), "phase=idle\ncurrent_exp_id=exp-002\n");
    const expDir = experimentDir(art, INST, "exp-002");
    mkdirSync(expDir, { recursive: true });
    // prompt.md says "baseline"; result.json says "deep-net" -> result.json must win.
    writeFileSync(join(expDir, "prompt.md"), "  Approach label:  baseline\n");
    writeFileSync(join(expDir, "result.json"), JSON.stringify({
      branch_id: "b", approach_label: "deep-net", metric_name: "accuracy",
      metric_value: 0.9, status: "ok", runtime_s: 12, log_paths: [],
    }));
    const { rc, text } = await capture((stdout) => statusBriefWith([TOPIC], { opts: o, stdout }));
    expect(rc).toBe(0);
    // result.json's approach_label (deep-net) wins; prompt.md's baseline must NOT appear.
    expect(text).toContain("| viola | idle | exp-002 | deep-net | 0.9 ok |");
    expect(text).not.toContain("baseline");
  });

  it("metric.md absent -> completion line is the absent line (not an all-no row)", async () => {
    const h = home();
    const o = { home: h.home };
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    // scoreboard.md present but metric.md absent -> completion can't be computed.
    writeFileSync(join(art, "scoreboard.md"), [
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
      "| 1 | exp-001 | viola | 0.9500 | ok | 10.00s | baseline | accuracy |",
    ].join("\n") + "\n");
    writeFileSync(join(art, "parts.txt"), INST + "\n");
    const { rc, text } = await capture((stdout) => statusBriefWith([TOPIC], { opts: o, stdout }));
    expect(rc).toBe(0);
    expect(text).toContain("**Completion check:** _(scoreboard or metric absent)_");
    expect(text).not.toContain("floor_met=");
  });

  it("no topic -> rc 2", async () => {
    const h = home();
    const { rc } = await capture((stdout) => statusBriefWith([], { opts: { home: h.home }, stdout }));
    expect(rc).toBe(2);
  });
});

import { createHash } from "node:crypto";
import { verifyPlanWith, type VerifyPlanDeps } from "../src/commands/rehearsal.js";

describe("rehearsal verify-plan", () => {
  const baseResult = { metric_value: 0.9, verify: { kind: "rescore", command: "python s.py", inputs: ["./p.json"], metric_from: "marker" } };
  const manifestFor = (preds: string) => ({ command: "python s.py", hashes: { "./p.json": createHash("sha256").update(preds).digest("hex") } });

  function deps(over: Partial<VerifyPlanDeps>): { d: VerifyPlanDeps; rows: any[]; out: string[] } {
    const rows: any[] = []; const out: string[] = [];
    const d: VerifyPlanDeps = {
      readResult: () => baseResult,
      readManifest: () => manifestFor("PREDS"),
      readInput: () => "PREDS",
      writeRow: (_a, _i, _e, r) => { rows.push(r); },
      now: () => "T",
      stdout: (l) => out.push(l),
      ...over,
    };
    return { d, rows, out };
  }

  it("clean -> emits RUN_CMD, persists nothing", async () => {
    const { d, rows, out } = deps({});
    expect(await verifyPlanWith(["topic", "viola", "exp-001"], d)).toBe(0);
    expect(out.some((l) => l.startsWith("RUN_CMD=python s.py"))).toBe(true);
    expect(out.some((l) => l.startsWith("METRIC_FROM=marker"))).toBe(true);
    expect(rows).toHaveLength(0);
  });
  it("provenance change -> persists mismatch, no RUN_CMD", async () => {
    const { d, rows, out } = deps({ readInput: () => "TAMPERED" });
    await verifyPlanWith(["topic", "viola", "exp-001"], d);
    expect(rows[0]).toMatchObject({ verdict: "mismatch", reason: "provenance:./p.json" });
    expect(out.some((l) => l.startsWith("RUN_CMD"))).toBe(false);
  });
  it("rerun without --authorize-rerun -> pending", async () => {
    const { d, rows } = deps({ readResult: () => ({ metric_value: 1, verify: { kind: "rerun", command: "c" } }) });
    await verifyPlanWith(["topic", "viola", "exp-001"], d);
    expect(rows[0]).toMatchObject({ verdict: "pending", reason: "rerun-deferred" });
  });
  it("missing result -> rc 1", async () => {
    const { d } = deps({ readResult: () => null });
    expect(await verifyPlanWith(["topic", "viola", "exp-001"], d)).toBe(1);
  });
  it("bad arity -> rc 2", async () => {
    const { d } = deps({});
    expect(await verifyPlanWith(["topic", "viola"], d)).toBe(2);
  });
});

import { verifyCheckWith, type VerifyCheckDeps } from "../src/commands/rehearsal.js";

describe("rehearsal verify-check", () => {
  function deps(over: Partial<VerifyCheckDeps>): { d: VerifyCheckDeps; rows: any[]; out: string[] } {
    const rows: any[] = []; const out: string[] = [];
    const d: VerifyCheckDeps = {
      readResult: () => ({ metric_value: 0.9, verify: { kind: "rescore", command: "c", metric_from: "marker" } }),
      readMetricMd: () => "**Primary metric:** accuracy\n",
      readStdout: () => "VERIFY_METRIC=0.901\n",
      readJson: () => null,
      writeRow: (_a, _i, _e, r) => rows.push(r),
      now: () => "T",
      stdout: (l) => out.push(l),
      ...over,
    };
    return { d, rows, out };
  }
  it("recomputed within epsilon -> verified", async () => {
    const { d, rows } = deps({});
    expect(await verifyCheckWith(["topic", "viola", "exp-001", "--stdout-file", "/x"], d)).toBe(0);
    expect(rows[0]).toMatchObject({ verdict: "verified" });
  });
  it("beyond epsilon -> mismatch", async () => {
    const { d, rows } = deps({ readStdout: () => "VERIFY_METRIC=0.5\n" });
    await verifyCheckWith(["topic", "viola", "exp-001", "--stdout-file", "/x"], d);
    expect(rows[0].verdict).toBe("mismatch");
  });
  it("--run-failed -> mismatch rerun-failed", async () => {
    const { d, rows } = deps({});
    await verifyCheckWith(["topic", "viola", "exp-001", "--run-failed"], d);
    expect(rows[0]).toMatchObject({ verdict: "mismatch", reason: "rerun-failed" });
  });
  it("honors metric.md verify_epsilon", async () => {
    const { d, rows } = deps({ readMetricMd: () => "**Primary metric:** accuracy\n**verify_epsilon:** 0.2\n", readStdout: () => "VERIFY_METRIC=0.75\n" });
    await verifyCheckWith(["topic", "viola", "exp-001", "--stdout-file", "/x"], d);
    expect(rows[0].verdict).toBe("verified");
  });
  it("missing --stdout-file and no --run-failed -> rc 2", async () => {
    const { d } = deps({});
    expect(await verifyCheckWith(["topic", "viola", "exp-001"], d)).toBe(2);
  });
});

describe("experiment template verify contract", () => {
  it("instructs the part to emit a verify block + VERIFY_METRIC marker", () => {
    const tpl = readFileSync("config/prompt-templates/rehearsal/experiment.md", "utf8");
    expect(tpl).toContain("\"verify\"");
    expect(tpl).toContain("VERIFY_METRIC=");
    expect(tpl).toContain("rescore");
  });
});

describe("experiment template integrity attestation", () => {
  it("instructs the part to emit an integrity block", () => {
    const tpl = readFileSync("config/prompt-templates/rehearsal/experiment.md", "utf8");
    expect(tpl).toContain("\"integrity\"");
    expect(tpl).toContain("split_before_fit");
    expect(tpl).toContain("no_train_test_overlap");
  });
});
