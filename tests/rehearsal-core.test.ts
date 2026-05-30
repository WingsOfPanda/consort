// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";
import { extractMetric, METRIC_VOCAB } from "../src/core/rehearsalMetric.js";
import { formatMetricBlock, parseMetricMd } from "../src/core/rehearsalMetric.js";
import { formatSotaBlock } from "../src/core/rehearsalMetric.js";
import { validateResult, type ResultJson } from "../src/core/rehearsalResult.js";
import { renderScoreboardRow, buildScoreboard, type ScoreRow } from "../src/core/rehearsalResult.js";
import { normalizeResult } from "../src/core/rehearsalResult.js";

describe("rehearsal art-dir paths", () => {
  it("layers _rehearsal/parts/<instrument>/experiments/<exp-id>", () => {
    const art = rehearsalArtDir("add-oauth");
    expect(art.endsWith("/_rehearsal")).toBe(true);
    expect(partsDir(art)).toBe(`${art}/parts`);
    expect(partStateDir(art, "oboe")).toBe(`${art}/parts/oboe`);
    expect(experimentsDir(art, "oboe")).toBe(`${art}/parts/oboe/experiments`);
    expect(experimentDir(art, "oboe", "exp-001")).toBe(`${art}/parts/oboe/experiments/exp-001`);
  });
});

describe("extractMetric", () => {
  it("returns the earliest-positioned vocab word, whole-word only", () => {
    expect(extractMetric("maximize accuracy under 100k params")).toBe("accuracy");
    expect(extractMetric("minimize loss then improve accuracy")).toBe("loss");
    expect(extractMetric("Reduce LATENCY p99")).toBe("latency"); // case-insensitive
  });
  it("does not match substrings inside larger words", () => {
    expect(extractMetric("inaccuracybenchmark")).toBe(""); // no whole-word hit
    expect(extractMetric("flossing")).toBe("");             // 'loss' is a substring only
  });
  it("returns empty string when no vocab word is present", () => {
    expect(extractMetric("build a faster widget")).toBe("");
    expect(extractMetric("")).toBe("");
  });
  it("exposes the canonical vocabulary", () => {
    expect(METRIC_VOCAB).toContain("accuracy");
    expect(METRIC_VOCAB).toContain("throughput");
    expect(METRIC_VOCAB).toHaveLength(11);
  });
  it("ranks by first substring occurrence under a whole-word gate (faithful to extract_metric)", () => {
    // 'cost' is eligible (whole-word at end) and its substring in 'costly' sits at pos 0,
    // beating 'auc' whose whole-word hit is later.
    expect(extractMetric("costly auc then cost")).toBe("cost");
    // 'accuracy' eligible (whole-word at end), substring in 'accuracyx' is earliest.
    expect(extractMetric("accuracyx loss accuracy")).toBe("accuracy");
  });
});

describe("formatMetricBlock", () => {
  it("renders required + defaulted fields", () => {
    const md = formatMetricBlock({
      primary_metric: "accuracy", direction: "maximize",
      min_acceptable: ">= 0.95", target: ">= 0.99",
    });
    expect(md).toContain("**Primary metric:** accuracy");
    expect(md).toContain("**Direction:** maximize");
    expect(md).toContain("**min_acceptable:** >= 0.95");
    expect(md).toContain("**target:** >= 0.99");
    expect(md).toContain("**K_corroboration:** 1");       // default
    expect(md).toContain("**plateau_window:** 5");        // default
    expect(md).toContain("**plateau_threshold:** 0.01");  // default
  });
  it("defaults min_acceptable to (not set) and omits absent optionals", () => {
    const md = formatMetricBlock({ primary_metric: "loss", direction: "minimize" });
    expect(md).toContain("**min_acceptable:** (not set)");
    expect(md).not.toContain("**target:**");
    expect(md).not.toContain("**Hard constraints:**");
  });
  it("throws on missing primary_metric / direction or bad direction", () => {
    expect(() => formatMetricBlock({ direction: "maximize" })).toThrow(/primary_metric/);
    expect(() => formatMetricBlock({ primary_metric: "auc" })).toThrow(/direction/);
    expect(() => formatMetricBlock({ primary_metric: "auc", direction: "sideways" })).toThrow(/maximize/);
  });
});

