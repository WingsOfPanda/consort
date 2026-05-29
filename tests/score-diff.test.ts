import { describe, it, expect } from "vitest";
import { parseClaims, citationOverlaps } from "../src/core/scoreDiff.js";

describe("parseClaims", () => {
  it("extracts [cite] + text from numbered lines under ## Claims only", () => {
    const md = [
      "# Findings: X", "## Summary", "prose here",
      "## Claims",
      "1. [src/a.ts:10] does the thing",
      "2. [https://x.com] external fact",
      "no-citation line is skipped",
      "## Notes", "3. [src/b.ts:1] NOT a claim (outside block)",
    ].join("\n");
    expect(parseClaims(md)).toEqual([
      { cite: "src/a.ts:10", text: "does the thing" },
      { cite: "https://x.com", text: "external fact" },
    ]);
  });
  it("no ## Claims block → []", () => { expect(parseClaims("# X\n## Summary\ny\n")).toEqual([]); });
});

describe("citationOverlaps", () => {
  it("URL: exact equality only", () => {
    expect(citationOverlaps("https://a", "https://a")).toBe(true);
    expect(citationOverlaps("https://a", "https://b")).toBe(false);
  });
  it("runtime: exact equality only", () => {
    expect(citationOverlaps("runtime: npm test", "runtime: npm test")).toBe(true);
    expect(citationOverlaps("runtime: a", "runtime: b")).toBe(false);
  });
  it("file vs URL/runtime never overlap", () => {
    expect(citationOverlaps("src/a.ts:1", "https://a")).toBe(false);
    expect(citationOverlaps("src/a.ts:1", "runtime: x")).toBe(false);
  });
  it("file: same path required; ./ stripped", () => {
    expect(citationOverlaps("./src/a.ts:1", "src/a.ts:1")).toBe(true);
    expect(citationOverlaps("src/a.ts:1", "src/b.ts:1")).toBe(false);
  });
  it("path-only on either side covers all lines → overlap", () => {
    expect(citationOverlaps("src/a.ts", "src/a.ts:50")).toBe(true);
    expect(citationOverlaps("src/a.ts:50", "src/a.ts")).toBe(true);
  });
  it("ranges overlap iff a1<=b2 && b1<=a2 (single line = Lo=Hi)", () => {
    expect(citationOverlaps("src/a.ts:10-20", "src/a.ts:15")).toBe(true);
    expect(citationOverlaps("src/a.ts:10-20", "src/a.ts:25")).toBe(false);
    expect(citationOverlaps("src/a.ts:10", "src/a.ts:10")).toBe(true);
  });
  it("leading-zero numerals are base-10 (no octal), non-digit endpoints → no overlap", () => {
    expect(citationOverlaps("src/a.ts:008", "src/a.ts:008")).toBe(true);
    expect(citationOverlaps("src/a.ts:x", "src/a.ts:1")).toBe(false);
  });
});
