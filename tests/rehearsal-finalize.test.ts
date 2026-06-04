import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { finalizePhase, parseHardConstraints } from "../src/core/rehearsalFinalize.js";
import { finalizeWith, type RehearsalFinalizeDeps } from "../src/commands/rehearsal.js";
import { rehearsalArtDir, partStateDir, experimentDir } from "../src/core/rehearsal.js";
import { partDir } from "../src/core/paths.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
function home() { const h = freshHome(); cleanups.push(h.cleanup); return h; }

// ---- PURE: finalizePhase ----
describe("finalizePhase", () => {
  it("working/stale/stuck/blocked -> incomplete", () => {
    for (const p of ["working", "stale", "stuck", "blocked"]) expect(finalizePhase(p)).toBe("incomplete");
  });
  it("idle/complete -> complete", () => {
    expect(finalizePhase("idle")).toBe("complete");
    expect(finalizePhase("complete")).toBe("complete");
  });
  it("failed/abandoned/unknown -> null (no write)", () => {
    expect(finalizePhase("failed")).toBeNull();
    expect(finalizePhase("abandoned")).toBeNull();
    expect(finalizePhase("")).toBeNull();
    expect(finalizePhase("whatever")).toBeNull();
  });
});

// ---- PURE: parseHardConstraints ----
describe("parseHardConstraints", () => {
  it("reads numeric k=v lines only inside the Hard constraints block, stops at blank line", () => {
    const md = [
      "# Experiment",
      "",
      "Prose mentioning mcts_sims=999 outside the block.",
      "",
      "**Hard constraints:**",
      "  epochs = 10",
      "  lr=0.001",
      "  batch_size = 64 extra-text-ignored",
      "",
      "  ignored = 5",
    ].join("\n");
    expect(parseHardConstraints(md)).toEqual([
      { key: "epochs", value: "10" },
      { key: "lr", value: "0.001" },
      { key: "batch_size", value: "64" },
    ]);
  });
  it("returns [] when the block header is absent", () => {
    expect(parseHardConstraints("no constraints here\nk=1\n")).toEqual([]);
  });
});

