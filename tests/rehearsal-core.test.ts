// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";
import { extractMetric, METRIC_VOCAB } from "../src/core/rehearsalMetric.js";
import { formatMetricBlock, parseMetricMd } from "../src/core/rehearsalMetric.js";
import { formatSotaBlock } from "../src/core/rehearsalMetric.js";
import { validateResult, type ResultJson } from "../src/core/rehearsalResult.js";
import { renderScoreboardRow, buildScoreboard, type ScoreRow } from "../src/core/rehearsalResult.js";
import { normalizeResult } from "../src/core/rehearsalResult.js";
import { buildStatusBrief } from "../src/core/rehearsalBrief.js";
import type { CompletionSignals } from "../src/core/rehearsalComplete.js";

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
import {
  renderExperimentPrompt, buildSotaBlock, assembleHardwareBlock, hardwareDiffAlert,
  formatPeersBlock, buildDispatchState, EXP_ID_RE, INSTRUMENT_RE, type PeerRow,
} from "../src/core/rehearsalExperiment.js";

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
  it("treats a degenerate numeric token as 0 (awk parity) -> Agreed, not Contested", () => {
    const out = buildConsensus(
      { rex: { runtime_s: "-" }, keeli: { runtime_s: "0" } },
      { topic: "t", nowIso: "2026-06-03T00:00:00Z" },
    );
    const agreed = out.slice(out.indexOf("## Agreed"), out.indexOf("## Contested"));
    expect(agreed).toContain("runtime_s");
  });
});

import {
  parseState, renderState, mergeState, reconcileFromOutbox, readHaltFlag,
} from "../src/core/rehearsalState.js";
import { buildResultsTsv, computeScore, type ScoreFs } from "../src/core/rehearsalScore.js";
import { initScanState, monitorScan, type MonitorScanState, type MonitorDeps } from "../src/core/rehearsalMonitor.js";

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

