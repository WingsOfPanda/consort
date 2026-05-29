// src/core/dag.ts
export interface DagNode { step: string; repo: string; path: string; desc: string; deps: string; }
export interface SoftDagRow { step: string; repo: string; desc: string; deps: string; } // deps: "none" | "1,2"

const LINE_RE = /^(\d+)\.[ \t]+([A-Za-z0-9_-]+)(?:[ \t]+\((\/[^)]+)\))?[ \t]+—[ \t]+(.+)$/;
const DEPS_RE = /^(.+?)[ \t]+\(depends[ \t]+on[ \t]+([0-9, ]+)\)[ \t]*$/;

/** Port of deploy_dag_parse_line (lib/deploy-dag.sh:22-72). Returns the parsed node or null on a malformed line. */
export function parseDagLine(line: string): DagNode | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const step = m[1], repo = m[2], path = m[3] ?? "none", rest = m[4];
  const d = DEPS_RE.exec(rest);
  if (d) return { step, repo, path, desc: d[1], deps: d[2].replace(/ /g, "") };
  return { step, repo, path, desc: rest, deps: "none" };
}

/** Port of deploy_dag_check_section (lib/deploy-dag.sh:22-72). Absent/no-numbered-lines → ok; any malformed numbered line → fail. */
export function checkDagSection(docText: string): boolean {
  const lines = docText.split("\n");
  let inDag = false;
  const body: string[] = [];
  for (const l of lines) {
    if (/^## Execution DAG[ \t]*$/.test(l)) { inDag = true; continue; }
    if (/^## /.test(l)) { inDag = false; continue; }
    if (inDag) body.push(l);
  }
  for (const l of body) {
    if (!/^[ \t]*\d+\./.test(l)) continue;
    if (parseDagLine(l) === null) return false;
  }
  return true;
}

/** The numbered `## Execution DAG` lines that fail parseDagLine (for the pre-Approve gate's stderr).
 *  Mirrors checkDagSection's body extraction + numbered-line detection; absent/narrative-only → []. */
export function dagMalformedLines(docText: string): string[] {
  const body: string[] = [];
  let inDag = false;
  for (const l of docText.split("\n")) {
    if (/^## Execution DAG[ \t]*$/.test(l)) { inDag = true; continue; }
    if (/^## /.test(l)) { inDag = false; continue; }
    if (inDag) body.push(l);
  }
  return body.filter((l) => /^[ \t]*\d+\./.test(l) && parseDagLine(l) === null);
}

/** Port of consult_emit_soft_dag (lib/consult-walk.sh:41-57). "1,2" deps render as "1, 2"; "none"/"" → no suffix. */
export function emitSoftDag(rows: SoftDagRow[]): string {
  return rows
    .filter((r) => r.step.length > 0)
    .map((r) =>
      r.deps === "none" || r.deps === ""
        ? `${r.step}. ${r.repo} — ${r.desc}`
        : `${r.step}. ${r.repo} — ${r.desc} (depends on ${r.deps.replace(/,/g, ", ")})`,
    )
    .join("\n");
}
