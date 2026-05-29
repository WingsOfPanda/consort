// src/core/audit.ts
import { checkDagSection } from "./dag.js";

/** Behavioral source: SLUG_REGEX_BASE (lib/state.sh:10). */
export const SLUG_REGEX = /^[A-Za-z0-9._-]+$/;

const TARGET_HEADER = /^[ \t]*\*\*Target Sub-Project:\*\*[ \t]+/gm;

export type TargetResult =
  | { present: false }
  | { present: true; valid: true; slug: string }
  | { present: true; valid: false };

/** Port of deploy_extract_target (lib/deploy.sh:391-419). No header → present:false; 1 valid → slug; 1 invalid or 2+ → valid:false. */
export function extractTarget(docText: string): TargetResult {
  const matches = docText.match(TARGET_HEADER);
  if (!matches || matches.length === 0) return { present: false };
  if (matches.length > 1) return { present: true, valid: false };
  const line = docText.split("\n").find((l) => /^[ \t]*\*\*Target Sub-Project:\*\*[ \t]+/.test(l)) ?? "";
  const slug = line.replace(/^[ \t]*\*\*Target Sub-Project:\*\*[ \t]+([^ \t]+).*$/, "$1");
  return SLUG_REGEX.test(slug) ? { present: true, valid: true, slug } : { present: true, valid: false };
}

export interface AuditResult { verdict: "PASS" | "FAIL"; issues: string[]; }

/** Port of deploy_audit_doc (lib/deploy.sh:68-122) — a pure read-only markdown linter. Issue ORDER mirrors the Bash. */
export function auditDoc(docText: string): AuditResult {
  const issues: string[] = [];
  if (!/^##\s+Goal\b/m.test(docText)) issues.push("no_goal_section");
  if (!/^##\s+(Architecture|Approach)\b/m.test(docText)) issues.push("no_arch_section");
  if (!/^##\s+.*[Tt]est/m.test(docText)) issues.push("no_testing_section");
  if (!/^##\s+.*[Ss]uccess/m.test(docText)) issues.push("no_success_section");
  if (/<(archive|previous-[a-z][a-z0-9_-]*|archived-[a-z][a-z0-9_-]*|source-[a-z][a-z0-9_-]*)>/.test(docText)) issues.push("unresolved_placeholder");
  if (/\bTBD\b/.test(docText)) issues.push("tbd_marker");
  if (/\bTODO\b/.test(docText)) issues.push("todo_marker");
  if (/fill in later/i.test(docText)) issues.push("fill_in_later_marker");
  if (/to be determined/i.test(docText)) issues.push("to_be_determined_marker");
  const t = extractTarget(docText);
  if (t.present && !t.valid) issues.push("target_subproject_when_invalid");
  if (/^## Execution DAG[ \t]*$/m.test(docText) && !checkDagSection(docText)) issues.push("execution_dag_not_parseable");
  return issues.length === 0 ? { verdict: "PASS", issues } : { verdict: "FAIL", issues };
}
