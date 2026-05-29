import { describe, it, expect } from "vitest";
import { parseClaims, citationOverlaps, diffFindings } from "../src/core/scoreDiff.js";

const claims = (...items: string[]) => "## Claims\n" + items.map((c, i) => `${i + 1}. ${c}`).join("\n") + "\n";

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

describe("diffFindings N=2", () => {
  it("buckets agreed vs single-only; writes two *_only_items.txt + diff.md", () => {
    const rex = claims("[src/a.ts:10] both see A", "[src/r.ts:1] only rex");
    const cody = claims("[src/a.ts:10] both see A", "[src/c.ts:1] only cody");
    const r = diffFindings([{ name: "rex", findings: rex }, { name: "cody", findings: cody }]);
    // bucket files: exactly the two single-only files
    const names = r.files.map((f) => f.filename).sort();
    expect(names).toEqual(["cody_only_items.txt", "rex_only_items.txt"]);
    expect(r.files.find((f) => f.filename === "rex_only_items.txt")!.content).toBe("[src/r.ts:1] only rex\n");
    expect(r.files.find((f) => f.filename === "cody_only_items.txt")!.content).toBe("[src/c.ts:1] only cody\n");
    // diff.md: Agreed has the merged pair (pipe-joined), then the two -only sections
    expect(r.diffMd).toContain("## Agreed\n- [src/a.ts:10] both see A | both see A\n");
    expect(r.diffMd).toContain("## Rex-only\n- [src/r.ts:1] only rex\n");
    expect(r.diffMd).toContain("## Cody-only\n- [src/c.ts:1] only cody\n");
  });
  it("empty single bucket → empty file content + empty diff.md section", () => {
    const rex = claims("[src/a.ts:1] shared");
    const cody = claims("[src/a.ts:1] shared");
    const r = diffFindings([{ name: "rex", findings: rex }, { name: "cody", findings: cody }]);
    expect(r.files.find((f) => f.filename === "rex_only_items.txt")!.content).toBe("");
    expect(r.diffMd).toContain("## Rex-only\n\n");
  });
});

describe("diffFindings N=3", () => {
  it("writes consensus.txt + pair-only + single-only; diff.md Consensus/pairs/singles", () => {
    const rex = claims("[a.ts:1] all", "[rc.ts:1] rex+cody");
    const cody = claims("[a.ts:1] all", "[rc.ts:1] rex+cody");
    const bly = claims("[a.ts:1] all", "[b.ts:1] only bly");
    const r = diffFindings([
      { name: "rex", findings: rex }, { name: "cody", findings: cody }, { name: "bly", findings: bly },
    ]);
    const names = r.files.map((f) => f.filename).sort();
    // Bash cw_consult_diff writes a file for EVERY pair (in input order), even
    // empty ones — so cody+bly_only.txt is present though it has no items.
    expect(names).toEqual([
      "bly_only_items.txt", "cody+bly_only.txt", "cody_only_items.txt", "consensus.txt",
      "rex+bly_only.txt", "rex+cody_only.txt", "rex_only_items.txt",
    ].sort());
    expect(r.files.find((f) => f.filename === "cody+bly_only.txt")!.content).toBe("");
    expect(r.files.find((f) => f.filename === "consensus.txt")!.content).toBe("[a.ts:1] all | all | all\n");
    expect(r.files.find((f) => f.filename === "rex+cody_only.txt")!.content).toBe("[rc.ts:1] rex+cody | rex+cody\n");
    expect(r.files.find((f) => f.filename === "bly_only_items.txt")!.content).toBe("[b.ts:1] only bly\n");
    expect(r.diffMd).toContain("## Consensus\n- [a.ts:1] all | all | all\n");
    expect(r.diffMd).toContain("## Rex+Cody only\n- [rc.ts:1] rex+cody | rex+cody\n");
    expect(r.diffMd).toContain("## Bly-only\n- [b.ts:1] only bly\n");
  });
});