describe("parseMetricMd round-trips formatMetricBlock", () => {
  it("recovers ops, values, and thresholds", () => {
    const md = formatMetricBlock({
      primary_metric: "accuracy", direction: "maximize",
      min_acceptable: ">= 0.95", target: ">= 0.99",
      K_corroboration: "3", plateau_window: "4", plateau_threshold: "0.005",
    });
    const t = parseMetricMd(md);
    expect(t.primaryMetric).toBe("accuracy");
    expect(t.minOp).toBe(">="); expect(t.minVal).toBe("0.95");
    expect(t.tgtOp).toBe(">="); expect(t.tgtVal).toBe("0.99");
    expect(t.kRequired).toBe(3);
    expect(t.plateauWindow).toBe(4);
    expect(t.plateauThreshold).toBe(0.005);
  });
  it("applies defaults when fields are absent", () => {
    const t = parseMetricMd("**Primary metric:** f1\n**Direction:** maximize\n");
    expect(t.kRequired).toBe(1);
    expect(t.plateauWindow).toBe(5);
    expect(t.plateauThreshold).toBe(0.01);
    expect(t.tgtOp).toBeUndefined();
  });
});

describe("formatSotaBlock", () => {
  it("renders header + a row per ref (cap 7)", () => {
    const refs = Array.from({ length: 9 }, (_, i) =>
      `family${i + 1}|0.9${i}|ok|src${i + 1}|note${i + 1}`);
    const md = formatSotaBlock({ topic: "mnist", metric: "accuracy", sweep_date: "2026-05-30", queries: "q1; q2", refs });
    expect(md).toContain("# SOTA reference — mnist");
    expect(md).toContain("> **Sweep date:** 2026-05-30");
    expect(md).toContain("> **Optimizing for:** accuracy");
    expect(md).toContain("> **Queries fired:** q1; q2");
    expect(md).toContain("| family1 | 0.90 | ok | src1 | note1 |");
    expect(md).toContain("| family7 |");
    expect(md).not.toContain("| family8 |"); // capped at 7
  });
  it("emits the fallback note when no refs render", () => {
    const md = formatSotaBlock({ topic: "x", metric: "loss", sweep_date: "2026-05-30", refs: [] });
    expect(md).toContain("sweep returned no usable references");
  });
  it("throws on missing required keys", () => {
    expect(() => formatSotaBlock({ topic: "", metric: "loss", sweep_date: "d", refs: [] })).toThrow(/topic/);
    expect(() => formatSotaBlock({ topic: "x", metric: "", sweep_date: "d", refs: [] })).toThrow(/metric/);
    expect(() => formatSotaBlock({ topic: "x", metric: "loss", sweep_date: "", refs: [] })).toThrow(/sweep_date/);
  });
});

const okResult: ResultJson = {
  branch_id: "b1", approach_label: "cnn", metric_name: "accuracy",
  metric_value: 0.98, status: "ok", runtime_s: 12.5,
  log_paths: ["./stdout.log", "./stderr.log"],
  checkpoint_path: null, notes: "fine",
  self_reported_count: 1, self_reported_ratio: 0.98, self_reported_notes: "",
};

describe("validateResult", () => {
  const allExist = () => true;
  it("accepts a well-formed ok result", () => {
    expect(validateResult(okResult, { logPathExists: allExist })).toEqual({ ok: true });
  });
  it("rejects a missing required field", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional field-omission discard
    const { approach_label: _omit, ...bad } = okResult;
    expect(validateResult(bad, { logPathExists: allExist })).toMatchObject({ ok: false });
  });
  it("rejects an invalid status enum", () => {
    expect(validateResult({ ...okResult, status: "weird" }, { logPathExists: allExist }))
      .toMatchObject({ ok: false });
  });
  it("enforces metric_value non-null IFF status=ok", () => {
    expect(validateResult({ ...okResult, metric_value: null }, { logPathExists: allExist }))
      .toMatchObject({ ok: false }); // ok + null
    expect(validateResult({ ...okResult, status: "fail", metric_value: 0.5 }, { logPathExists: allExist }))
      .toMatchObject({ ok: false }); // non-ok + non-null
    expect(validateResult({ ...okResult, status: "fail", metric_value: null }, { logPathExists: allExist }))
      .toEqual({ ok: true });       // non-ok + null is valid
  });
  it("rejects a missing log_path on disk", () => {
    const onlyStdout = (p: string) => p === "./stdout.log";
    expect(validateResult(okResult, { logPathExists: onlyStdout })).toMatchObject({ ok: false });
  });
  it("enforces metric_name match when expectedMetric is given", () => {
    expect(validateResult(okResult, { logPathExists: allExist, expectedMetric: "auc" }))
      .toMatchObject({ ok: false });
    expect(validateResult(okResult, { logPathExists: allExist, expectedMetric: "accuracy" }))
      .toEqual({ ok: true });
  });
});