// ---- INTEGRATION ----
describe("rehearsal finalize", () => {
  const TOPIC = "fin-topic";
  const MODEL = "codex";
  const opts = (h: { home: string }) => ({ home: h.home, cwd: process.cwd() });
  const deps = (h: { home: string }, over: Partial<RehearsalFinalizeDeps> = {}): RehearsalFinalizeDeps => ({
    now: () => "2026-05-30T12:00:00Z",
    opts: opts(h),
    ...over,
  });

  /** Scaffold the art dir with parts.txt listing the given instruments. */
  function scaffoldArt(h: { home: string }, instruments: string[]) {
    const o = opts(h);
    const art = rehearsalArtDir(TOPIC, o);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), instruments.join("\n") + "\n");
    return { art, o };
  }

  /** Scaffold one part: its art-tree state.txt + a live pane dir (pane.json + outbox.jsonl). */
  function scaffoldPart(h: { home: string }, art: string, inst: string, stateKv: string, outbox = "") {
    const o = opts(h);
    const sd = partStateDir(art, inst);
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "state.txt"), stateKv);
    const pd = partDir(inst, MODEL, TOPIC, o);
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "pane.json"), JSON.stringify({ pane_id: "%1", instrument: inst, model: MODEL, spawned_at: "t" }));
    writeFileSync(join(pd, "outbox.jsonl"), outbox);
    return { sd, pd };
  }

  function writeResult(art: string, inst: string, expId: string, obj: Record<string, unknown>) {
    const ed = experimentDir(art, inst, expId);
    mkdirSync(ed, { recursive: true });
    writeFileSync(join(ed, "result.json"), JSON.stringify(obj));
    return ed;
  }

  it("rc 1 when art dir is missing", async () => {
    const h = home();
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(1);
  });

  it("working part with a terminal done event + a result.json -> reconciled to complete", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["violin"]);
    const outbox = '{"event":"done","summary":"ok","ts":"2026-05-30T11:00:00Z"}\n';
    scaffoldPart(h, art, "violin", "phase=working\ncurrent_exp_id=exp-001\n", outbox);
    writeResult(art, "violin", "exp-001", {
      branch_id: "exp-001", approach_label: "a", metric_name: "acc", metric_value: 0.9,
      status: "ok", runtime_s: 1, log_paths: [], checkpoint_path: null, notes: "",
    });
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    const st = readFileSync(join(partStateDir(art, "violin"), "state.txt"), "utf8");
    expect(st).toContain("phase=complete");
  });

  it("working part with NO terminal event -> incomplete", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["viola"]);
    scaffoldPart(h, art, "viola", "phase=working\ncurrent_exp_id=exp-001\n", "");
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    const st = readFileSync(join(partStateDir(art, "viola"), "state.txt"), "utf8");
    expect(st).toContain("phase=incomplete");
  });

  it("idle part -> complete", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["cello"]);
    scaffoldPart(h, art, "cello", "phase=idle\n", "");
    await finalizeWith([TOPIC], deps(h));
    const st = readFileSync(join(partStateDir(art, "cello"), "state.txt"), "utf8");
    expect(st).toContain("phase=complete");
  });

  it("ok+metric_value:null result.json -> rewritten to partial", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["oboe"]);
    scaffoldPart(h, art, "oboe", "phase=idle\n", "");
    writeResult(art, "oboe", "exp-001", {
      branch_id: "exp-001", approach_label: "a", metric_name: "acc", metric_value: null,
      status: "ok", runtime_s: 1, log_paths: [], checkpoint_path: null, notes: "",
    });
    await finalizeWith([TOPIC], deps(h));
    const r = JSON.parse(readFileSync(join(experimentDir(art, "oboe", "exp-001"), "result.json"), "utf8"));
    expect(r.status).toBe("partial");
  });

  it("structured halt.flag -> session-summary.md with ## Halt, reason, ## Status, no format= line", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["flute"]);
    scaffoldPart(h, art, "flute", "phase=idle\n", "");
    writeFileSync(join(art, "halt.flag"), "halted_by=maestro\nhalted_at=2026-05-30T11:00:00Z\nreason=converged\n");
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    const ss = readFileSync(join(art, "session-summary.md"), "utf8");
    expect(ss).toContain("## Halt");
    expect(ss).toContain("reason=converged");
    expect(ss).not.toContain("format=");
    expect(ss).toContain("## Status");
    expect(ss).toContain("| Part |");
  });

  it("prune removes other *.pt files, keeps checkpoint_path; --keep-intermediate keeps both", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["harp"]);
    scaffoldPart(h, art, "harp", "phase=idle\n", "");
    const ed = writeResult(art, "harp", "exp-001", {
      branch_id: "exp-001", approach_label: "a", metric_name: "acc", metric_value: 0.9,
      status: "ok", runtime_s: 1, log_paths: [], checkpoint_path: "model.pt", notes: "",
    });
    writeFileSync(join(ed, "model.pt"), "keep");
    writeFileSync(join(ed, "epoch1.pt"), "drop");
    await finalizeWith([TOPIC], deps(h));
    expect(existsSync(join(ed, "model.pt"))).toBe(true);
    expect(existsSync(join(ed, "epoch1.pt"))).toBe(false);

    // --keep-intermediate keeps both
    const h2 = home();
    const { art: art2 } = scaffoldArt(h2, ["harp"]);
    scaffoldPart(h2, art2, "harp", "phase=idle\n", "");
    const ed2 = writeResult(art2, "harp", "exp-001", {
      branch_id: "exp-001", approach_label: "a", metric_name: "acc", metric_value: 0.9,
      status: "ok", runtime_s: 1, log_paths: [], checkpoint_path: "model.pt", notes: "",
    });
    writeFileSync(join(ed2, "model.pt"), "keep");
    writeFileSync(join(ed2, "epoch1.pt"), "keep2");
    await finalizeWith(["--keep-intermediate", TOPIC], deps(h2, { keepIntermediate: undefined }));
    expect(existsSync(join(ed2, "model.pt"))).toBe(true);
    expect(existsSync(join(ed2, "epoch1.pt"))).toBe(true);
  });

  it("rc 0 on the happy path with a session-summary.md written", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["violin", "viola"]);
    scaffoldPart(h, art, "violin", "phase=idle\n", "");
    scaffoldPart(h, art, "viola", "phase=working\n", "");
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    expect(existsSync(join(art, "session-summary.md"))).toBe(true);
  });

  it("audit_warn appends after size (truncate) and coexists with size_warn", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["bassoon"]);
    scaffoldPart(h, art, "bassoon", "phase=idle\n", "");
    const ed = writeResult(art, "bassoon", "exp-001", {
      branch_id: "exp-001", approach_label: "a", metric_name: "acc", metric_value: 0.9,
      status: "ok", runtime_s: 1, log_paths: [], checkpoint_path: null, notes: "",
    });
    writeFileSync(join(ed, "prompt.md"), [
      "# Experiment", "", "**Hard constraints:**", "  max_params = 100000", "",
    ].join("\n"));
    writeFileSync(join(ed, "audit.json"), JSON.stringify({ max_params: 120000 }));
    // A bulky file forces a size_warn at the low threshold; result.json + prompt.md
    // + audit.json already count toward the depth-1 file_count.
    writeFileSync(join(ed, "big.bin"), Buffer.alloc(2048));

    // sizeWarnGb tiny so the exp dir trips the size threshold too.
    await finalizeWith([TOPIC], deps(h, { sizeWarnGb: 0.000001 }));

    const w = readFileSync(join(art, "warnings.txt"), "utf8");
    expect(w).toContain("audit_warn\tbassoon/exp-001\tmax_params\tprompt=100000  actual=120000");
    expect(w).toMatch(/^size_warn\tbassoon\/exp-001\t/m);
    // ordering: size row is written first (truncate), audit row appended after.
    expect(w.indexOf("size_warn")).toBeLessThan(w.indexOf("audit_warn"));
  });

  it("folds an improve-multi lineage row into warnings.txt (B2)", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["oboe"]);
    scaffoldPart(h, art, "oboe", "phase=idle\n", "");
    writeFileSync(join(art, "lineage.tsv"),
      "exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\n" +
      "exp-003\toboe\texp-002\t2\timprove-multi\tT\n");
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    const w = readFileSync(join(art, "warnings.txt"), "utf8");
    expect(w).toContain("lineage");
    expect(w).toContain("improve-multi");
    expect(w).toContain("oboe/exp-003");
  });

  it("failed part is preserved (not coerced) when no terminal event reconciles it", async () => {
    const h = home();
    const { art } = scaffoldArt(h, ["timpani"]);
    scaffoldPart(h, art, "timpani", "phase=failed\n", "");
    const rc = await finalizeWith([TOPIC], deps(h));
    expect(rc).toBe(0);
    const st = readFileSync(join(partStateDir(art, "timpani"), "state.txt"), "utf8");
    expect(st).toContain("phase=failed");
  });

  it("usage error (no positional) -> rc 2", async () => {
    const h = home();
    const rc = await finalizeWith([], deps(h));
    expect(rc).toBe(2);
  });
});
