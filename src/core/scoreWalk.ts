// src/core/scoreWalk.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Port of consult_audit_issue_to_section (lib/consult-walk.sh:18-33). Section name | "ASK" | "" (unknown). */
export function auditIssueToSection(key: string): string {
  switch (key) {
    case "no_goal_section": return "goal";
    case "no_arch_section": return "architecture";
    case "no_testing_section": return "testing";
    case "no_success_section": return "success-criteria";
    case "tbd_marker": case "todo_marker": case "fill_in_later_marker": case "to_be_determined_marker": return "ASK";
    case "unresolved_placeholder": return "architecture";
    default: return "";
  }
}

export interface SectionStatus { name: string; status: "approved" | "skipped"; }

/** Port of consult_walk_section_state (lib/consult-walk.sh:106-129). Lists *.md basenames (sorted). A draft whose whitespace-
 *  stripped body is exactly "_(skipped)_" is skipped; anything else approved. Missing dir → []. */
export function walkSectionState(dir: string): string[];
export function walkSectionState(dir: string, opts: { withStatus: true }): SectionStatus[];
export function walkSectionState(dir: string, opts?: { withStatus?: boolean }): string[] | SectionStatus[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); }
  catch { return []; }
  const names = files.map((f) => f.replace(/\.md$/, "")).sort();
  if (!opts?.withStatus) return names;
  return names.map((name) => {
    const body = readFileSync(join(dir, `${name}.md`), "utf8").replace(/\s/g, "");
    return { name, status: body === "_(skipped)_" ? "skipped" : "approved" } as SectionStatus;
  });
}