describe("renderScoreboardRow", () => {
  it("formats numeric metric (%.4f) and runtime (%.2fs)", () => {
    expect(renderScoreboardRow("0.985", "12.5", "accuracy", "ok", "cnn"))
      .toBe("0.9850 | ok | 12.50s | cnn | accuracy");
  });
  it("passes non-numeric metric (n/a) through verbatim", () => {
    expect(renderScoreboardRow("n/a", "3", "accuracy", "fail", "mlp"))
      .toBe("n/a | fail | 3.00s | mlp | accuracy");
  });
});

describe("buildScoreboard", () => {
  const rows: ScoreRow[] = [
    { expId: "exp-001", instrument: "oboe",  metric: "0.90", status: "ok",      runtime: "10", approach: "a", metricName: "accuracy" },
    { expId: "exp-002", instrument: "viola", metric: "0.95", status: "ok",      runtime: "20", approach: "b", metricName: "accuracy" },
    { expId: "exp-003", instrument: "oboe",  metric: "0.95", status: "ok",      runtime: "5",  approach: "c", metricName: "accuracy" },
    { expId: "exp-004", instrument: "viola", metric: "",     status: "fail",    runtime: "2",  approach: "d", metricName: "accuracy" },
    { expId: "exp-005", instrument: "oboe",  metric: "",     status: "partial", runtime: "1",  approach: "e", metricName: "accuracy" },
  ];
  it("orders ok rows metric-desc, then runtime-asc, then exp-id; ranks continue into fails", () => {
    const sb = buildScoreboard(rows);
    const lines = sb.split("\n").filter((l) => /^\| /.test(l) && !/Rank|---/.test(l));
    // exp-003 (0.95,5s) and exp-002 (0.95,20s) tie on metric -> runtime asc puts exp-003 first.
    expect(lines[0]).toContain("| 1 | exp-003 | oboe |");
    expect(lines[1]).toContain("| 2 | exp-002 | viola |");
    expect(lines[2]).toContain("| 3 | exp-001 | oboe |");
    // fails sorted by exp-id; partial gets ~ prefix; rank counter continues.
    expect(lines[3]).toContain("| 4 | exp-004 | viola |");   // plain fail
    expect(lines[4]).toContain("| ~5 | exp-005 | oboe |");   // partial
    expect(lines[3]).toContain("n/a | fail");
  });
  it("emits the schema header and 8-column table", () => {
    const sb = buildScoreboard(rows);
    expect(sb).toContain("<!-- scoreboard schema_version=2 -->");
    expect(sb).toContain("| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |");
  });
});

describe("normalizeResult", () => {
  const base = {
    branch_id: "b", approach_label: "a", metric_name: "accuracy",
    runtime_s: 1, log_paths: [], checkpoint_path: null, notes: "",
  };
  it("ok + null metric -> partial", () => {
    const out = normalizeResult({ ...base, status: "ok", metric_value: null });
    expect(out.status).toBe("partial");
  });
  it("fail + self_reported_ratio -> partial, promotes ratio into null metric_value", () => {
    const out = normalizeResult({ ...base, status: "fail", metric_value: null, self_reported_ratio: 0.42 });
    expect(out.status).toBe("partial");
    expect(out.metric_value).toBe(0.42);
  });
  it("fail + ratio: promotes only when metric_value was null; timeout is never promoted", () => {
    const out = normalizeResult({ ...base, status: "fail", metric_value: null, self_reported_ratio: 0.42 });
    expect(out.metric_value).toBe(0.42);
    const out2 = normalizeResult({ ...base, status: "timeout", metric_value: null, self_reported_ratio: 0.9 });
    expect(out2.status).toBe("timeout"); // only fail (not timeout) is promoted
  });
  it("fail + ratio leaves an existing metric_value untouched", () => {
    const out = normalizeResult({ ...base, status: "fail", metric_value: 0.7, self_reported_ratio: 0.42 });
    expect(out.status).toBe("partial");
    expect(out.metric_value).toBe(0.7); // not overwritten by the ratio
  });
  it("is idempotent (re-normalizing a normalized result is a no-op)", () => {
    const once = normalizeResult({ ...base, status: "ok", metric_value: null });
    // a 'partial' status falls through both branches unchanged
    expect(normalizeResult(once as unknown as Parameters<typeof normalizeResult>[0])).toEqual(once);
  });
  it("leaves a clean ok result unchanged", () => {
    const r = { ...base, status: "ok" as const, metric_value: 0.99 };
    expect(normalizeResult(r)).toEqual(r);
  });
});

