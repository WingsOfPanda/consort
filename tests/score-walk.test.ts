// tests/score-walk.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkSectionState, auditIssueToSection } from "../src/core/scoreWalk.js";

describe("auditIssueToSection", () => {
  it("maps each known issue code", () => {
    expect(auditIssueToSection("no_goal_section")).toBe("goal");
    expect(auditIssueToSection("no_arch_section")).toBe("architecture");
    expect(auditIssueToSection("no_testing_section")).toBe("testing");
    expect(auditIssueToSection("no_success_section")).toBe("success-criteria");
    expect(auditIssueToSection("tbd_marker")).toBe("ASK");
    expect(auditIssueToSection("todo_marker")).toBe("ASK");
    expect(auditIssueToSection("unresolved_placeholder")).toBe("architecture");
    expect(auditIssueToSection("something_unknown")).toBe("");
  });
});

describe("walkSectionState", () => {
  it("names sorted; --with-status detects _(skipped)_ vs approved", () => {
    const dir = mkdtempSync(join(tmpdir(), "walk-"));
    writeFileSync(join(dir, "goal.md"), "## Goal\n\nreal content\n");
    writeFileSync(join(dir, "components.md"), "_(skipped)_\n");
    expect(walkSectionState(dir)).toEqual(["components", "goal"]);
    expect(walkSectionState(dir, { withStatus: true })).toEqual([
      { name: "components", status: "skipped" },
      { name: "goal", status: "approved" },
    ]);
  });
  it("missing dir → []", () => { expect(walkSectionState("/no/such/dir")).toEqual([]); });
});
