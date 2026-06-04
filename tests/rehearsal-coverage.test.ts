import { describe, it, expect } from "vitest";
import { normalizeFamily, tallyCoverage, coverageRow, COVERAGE_TSV_HEADER } from "../src/core/rehearsalCoverage.js";

describe("normalizeFamily", () => {
  it("lowercases, trims, and collapses surrounding whitespace/punctuation", () => {
    expect(normalizeFamily("SGD")).toBe("sgd");
    expect(normalizeFamily("  sgd  ")).toBe("sgd");
    expect(normalizeFamily("SGD-baseline")).toBe("sgd-baseline");
    expect(normalizeFamily("(single pass)")).toBe("single pass");
    expect(normalizeFamily("typed   routing")).toBe("typed routing");
  });
  it("keeps internal-punctuation variants distinct (Maestro intent)", () => {
    expect(normalizeFamily("single-pass")).not.toBe(normalizeFamily("single pass"));
  });
  it("returns empty string for blank/punctuation-only labels", () => {
    expect(normalizeFamily("   ")).toBe("");
    expect(normalizeFamily("--")).toBe("");
  });
});

describe("tallyCoverage", () => {
  const rows = (xs: [string, string, string?][]) =>
    xs.map(([approach, metric]) => ({ approach, metric }));

  it("groups by normalized family and counts, direction-aware best (maximize default)", () => {
    const out = tallyCoverage(rows([
      ["single-pass", "0.90"], ["Single-Pass", "0.96"], ["typed-routing", "0.94"],
    ]));
    expect(out).toEqual([
      { family: "single-pass", count: 2, best: "0.96", ts: "" },
      { family: "typed-routing", count: 1, best: "0.94", ts: "" },
    ]);
  });
  it("uses min for minimize direction", () => {
    const out = tallyCoverage(rows([["a", "0.20"], ["a", "0.08"]]), "minimize");
    expect(out[0]).toEqual({ family: "a", count: 2, best: "0.08", ts: "" });
  });
  it("buckets blank labels as (unlabeled) and counts non-numeric metrics without affecting best", () => {
    const out = tallyCoverage(rows([["", "0.5"], ["", "n/a"]]));
    expect(out[0]).toEqual({ family: "(unlabeled)", count: 2, best: "0.5", ts: "" });
  });
  it("sorts by count desc then family asc", () => {
    const out = tallyCoverage(rows([["b", "0.1"], ["a", "0.1"], ["a", "0.2"]]));
    expect(out.map((r) => r.family)).toEqual(["a", "b"]);
  });
});

describe("coverageRow + header", () => {
  it("emits a tab-joined row with trailing newline", () => {
    expect(COVERAGE_TSV_HEADER).toBe("family\tcount\tbest\tts\n");
    expect(coverageRow({ family: "single-pass", count: 4, best: "0.96", ts: "2026-06-04T10:00:00Z" }))
      .toBe("single-pass\t4\t0.96\t2026-06-04T10:00:00Z\n");
  });
});
