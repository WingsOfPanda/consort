// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";
import { extractMetric, METRIC_VOCAB } from "../src/core/rehearsalMetric.js";
import { formatMetricBlock, parseMetricMd } from "../src/core/rehearsalMetric.js";
import { formatSotaBlock } from "../src/core/rehearsalMetric.js";

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
