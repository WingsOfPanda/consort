// tests/rehearsal-cmd.test.ts — rehearsal CLI verbs (Phase B).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { freshHome } from "./helpers/tmpHome.js";
import { initWith, type RehearsalInitDeps } from "../src/commands/rehearsal.js";
import { metricWith, sotaWith } from "../src/commands/rehearsal.js";
import { spawnAllWith, type SpawnAllDeps } from "../src/commands/rehearsal.js";
import { experimentSendWith, type ExperimentSendDeps } from "../src/commands/rehearsal.js";
import { scoreWith, liveScoreDeps } from "../src/commands/rehearsal.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rehearsalArtDir, partStateDir } from "../src/core/rehearsal.js";
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
  it("rc 2 when fewer than 2 instruments can be picked", async () => {
    const h = home();
    await initWith(["--slug", "s3", "spawn topic 3"], okDeps({ opts: { home: h.home, cwd: h.home } }));
    const rc = await spawnAllWith(["s3", "2"], deps({ pickInstruments: () => ["only1"] }), { home: h.home, cwd: h.home });
    expect(rc).toBe(2);
  });
  it("rc 2 when preflight omits a pane for some part (orphan guard)", async () => {
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
    expect(await spawnAllWith(["s4", "2"], d, { home: h.home, cwd: h.home })).toBe(2);
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
    // state transition
    const st = readFileSync(join(sd, "state.txt"), "utf8");
    expect(st).toContain("phase=working");
    expect(st).toContain("current_exp_id=exp-001");
    expect(st).toContain("exp_counter=1");
    expect(st).toContain("last_event=dispatched");
    void art; void o;
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
