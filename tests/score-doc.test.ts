// tests/score-doc.test.ts
import { describe, it, expect } from "vitest";
import { SECTIONS_SINGLE, SECTIONS_MULTI, sectionTitle, assembleDoc } from "../src/core/scoreDoc.js";

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
  it("single-sub: Date + singular Target header", () => {
    const doc = assembleDoc({ title: "X", mode: "single-sub", date: "2026-05-29", targets: ["api"], drafts });
    expect(doc).toContain("**Date:** 2026-05-29\n");
    expect(doc).toContain("**Target Sub-Project:** api\n\n");
  });
  it("multi: Date + plural Target header + 8 sections (DAG + Cross-Repo)", () => {
    const doc = assembleDoc({ title: "X", mode: "multi", date: "2026-05-29", targets: ["api", "web"], drafts });
    expect(doc).toContain("**Target Sub-Project(s):** api, web\n\n");
    expect(doc).toContain("## Execution DAG\n\n_(missing draft)_\n\n");
    expect(doc).toContain("## Cross-Repo Notes\n\n_(missing draft)_\n\n");
  });
});
