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

// Persistence formats (byte-identical to the prior bash plugin's deploy-dag-parse.sh):
//   dag-edges.txt  — TSV, one edge per line: `<from-step>\t<to-step>\n`
//   dag-waves.txt  — TSV, one node per line: `<wave>\t<step>\t<repo>\t<path|none>\t<desc>\n`
//                    (5-field). dagTopological emits only the leading `<wave>\t<step>` pair — the
//                    caller (the perform-init analog) joins each topo row with the parsed
//                    `<repo>\t<path>\t<desc>` for that step before writing the file atomically.
//
// In-memory contract: edges = Array<[from, to]> (step ids), nodes = string[] (all step ids).

/** Port of deploy_dag_topological (deploy-dag.sh:78-123). Kahn's topological sort over step-id
 *  nodes + `<from,to>` edges, producing `<wave>\t<step>` rows (wave 1 = zero incoming). Intra-wave
 *  order is numeric ascending (bash `sort -n`). On a cycle, writes the byte-faithful diagnostic to
 *  stderr and returns null (null-on-failure idiom; the DAG validator does NOT detect cycles). */
export function dagTopological(edges: Array<[string, string]>, nodes: string[]): string[] | null {
  const indegree = new Map<string, number | "DONE">();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n, 0);
    children.set(n, []);
  }
  for (const [from, to] of edges) {
    if (!from || !to) continue; // bash: [[ -n "$from" && -n "$to" ]] || continue
    const cur = indegree.get(to);
    indegree.set(to, (typeof cur === "number" ? cur : 0) + 1);
    const kids = children.get(from) ?? [];
    kids.push(to);
    children.set(from, kids);
  }
  const out: string[] = [];
  let wave = 1;
  let emitted = 0;
  const total = nodes.length; // bash `$#` — NOT de-duped
  while (emitted < total) {
    const currentWave: string[] = [];
    for (const [n, deg] of indegree) {
      if (deg !== 0) continue; // skip non-zero AND the "DONE" sentinel
      currentWave.push(n);
    }
    if (currentWave.length === 0) {
      process.stderr.write(
        `dagTopological: cycle detected (no zero-indegree nodes left, ${emitted}/${total} processed)\n`,
      );
      return null;
    }
    const sorted = [...currentWave].sort((a, b) => Number(a) - Number(b)); // bash `sort -n`
    for (const n of sorted) {
      out.push(`${wave}\t${n}`);
      indegree.set(n, "DONE");
      emitted += 1;
      for (const c of children.get(n) ?? []) {
        const cd = indegree.get(c);
        if (cd === undefined || cd === "DONE") continue; // bash: ${indegree[$c]:-DONE} == DONE → skip
        indegree.set(c, cd - 1);
      }
    }
    wave += 1;
  }
  return out;
}

/** Port of deploy_dag_unique_repos (deploy-dag.sh:128-132). Unique repo slugs (column 3 of
 *  dag-waves.txt `<wave>\t<step>\t<repo>\t<path>\t<desc>`), sorted ascending in code-unit order —
 *  byte-faithful to `awk -F'\t' '{print $3}' | sort -u`. */
export function dagUniqueRepos(wavesText: string): string[] {
  const lines = wavesText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // drop trailing-newline empty record
  const seen = new Set<string>();
  for (const line of lines) {
    seen.add(line.split("\t")[2] ?? "");
  }
  return [...seen].sort();
}

/** Port of deploy_dag_fan_in_repos (deploy-dag.sh:139-154). Repo slugs whose step id has >=2
 *  incoming edges, in dag-waves.txt row order (NOT sorted, NOT de-duped). `edgesText` =
 *  dag-edges.txt; `wavesText` = dag-waves.txt. */
export function dagFanInRepos(edgesText: string, wavesText: string): string[] {
  const indegree = new Map<string, number>();
  for (const line of edgesText.split("\n")) {
    if (line === "") continue;
    const [, to] = line.split("\t");
    if (!to) continue; // bash: [[ -n "$to" ]] || continue
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const line of wavesText.split("\n")) {
    const cols = line.split("\t");
    const step = cols[1];
    const repo = cols[2];
    if (!step) continue; // bash: [[ -n "$step" ]] || continue (also skips trailing empty line)
    if ((indegree.get(step) ?? 0) >= 2) out.push(repo ?? "");
  }
  return out;
}