import { checkCompletion } from "../src/core/rehearsalComplete.js";

const metricMd = formatMetricBlock({
  primary_metric: "accuracy", direction: "maximize",
  min_acceptable: ">= 0.90", target: ">= 0.95",
  K_corroboration: "2", plateau_window: "3", plateau_threshold: "0.01",
});

function row(expId: string, instrument: string, metric: string, status = "ok", runtime = "1"): ScoreRow {
  return { expId, instrument, metric, status, runtime, approach: "a", metricName: "accuracy" };
}

describe("checkCompletion", () => {
  it("reports floor + target met", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.92"), row("exp-002", "oboe", "0.96")]);
    const c = checkCompletion(sb, metricMd);
    expect(c.floorMet).toBe(true);
    expect(c.targetMet).toBe(true);
    expect(c.kRequired).toBe(2);
  });
  it("does not meet floor when all metrics are below min_acceptable", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.80"), row("exp-002", "oboe", "0.85")]);
    expect(checkCompletion(sb, metricMd).floorMet).toBe(false);
  });
  it("counts a per-part strictly-improving at-target streak", () => {
    // oboe: 0.95, 0.96, 0.97 (all >= target, strictly improving) -> chain 3, capped at K=2.
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "0.96"), row("exp-003", "oboe", "0.97"),
    ]);
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(2);
  });
  it("a non-improving (plateau) result breaks the streak", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "0.95"), row("exp-003", "oboe", "0.96"),
    ]);
    // chains: [0.95] (Δ=0 breaks) then [0.96] -> longest = 1.
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(1);
  });
  it("a mid-chain fail breaks the streak", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "", "fail"), row("exp-003", "oboe", "0.96"),
    ]);
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(1);
  });
  it("flags plateau when the last window of ok metrics is tight", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.951"), row("exp-002", "oboe", "0.952"), row("exp-003", "oboe", "0.953"),
    ]);
    // 3 ok rows, spread 0.002 < 0.01 -> plateau.
    expect(checkCompletion(sb, metricMd).plateau).toBe(true);
  });
  it("no plateau when fewer than plateau_window ok rows", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.951"), row("exp-002", "oboe", "0.952")]);
    expect(checkCompletion(sb, metricMd).plateau).toBe(false);
  });
});

import { checkTimeBudget } from "../src/core/rehearsalComplete.js";

describe("checkTimeBudget", () => {
  const start = "2026-05-30T00:00:00Z";
  const startEpoch = Math.floor(Date.parse(start) / 1000);
  it("returns false for budget 'none'", () => {
    expect(checkTimeBudget("none", start, startEpoch + 999_999)).toBe(false);
  });
  it("true once elapsed >= budget, false before", () => {
    expect(checkTimeBudget("3600", start, startEpoch + 3599)).toBe(false);
    expect(checkTimeBudget("3600", start, startEpoch + 3600)).toBe(true);
  });
  it("tolerates surrounding whitespace", () => {
    expect(checkTimeBudget("  3600 ", " 2026-05-30T00:00:00Z ", startEpoch + 3600)).toBe(true);
  });
  it("throws on malformed budget or unparseable start", () => {
    expect(() => checkTimeBudget("-5", start, startEpoch)).toThrow();
    expect(() => checkTimeBudget("abc", start, startEpoch)).toThrow();
    expect(() => checkTimeBudget("3600", "not-a-date", startEpoch)).toThrow();
  });
});

import { buildConsensus } from "../src/core/rehearsalConsensus.js";

