// tests/score-doc.test.ts
import { describe, it, expect } from "vitest";
import { SECTIONS_SINGLE, SECTIONS_MULTI, sectionTitle, assembleDoc, synthesizeSeeds } from "../src/core/scoreDoc.js";

describe("section model", () => {
  it("single = 6 ordered keys; multi inserts dag + cross-repo between components and testing", () => {
    expect(SECTIONS_SINGLE).toEqual(["problem", "goal", "architecture", "components", "testing", "success-criteria"]);
    expect(SECTIONS_MULTI).toEqual(["problem", "goal", "architecture", "components", "execution-dag", "cross-repo-notes", "testing", "success-criteria"]);
    expect(sectionTitle("execution-dag")).toBe("Execution DAG");
    expect(sectionTitle("success-criteria")).toBe("Success Criteria");
  });
});

describe("assembleDoc", () => {
  const drafts = new Map([["goal", "## Goal\n\ng"], ["architecture", "## Architecture\n\na"]]);
  it("single mode: H1, no header, missing drafts get _(missing draft)_", () => {
    const doc = assembleDoc({ title: "Cache Policy", mode: "single", date: "2026-05-29", targets: [], drafts });
    expect(doc.startsWith("# Cache Policy\n\n")).toBe(true);
    expect(doc).not.toContain("**Date:**");
    expect(doc).toContain("## Goal\n\ng\n");
    expect(doc).toContain("## Problem\n\n_(missing draft)_\n\n");
  });
  it("single-sub: header-less single shape (no Date, no Target header)", () => {
    const doc = assembleDoc({ title: "X", mode: "single-sub", date: "2026-05-29", targets: ["api"], drafts });
    expect(doc.startsWith("# X\n\n")).toBe(true);
    expect(doc).not.toContain("**Target Sub-Project:**");
    expect(doc).not.toContain("**Date:**");
    expect(doc).toContain("## Goal\n\ng\n");
  });
  it("multi: Date + plural Target header + 8 sections (DAG + Cross-Repo)", () => {
    const doc = assembleDoc({ title: "X", mode: "multi", date: "2026-05-29", targets: ["api", "web"], drafts });
    expect(doc).toContain("**Target Sub-Project(s):** api, web\n\n");
    expect(doc).toContain("## Execution DAG\n\n_(missing draft)_\n\n");
    expect(doc).toContain("## Cross-Repo Notes\n\n_(missing draft)_\n\n");
  });
});

describe("synthesizeSeeds", () => {
  // Tag-first convention (clone-wars seeds match `^- \[Goal` etc.): the steer-tag leads the line.
  const adj = [
    "## Cross-verified",
    "- [Goal] ship the thing [src/a.ts:1]",
    "- [Architecture] use a queue [src/b.ts:2]",
    "- [src/c.ts:3] covers the test path",
    "## Contested",
  ].join("\n");
  const seeds = synthesizeSeeds(adj);
  const get = (s: string): string => seeds.find((x) => x.section === s)!.body;
  it("produces the 6 single-repo sections in order", () => {
    expect(seeds.map((s) => s.section)).toEqual(
      ["problem", "goal", "architecture", "components", "testing", "success-criteria"]);
  });
  it("problem gets every bracketed claim; goal/architecture get their tag-led lines", () => {
    expect(get("problem")).toContain("## Problem");
    expect(get("problem")).toContain("[Goal] ship the thing");
    expect(get("goal")).toContain("[Goal] ship the thing");
    expect(get("architecture")).toContain("[Architecture] use a queue");
  });
  it("testing matches [Testing] or a 'test' word; empty match → rebranded placeholder", () => {
    expect(get("testing")).toContain("covers the test path");
    expect(get("components")).toMatch(/no seed content matched/);
    expect(get("components")).not.toMatch(/yoda|step 11/i);
  });
});
