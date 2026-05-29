// tests/audit.test.ts
import { describe, it, expect } from "vitest";
import { auditDoc, extractTarget, SLUG_REGEX } from "../src/core/audit.js";

const COMPLETE = [
  "# X", "## Problem", "p", "## Goal", "g", "## Architecture", "a",
  "## Components", "c", "## Testing", "t", "## Success Criteria", "s",
].join("\n") + "\n";

describe("auditDoc", () => {
  it("complete doc → PASS, no issues", () => {
    expect(auditDoc(COMPLETE)).toEqual({ verdict: "PASS", issues: [] });
  });
  it("missing mandatory sections → the four no_*_section issues in order", () => {
    const r = auditDoc("# X\n## Problem\np\n## Components\nc\n");
    expect(r.verdict).toBe("FAIL");
    expect(r.issues).toEqual(["no_goal_section", "no_arch_section", "no_testing_section", "no_success_section"]);
  });
  it("Approach satisfies the architecture gate", () => {
    const doc = COMPLETE.replace("## Architecture", "## Approach");
    expect(auditDoc(doc).issues).not.toContain("no_arch_section");
  });
  it("TBD as a word fails; lowercase todo is allowed", () => {
    expect(auditDoc(COMPLETE + "note: TBD\n").issues).toContain("tbd_marker");
    expect(auditDoc(COMPLETE + "field: todo_count\n").issues).not.toContain("todo_marker");
    expect(auditDoc(COMPLETE + "TODO later\n").issues).toContain("todo_marker");
  });
  it("fill in later / to be determined markers (case-insensitive)", () => {
    expect(auditDoc(COMPLETE + "Fill In Later\n").issues).toContain("fill_in_later_marker");
    expect(auditDoc(COMPLETE + "to be determined\n").issues).toContain("to_be_determined_marker");
  });
  it("hallucinated placeholder block-list", () => {
    expect(auditDoc(COMPLETE + "see <previous-deep-research>\n").issues).toContain("unresolved_placeholder");
    expect(auditDoc(COMPLETE + "the <topic> var\n").issues).not.toContain("unresolved_placeholder");
  });
  it("invalid Target Sub-Project slug → issue; valid → none", () => {
    expect(auditDoc(COMPLETE + "**Target Sub-Project:** ../escape\n").issues).toContain("target_subproject_when_invalid");
    expect(auditDoc(COMPLETE + "**Target Sub-Project:** api\n").issues).not.toContain("target_subproject_when_invalid");
  });
  it("unparseable Execution DAG → issue; absent heading → none", () => {
    expect(auditDoc(COMPLETE + "## Execution DAG\n1. bad line no emdash\n").issues).toContain("execution_dag_not_parseable");
    expect(auditDoc(COMPLETE).issues).not.toContain("execution_dag_not_parseable");
  });
  it("issue order: placeholder before tbd before markers before target before dag", () => {
    const doc = COMPLETE + "**Target Sub-Project:** ../x\n## Execution DAG\n1. bad\nTBD <archive>\n";
    const i = auditDoc(doc).issues;
    expect(i.indexOf("unresolved_placeholder")).toBeLessThan(i.indexOf("tbd_marker"));
    expect(i.indexOf("tbd_marker")).toBeLessThan(i.indexOf("target_subproject_when_invalid"));
    expect(i.indexOf("target_subproject_when_invalid")).toBeLessThan(i.indexOf("execution_dag_not_parseable"));
  });
});

describe("extractTarget", () => {
  it("no header → present:false", () => { expect(extractTarget(COMPLETE)).toEqual({ present: false }); });
  it("valid slug", () => { expect(extractTarget("**Target Sub-Project:** api\n")).toEqual({ present: true, valid: true, slug: "api" }); });
  it("invalid slug → valid:false", () => { expect(extractTarget("**Target Sub-Project:** ../x\n")).toEqual({ present: true, valid: false }); });
  it("two headers → valid:false (ambiguous)", () => {
    expect(extractTarget("**Target Sub-Project:** a\n**Target Sub-Project:** b\n")).toEqual({ present: true, valid: false });
  });
  it("SLUG_REGEX accepts dotted/hyphen/underscore", () => { expect(SLUG_REGEX.test("a.b-c_d")).toBe(true); });
});
