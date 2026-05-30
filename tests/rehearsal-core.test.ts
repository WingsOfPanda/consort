// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";
import { extractMetric, METRIC_VOCAB } from "../src/core/rehearsalMetric.js";

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