describe("rehearsalExperiment", () => {
  it("EXP_ID_RE / INSTRUMENT_RE match the bash regexes", () => {
    expect(EXP_ID_RE.test("exp-001")).toBe(true);
    expect(EXP_ID_RE.test("exp-7")).toBe(true);
    expect(EXP_ID_RE.test("exp-")).toBe(false);
    expect(EXP_ID_RE.test("exp001")).toBe(false);
    expect(INSTRUMENT_RE.test("violin")).toBe(true);
    expect(INSTRUMENT_RE.test("french-horn")).toBe(true);
    expect(INSTRUMENT_RE.test("Violin")).toBe(false);
    expect(INSTRUMENT_RE.test("1st")).toBe(false);
  });

  it("renderExperimentPrompt substitutes all 14 tokens literally", () => {
    const tpl = "M={{METRIC_BLOCK}} H={{HARDWARE_BLOCK}} O={{OUTBOX_PATH}} T={{TOPIC}} " +
      "E={{EXP_ID}} L={{APPROACH_LABEL}} B={{APPROACH_BRIEF}} D={{BRANCH_DIR}} " +
      "N={{METRIC_NAME}} S={{TIME_BUDGET_S}} C={{TASK_CONTEXT}} W={{SOTA_BLOCK}} P={{PEERS_BLOCK}} A={{ART_DIR}}";
    const out = renderExperimentPrompt(tpl, {
      metricBlock: "mb", hardwareBlock: "hb", outboxPath: "/o", topicText: "topic",
      expId: "exp-001", approachLabel: "lab", approachBrief: "brief", branchDir: "/bd",
      metricName: "accuracy", timeBudgetS: "1800", taskContext: "", sotaBlock: "", peersBlock: "", artDir: "/a",
    });
    expect(out).toBe("M=mb H=hb O=/o T=topic E=exp-001 L=lab B=brief D=/bd N=accuracy S=1800 C= W= P= A=/a");
  });

  it("renderExperimentPrompt treats $-sequences in values as literal", () => {
    const out = renderExperimentPrompt("x={{TOPIC}}", { ...zeroFields(), topicText: "$1 & $& done" });
    expect(out).toBe("x=$1 & $& done");
  });

  it("renderExperimentPrompt throws if an unrendered {{TOKEN}} remains", () => {
    expect(() => renderExperimentPrompt("a {{UNKNOWN}} b", zeroFields())).toThrow(/unrendered/i);
  });

  it("buildSotaBlock empty when null/empty, wrapped otherwise", () => {
    expect(buildSotaBlock(null)).toBe("");
    expect(buildSotaBlock("")).toBe("");
    const b = buildSotaBlock("ref content");
    expect(b.startsWith("## Reference: SOTA\n\nref content")).toBe(true);
    expect(b).toContain("### Web search affordance");
    expect(b).toContain("## Sources consulted");
  });

  it("assembleHardwareBlock appends alert only when non-empty", () => {
    expect(assembleHardwareBlock("no-gpu", "")).toBe("no-gpu");
    expect(assembleHardwareBlock("gpu...", "ALERT: x")).toBe("gpu...\nALERT: x");
  });

  it("hardwareDiffAlert flags >50% free-memory drop per gpu", () => {
    const base = "detected_at\t2026\ngpu\tA100\t80000\t40000\tdrv";
    const cur  = "detected_at\t2026\ngpu\tA100\t80000\t10000\tdrv";   // 40000 -> 10000 = -75%
    const a = hardwareDiffAlert(base, cur);
    expect(a).toMatch(/ALERT: gpu 'A100' memory\.free 40000 -> 10000 MiB \(-75%\)/);
    expect(hardwareDiffAlert(base, base)).toBe("");        // no change
    expect(hardwareDiffAlert(null, cur)).toBe("");          // no baseline -> no alert
  });

  it("hardwareDiffAlert gates on raw ratio (>50% drop) and truncates the percentage", () => {
    // 10000 -> 4951 is a 50.49% drop: bash fires, reports truncated -50%
    const a = hardwareDiffAlert("gpu\tA100\t80000\t10000\tdrv", "gpu\tA100\t80000\t4951\tdrv");
    expect(a).toBe("ALERT: gpu 'A100' memory.free 10000 -> 4951 MiB (-50%)");
    // exactly 50% drop (10000 -> 5000) does NOT fire (strict raw ratio: cur < b*0.5)
    expect(hardwareDiffAlert("gpu\tA100\t80000\t10000\tdrv", "gpu\tA100\t80000\t5000\tdrv")).toBe("");
  });

  it("formatPeersBlock empty for zero peers, else a ## Peers table", () => {
    expect(formatPeersBlock([])).toBe("");
    const peers: PeerRow[] = [{ instrument: "viola", phase: "working", currentExp: "exp-003",
      approach: "deep-net", metric: "0.91", status: "ok", notes: "n" }];
    const b = formatPeersBlock(peers);
    expect(b).toContain("## Peers");
    expect(b).toContain("| Part | Phase | Current/last | Approach | Best metric | Notes |");
    expect(b).toContain("| viola | working | exp-003 | deep-net | 0.91 (ok) | n |");
    expect(b).not.toMatch(/trooper/i);
  });

  it("buildDispatchState transitions phase->working, bumps counter, stamps event", () => {
    const prev = "exp_counter=2\nphase=idle\ncurrent_exp_id=\nlast_event=spawn\n";
    const next = buildDispatchState(prev, "exp-003", "2026-05-30T10:00:00Z");
    const kv = Object.fromEntries(next.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    expect(kv.phase).toBe("working");
    expect(kv.current_exp_id).toBe("exp-003");
    expect(kv.exp_counter).toBe("3");
    expect(kv.last_event).toBe("dispatched");
    expect(kv.last_event_ts).toBe("2026-05-30T10:00:00Z");
  });

  it("buildDispatchState defaults a non-numeric counter to 0 -> 1", () => {
    const next = buildDispatchState("phase=idle\n", "exp-001", "T");
    expect(next).toMatch(/exp_counter=1/);
  });
});

function zeroFields() {
  return { metricBlock: "", hardwareBlock: "", outboxPath: "", topicText: "", expId: "",
    approachLabel: "", approachBrief: "", branchDir: "", metricName: "", timeBudgetS: "",
    taskContext: "", sotaBlock: "", peersBlock: "", artDir: "" };
}

describe("rehearsal experiment template", () => {
  const tpl = readFileSync(join(__dirname, "..", "config", "prompt-templates", "rehearsal", "experiment.md"), "utf8");

  it("contains all 14 placeholders and no stale clone-wars terms", () => {
    for (const t of ["METRIC_BLOCK","HARDWARE_BLOCK","OUTBOX_PATH","TOPIC","EXP_ID","APPROACH_LABEL",
      "APPROACH_BRIEF","BRANCH_DIR","METRIC_NAME","TIME_BUDGET_S","TASK_CONTEXT","SOTA_BLOCK","PEERS_BLOCK","ART_DIR"]) {
      expect(tpl).toContain(`{{${t}}}`);
    }
    expect(tpl).not.toMatch(/trooper|commander|master[- ]?yoda|\byoda\b|clone-wars/i);
  });

  it("preserves the frozen result.json schema keys in order", () => {
    const keys = ["branch_id","approach_label","metric_name","metric_value","status","runtime_s",
      "log_paths","checkpoint_path","notes","self_reported_count","self_reported_ratio","self_reported_notes"];
    let last = -1;
    for (const k of keys) { const i = tpl.indexOf(`"${k}"`); expect(i).toBeGreaterThan(last); last = i; }
  });

  it("keeps the frozen done + heartbeat event shapes and does NOT end with END_OF_INSTRUCTION", () => {
    expect(tpl).toContain('"event":"done"');
    expect(tpl).toContain('"event":"heartbeat"');
    expect(tpl.trimEnd().endsWith("END_OF_INSTRUCTION")).toBe(false);
  });

  it("renders with zero leftover placeholders", () => {
    const out = renderExperimentPrompt(tpl, {
      metricBlock: "MB", hardwareBlock: "HB", outboxPath: "/o.jsonl", topicText: "the topic",
      expId: "exp-001", approachLabel: "baseline", approachBrief: "do the thing", branchDir: "/bd",
      metricName: "accuracy", timeBudgetS: "1800", taskContext: "", sotaBlock: "", peersBlock: "", artDir: "/a",
    });
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe("rehearsalScore", () => {
  it("buildResultsTsv header is the frozen 7-col shape with 'instrument' col1", () => {
    expect(buildResultsTsv([])).toBe("exp_id\tinstrument\tapproach\tmetric\tstatus\truntime_s\tmetric_name\n");
  });

  it("buildResultsTsv appends rows in given order (approach col3, metric col4)", () => {
    const tsv = buildResultsTsv([
      { expId: "exp-001", instrument: "viola", approach: "base", metric: "0.9", status: "ok", runtime: "12", metricName: "accuracy" },
    ]);
    expect(tsv).toBe("exp_id\tinstrument\tapproach\tmetric\tstatus\truntime_s\tmetric_name\n" +
      "exp-001\tviola\tbase\t0.9\tok\t12\taccuracy\n");
  });

  it("computeScore validates, sorts, race-guards phase clear", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "phase=working\ncurrent_exp_id=exp-001\n",
      "/a/parts/cello/state.txt": "phase=working\ncurrent_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"base",metric_name:"accuracy",metric_value:0.95,status:"ok",
        runtime_s:12,log_paths:[],checkpoint_path:null,notes:"" }),
      "/a/parts/cello/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"deep",metric_name:"accuracy",metric_value:0.90,status:"ok",
        runtime_s:20,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "2026-05-30T00:00:00Z");
    expect(c.scoreboardMd).toContain("| 1 | exp-001 | viola |");
    expect(c.scoreboardMd).toContain("| 2 | exp-001 | cello |");
    expect(c.resultsTsv.split("\n")[1]).toContain("cello");   // walk order ascending: cello before viola
    expect(c.phaseClears.map((p) => p.statePath).sort()).toEqual([
      "/a/parts/cello/state.txt", "/a/parts/viola/state.txt"]);
    expect(c.phaseClears[0].merged).toMatch(/phase=idle/);
    expect(c.phaseClears[0].merged).toMatch(/current_exp_id=\n|current_exp_id=$/m);
  });

  it("computeScore rejects a bad metric_name -> sidecar, omits from scoreboard+tsv, no throw", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"loss",metric_value:0.1,status:"ok",
        runtime_s:1,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.sidecars).toHaveLength(1);
    expect(c.sidecars[0].path).toBe("/a/parts/viola/experiments/exp-001/result-validation.txt");
    expect(c.sidecars[0].body).toMatch(/^FAILED at T: metric_name 'loss' != /);
    expect(c.scoreboardMd).not.toContain("exp-001");
    expect(c.resultsTsv.split("\n").filter(Boolean)).toHaveLength(1);   // header only
    expect(c.warnings).toHaveLength(1);
  });

  it("computeScore does NOT clear phase for a part whose current_exp_id has no result.json (race guard)", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "phase=working\ncurrent_exp_id=exp-002\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.9,status:"ok",
        runtime_s:1,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.phaseClears).toHaveLength(0);
  });

  it("computeScore removes a stale sidecar when a result becomes valid", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.9,status:"ok",
        runtime_s:1,log_paths:[],checkpoint_path:null,notes:"" }),
      "/a/parts/viola/experiments/exp-001/result-validation.txt": "FAILED at old: x\n",
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.staleSidecars).toEqual(["/a/parts/viola/experiments/exp-001/result-validation.txt"]);
  });

  it("computeScore routes a non-ok (fail) result to the scoreboard FAIL group + tsv", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"flop",metric_name:"accuracy",metric_value:null,status:"fail",
        runtime_s:5,log_paths:[],checkpoint_path:null,notes:"broke" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    // valid (status=fail requires null metric_value, which it has) -> appears, in the FAIL group with n/a metric
    expect(c.scoreboardMd).toContain("exp-001");
    expect(c.scoreboardMd).toContain("fail");
    expect(c.scoreboardMd).toContain("n/a");
    // tsv row: metric cell empty (str(null)=""), status=fail
    const row = c.resultsTsv.split("\n").find((l) => l.startsWith("exp-001"));
    expect(row).toBe("exp-001\tviola\tflop\t\tfail\t5\taccuracy");
    // a fail's current_exp_id has a result.json on disk -> phase still cleared (race-guard is result-presence, not status)
    expect(c.phaseClears).toHaveLength(1);
  });
});