describe("buildConsensus", () => {
  const nowIso = "2026-05-30T12:00:00Z";
  it("agrees on identical fields and ε-close metric_value; contests divergence", () => {
    const md = buildConsensus({
      oboe:  { branch_id: "b", approach_label: "cnn", metric_name: "accuracy", metric_value: 0.980, status: "ok", runtime_s: 10, notes: "n" },
      viola: { branch_id: "b", approach_label: "mlp", metric_name: "accuracy", metric_value: 0.985, status: "ok", runtime_s: 12, notes: "n" },
    }, { topic: "mnist", nowIso, epsilon: 0.01 });
    expect(md).toContain("## Agreed");
    expect(md).toContain("| metric_name | accuracy | oboe, viola |");
    expect(md).toContain("| metric_value | 0.98 | oboe, viola |"); // 0.980 vs 0.985 within ε
    expect(md).toContain("## Contested");
    expect(md).toMatch(/\| approach_label \| cnn \| mlp \|/);       // diverge -> contested
  });
  it("buckets a field missing from every part as All-missing", () => {
    const md = buildConsensus({
      oboe:  { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
      viola: { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
    }, { topic: "t", nowIso });
    expect(md).toContain("## All-missing");
    expect(md).toContain("- notes");
    expect(md).toContain("- branch_id");
  });
  it("contests a field present in some parts but missing in others", () => {
    const md = buildConsensus({
      oboe:  { notes: "had a note", metric_name: "accuracy", metric_value: 0.9, status: "ok" },
      viola: { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
    }, { topic: "t", nowIso });
    // notes present in oboe, missing in viola -> contested (— for the missing cell), not All-missing.
    expect(md).toMatch(/\| notes \| had a note \| — \|/);
  });
});

import {
  parseState, renderState, mergeState, reconcileFromOutbox, readHaltFlag,
} from "../src/core/rehearsalState.js";

describe("state KV round-trip", () => {
  it("parses and renders KV, preserving '=' in values and escaping newlines", () => {
    const txt = renderState({ phase: "working", current_exp_id: "exp-003", note: "a=b\nsecond" });
    expect(txt).toContain("phase=working");
    expect(txt).toContain("note=a=b\\nsecond"); // newline escaped to literal \n
    const kv = parseState(txt);
    expect(kv.phase).toBe("working");
    expect(kv.note).toBe("a=b\nsecond");        // round-trips back to a real newline
  });
});

describe("mergeState", () => {
  it("overwrites touched keys, keeps the rest", () => {
    const existing = renderState({ exp_counter: "2", phase: "working", current_exp_id: "exp-002" });
    const merged = parseState(mergeState(existing, { phase: "idle" }));
    expect(merged.phase).toBe("idle");
    expect(merged.exp_counter).toBe("2");
    expect(merged.current_exp_id).toBe("exp-002");
  });
  it("creates fresh state when none exists", () => {
    const merged = parseState(mergeState(null, { phase: "idle", exp_counter: "0" }));
    expect(merged.phase).toBe("idle");
  });
});

describe("reconcileFromOutbox", () => {
  it("error anywhere in the tail wins -> failed", () => {
    const tail = '{"event":"done","ts":"t"}\n{"event":"error","ts":"t"}';
    expect(reconcileFromOutbox(tail, true)).toBe("failed");
  });
  it("terminal done with result present -> idle", () => {
    expect(reconcileFromOutbox('{"event":"progress"}\n{"event":"done"}', true)).toBe("idle");
  });
  it("done without result present -> no write", () => {
    expect(reconcileFromOutbox('{"event":"done"}', false)).toBeNull();
  });
  it("no terminal event -> no write", () => {
    expect(reconcileFromOutbox('{"event":"progress"}\n{"event":"heartbeat"}', true)).toBeNull();
  });
});

describe("readHaltFlag", () => {
  it("missing on null / empty", () => {
    expect(readHaltFlag(null).format).toBe("missing");
    expect(readHaltFlag("   ").format).toBe("missing");
  });
  it("structured when the first non-blank line is halted_by=", () => {
    const h = readHaltFlag("halted_by=maestro\nhalted_at=t\nreason=target met\ntarget_met=yes");
    expect(h.format).toBe("structured");
    expect(h.fields?.halted_by).toBe("maestro");
    expect(h.fields?.target_met).toBe("yes");
  });
  it("prose otherwise, collapsing newlines into the reason", () => {
    const h = readHaltFlag("stopped because\nthe user said so");
    expect(h.format).toBe("prose");
    expect(h.reason).toBe("stopped because the user said so");
  });
});