function fakeFs(files: Record<string, string>): ScoreFs {
  const has = (p: string): boolean => p in files;
  const dirsUnder = (p: string): string[] => {
    const pre = p.endsWith("/") ? p : p + "/";
    const set = new Set<string>();
    for (const k of Object.keys(files)) if (k.startsWith(pre)) set.add(k.slice(pre.length).split("/")[0]);
    return [...set].sort();
  };
  return { exists: has, read: (p) => (p in files ? files[p] : null), listDir: (p) => dirsUnder(p) };
}

describe("rehearsalMonitor", () => {
  const TH = { probeS: 900, stuckS: 1800, rescanEveryS: 30 };
  const mkDeps = (over: Partial<MonitorDeps>): MonitorDeps => ({
    outboxText: "", outboxFullText: "", outboxSize: 0, outboxMtime: 0, phase: "working",
    now: 1000, nowIso: "T", thresholds: TH, ...over });

  it("initScanState fresh start skips prior events (offset = EOF) and pre-seeds rescan set", () => {
    const full = '{"event":"done","summary":"x"}\n';
    const s = initScanState(Buffer.byteLength(full), full, null, null);
    expect(s.offset).toBe(Buffer.byteLength(full));
    expect(s.rescanEmitted.has("1\tdone")).toBe(true);
  });

  it("initScanState honors a valid persisted cursor <= size, resets on overshoot/junk", () => {
    expect(initScanState(100, "", "40", null).offset).toBe(40);
    expect(initScanState(100, "", "400", null).offset).toBe(100);
    expect(initScanState(100, "", "junk", null).offset).toBe(100);
  });

  it("byte-tail emits done/error/question/heartbeat for new lines, advances offset, uses 'part' key", () => {
    const newText = '{"event":"progress","summary":"p"}\n{"event":"done","summary":"finished"}\n';
    const s: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "viola", s, mkDeps({ outboxText: newText, outboxFullText: newText,
      outboxSize: Buffer.byteLength(newText), phase: "idle" }));
    const evs = r.notifications.map((n) => n.event);
    expect(evs).toContain("done");
    expect(evs).not.toContain("progress");
    expect(r.notifications.find((n) => n.event === "done")!.part).toBe("viola");
    expect(r.state.offset).toBe(Buffer.byteLength(newText));
  });

  it("stuck fires before stale, mutually exclusive, when working + mtime very old", () => {
    const s: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "viola", s, mkDeps({ now: 100000, outboxMtime: 100000 - 2000 }));
    expect(r.notifications.map((n) => n.event)).toContain("stuck");
    expect(r.notifications.map((n) => n.event)).not.toContain("stale");
    expect(r.state.lastStuckTs).toBe(100000);
  });

  it("stale fires when delta in [probeS, stuckS)", () => {
    const s: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "viola", s, mkDeps({ now: 100000, outboxMtime: 100000 - 1000 }));
    expect(r.notifications.map((n) => n.event)).toContain("stale");
  });

  it("no stale/stuck when phase != working", () => {
    const s: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "viola", s, mkDeps({ now: 100000, outboxMtime: 0, phase: "idle" }));
    expect(r.notifications).toHaveLength(0);
  });

  it("stale is rate-limited by probeS across scans", () => {
    let s: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    s = monitorScan("/o", "v", s, mkDeps({ now: 100000, outboxMtime: 99000 })).state;
    const r2 = monitorScan("/o", "v", s, mkDeps({ now: 100100, outboxMtime: 99000 }));
    expect(r2.notifications.map((n) => n.event)).not.toContain("stale");
  });

  it("rescan emits a terminal event missed by the tail, deduped by line+event, with ' (rescan)'", () => {
    const full = '{"event":"progress","summary":"p"}\n{"event":"error","summary":"boom"}\n';
    const s: MonitorScanState = { offset: Buffer.byteLength(full), rescanEmitted: new Set(),
      lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "v", s, mkDeps({ outboxText: "", outboxFullText: full,
      outboxSize: Buffer.byteLength(full), phase: "idle", now: 1000 }));
    const err = r.notifications.find((n) => n.event === "error");
    expect(err).toBeDefined();
    expect(err!.summary).toMatch(/ \(rescan\)$/);
    expect(r.state.rescanEmitted.has("2\terror")).toBe(true);
    const r2 = monitorScan("/o", "v", r.state, mkDeps({ outboxFullText: full, outboxSize: Buffer.byteLength(full),
      phase: "idle", now: 1000 + TH.rescanEveryS }));
    expect(r2.notifications.find((n) => n.event === "error")).toBeUndefined();
  });

  it("monitorScan does not mutate prev (offset/clocks/rescanEmitted)", () => {
    const prev: MonitorScanState = { offset: 0, rescanEmitted: new Set(), lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const newText = '{"event":"done","summary":"d"}\n';
    monitorScan("/o", "v", prev, mkDeps({ outboxText: newText, outboxFullText: newText,
      outboxSize: Buffer.byteLength(newText), phase: "working", now: 100000, outboxMtime: 1 }));
    expect(prev.offset).toBe(0);            // advanced only in returned state
    expect(prev.rescanEmitted.size).toBe(0);
    expect(prev.lastStaleTs).toBe(0);
    expect(prev.lastStuckTs).toBe(0);
    expect(prev.lastRescan).toBe(0);
  });

  it("rescan does NOT emit heartbeat (tail-only event)", () => {
    const full = '{"event":"heartbeat","summary":"epoch 1/5"}\n';
    const s: MonitorScanState = { offset: Buffer.byteLength(full), rescanEmitted: new Set(),
      lastStaleTs: 0, lastStuckTs: 0, lastRescan: 0 };
    const r = monitorScan("/o", "v", s, mkDeps({ outboxText: "", outboxFullText: full,
      outboxSize: Buffer.byteLength(full), phase: "idle", now: 1000 }));
    expect(r.notifications.find((n) => n.event === "heartbeat")).toBeUndefined();
  });

  it("rescan is skipped when now - lastRescan < rescanEveryS", () => {
    const full = '{"event":"done","summary":"d"}\n';
    const s: MonitorScanState = { offset: Buffer.byteLength(full), rescanEmitted: new Set(),
      lastStaleTs: 0, lastStuckTs: 0, lastRescan: 1000 };
    const r = monitorScan("/o", "v", s, mkDeps({ outboxText: "", outboxFullText: full,
      outboxSize: Buffer.byteLength(full), phase: "idle", now: 1000 + TH.rescanEveryS - 1 }));
    expect(r.notifications).toHaveLength(0);      // gate closed -> rescan suppressed
    expect(r.state.rescanEmitted.size).toBe(0);   // rescan never ran -> nothing seeded
  });

  it("pre-seeded terminal event is not re-emitted by the first rescan", () => {
    const full = '{"event":"done","summary":"already seen"}\n';
    const s = initScanState(Buffer.byteLength(full), full, String(Buffer.byteLength(full)), null);
    expect(s.rescanEmitted.has("1\tdone")).toBe(true);   // pre-seed marked it
    const r = monitorScan("/o", "v", s, mkDeps({ outboxText: "", outboxFullText: full,
      outboxSize: Buffer.byteLength(full), phase: "idle", now: 1000 }));
    expect(r.notifications.find((n) => n.event === "done")).toBeUndefined();   // suppressed by pre-seed
  });
});

describe("rehearsalBrief", () => {
  const SIG: CompletionSignals = { floorMet: true, targetMet: false, kSoFar: 1, kRequired: 2, plateau: false };
  const part = (over: Partial<import("../src/core/rehearsalBrief.js").PartBrief> = {}) => ({
    instrument: "viola", phase: "idle", currentOrLast: "exp-001", approach: "baseline", metric: "0.95 ok", ...over,
  });

  it("header names the just-landed exp when latest is given", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: SIG,
      latest: { instrument: "viola", exp: "exp-003" } });
    expect(out).toContain("## Experiment status — exp-003 (viola) just landed");
  });

  it("header is bare when latest is absent", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: SIG });
    expect(out).toContain("## Experiment status");
    expect(out).not.toContain("just landed");
  });

  it("per-part table uses the rebranded | Part | header (NOT | Trooper |)", () => {
    const out = buildStatusBrief({ parts: [part()], scoreboardMd: null, completion: SIG });
    expect(out).toContain("| Part | Phase | Current/last | Approach | Metric |");
    expect(out).toContain("|---|---|---|---|---|");
    expect(out).not.toContain("| Trooper |");
  });

  it("a working part shows (running) in the metric cell", () => {
    const out = buildStatusBrief({ parts: [part({ phase: "working", metric: "(running)" })],
      scoreboardMd: null, completion: SIG });
    expect(out).toContain("| viola | working | exp-001 | baseline | (running) |");
  });

  it("scoreboard null -> _(scoreboard absent)_", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: SIG });
    expect(out).toContain("**Scoreboard top 3:**");
    expect(out).toContain("_(scoreboard absent)_");
  });

  it("scoreboard with no OK rows -> _(no scored experiments yet)_", () => {
    const sb = [
      "# Scoreboard", "",
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
    ].join("\n") + "\n";
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG });
    expect(out).toContain("_(no scored experiments yet)_");
  });

  it("scoreboard with 2 OK rows -> two <rank>. <instrument>/<exp> — <metric> — <metric_name> lines", () => {
    const sb = [
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
      "| 1 | exp-002 | viola | 0.9700 | ok | 12.00s | tuned | accuracy |",
      "| 2 | exp-001 | cello | 0.9500 | ok | 10.00s | baseline | accuracy |",
    ].join("\n") + "\n";
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG });
    expect(out).toContain("1. viola/exp-002 — 0.9700 — accuracy");
    expect(out).toContain("2. cello/exp-001 — 0.9500 — accuracy");
  });

  it("scoreboard top-3 caps at 3 rows", () => {
    const rows = [1, 2, 3, 4].map((n) => `| ${n} | exp-00${n} | inst${n} | 0.9${n}00 | ok | 1.00s | a | accuracy |`);
    const sb = [
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
    ].join("\n") + "\n";
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG });
    expect(out).toContain("3. inst3/exp-003");
    expect(out).not.toContain("4. inst4/exp-004");
  });

  it("completion line renders yes/no booleans in field order", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: SIG });
    expect(out).toContain("**Completion check:** floor_met=yes target_met=no K_so_far=1 K_required=2 plateau=no");
  });

  it("completion null -> the absent line (no misleading all-no row)", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: null });
    expect(out).toContain("**Completion check:** _(scoreboard or metric absent)_");
    expect(out).not.toContain("floor_met=");
  });

  it("ends with a single trailing newline", () => {
    const out = buildStatusBrief({ parts: [part()], scoreboardMd: null, completion: SIG });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
