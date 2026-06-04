// src/core/score.ts
import { join } from "node:path";
import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { atomicWrite } from "./atomic.js";
import { topicDir } from "./paths.js";
import { splitNonCommentLines } from "./text.js";
export { deriveSlug } from "./solo.js"; // identical to consult's slug rule; reused, not duplicated

/** `_score` art dir for a topic. */
export function scoreArtDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(topicDir(topic, opts), "_score");
}
/** Where the per-section drafts live. */
export function scoreDraftDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(scoreArtDir(topic, opts), "design-doc", ".draft");
}

export interface ScoreArgs { topicText: string; ensemble: boolean; }

/** Pull the `--ensemble` boolean flag (token-exact) out of the glued $ARGUMENTS. */
export function parseScoreArgs(tokens: string[]): ScoreArgs {
  let ensemble = false;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--ensemble") { ensemble = true; continue; }
    rest.push(t);
  }
  return { topicText: rest.join(" "), ensemble };
}

/** Canonical design-doc path: `_score/design-doc/<YYYY-MM-DD>-<topic>-design.md`. */
export function scoreDocPath(topic: string, dateUtc: string, opts?: { home?: string; cwd?: string }): string {
  return join(scoreArtDir(topic, opts), "design-doc", `${dateUtc}-${topic}-design.md`);
}

export interface RosterRow { provider: string; instrument: string; }

/** roster.txt body: a generated-comment header + one `<provider>\t<instrument>` row per part. */
export function formatRosterFile(rows: RosterRow[], isoStamp: string): string {
  const body = rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n");
  return `# generated ${isoStamp} by /consort:score\n${body}${rows.length ? "\n" : ""}`;
}

/** Split text into trimmed, non-blank, non-`#`-comment lines. */
export function nonCommentLines(text: string): string[] {
  return splitNonCommentLines(text);
}

/** Parse roster.txt: skip #/blank lines; keep rows with both fields.
 *  Consumed by the ensemble path (Phase C reads roster.txt back to spawn the parts); not orphaned. */
export function parseRosterFile(text: string): RosterRow[] {
  return nonCommentLines(text)
    .map((l) => { const [provider, instrument] = l.split("\t"); return { provider, instrument }; })
    .filter((r) => r.provider && r.instrument) as RosterRow[];
}

/** Preflight --roster arg from roster rows: "<instrument>:<provider>,..." (model = provider). */
export function spawnRosterArg(rows: RosterRow[]): string {
  return rows.map((r) => `${r.instrument}:${r.provider}`).join(",");
}

export interface SpawnResult { instrument: string; provider: string; rc: number; }

/** spawn-results.tsv body: one `<instrument>\t<provider>\t<rc>\t<reason>` row per part (no header;
 *  mirrors spawn-batch.sh). reason is "" on success, "spawn-failed" otherwise. */
export function spawnResultsTsv(results: SpawnResult[]): string {
  if (!results.length) return "";
  return results.map((r) => `${r.instrument}\t${r.provider}\t${r.rc}\t${r.rc === 0 ? "" : "spawn-failed"}`).join("\n") + "\n";
}

/** Batch-spawn exit code, ported from spawn-batch.sh: all ok → 0; none ok → 2; partial → 1. */
export function spawnTally(rcs: number[]): 0 | 1 | 2 {
  const ok = rcs.filter((rc) => rc === 0).length;
  if (ok === rcs.length) return 0;
  if (ok === 0) return 2;
  return 1;
}

/** Parse preflight-panes.txt (TSV `<instrument>\t<pane>`; skip #/blank) into a map. */
export function parsePanesFile(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of nonCommentLines(text)) {
    const [instrument, pane] = t.split("\t");
    if (instrument && pane) m.set(instrument, pane);
  }
  return m;
}

/** True iff <instrument>\t<pane> appears as a line in a preflight-panes.txt body. This is the
 *  --target-pane membership check; stricter-than-spawn.sh: spawn.sh accepts the pane under ANY
 *  instrument (wildcard `^[a-z0-9-]+\t<pane>$`), this requires the pane be listed for THIS
 *  instrument so a foreign live pane can never be clobbered. */
export function paneListedFor(panesTsv: string, instrument: string, pane: string): boolean {
  return panesTsv.split("\n").some((l) => l === `${instrument}\t${pane}`);
}

/** Bucket filenames whose verdicts `target` should verify — every file where target is NOT a member
 *  (port of consult-verify-send.sh): others' `<c>_only_items.txt`, then (N>=3) `<a>+<b>_only.txt` with
 *  target ∉ {a,b}. consensus.txt is always excluded (target is a member). */
export function verifyScopeFiles(target: string, instruments: string[]): string[] {
  const out: string[] = [];
  for (const c of instruments) if (c !== target) out.push(`${c}_only_items.txt`);
  if (instruments.length >= 3) {
    for (let i = 0; i < instruments.length; i++) {
      for (let j = i + 1; j < instruments.length; j++) {
        const a = instruments[i], b = instruments[j];
        if (a !== target && b !== target) out.push(`${a}+${b}_only.txt`);
      }
    }
  }
  return out;
}

/** Last `^<tag>=<value>$` value in a KV state file's text; null if absent. */
export function lastTag(text: string, tag: string): string | null {
  const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.*)$`, "gm");
  const ms = [...text.matchAll(re)];
  return ms.length ? ms[ms.length - 1][1].trim() : null;
}

export type ResetPhase = "research" | "verify";
/** Files a clean-retry must invalidate. Globs/files are art-dir relative; partFile is part-dir relative.
 *  Behavioral port of the consult offset-reset cascade, generalized to dynamic instruments (glob, not hardcoded names). */
export function cascadeTargets(phase: ResetPhase, keepFindings: boolean): { partFile: "findings.md" | "verify.md"; artGlobs: string[]; artFiles: string[]; } {
  const partFile = phase === "research" ? "findings.md" : "verify.md";
  if (keepFindings) return { partFile, artGlobs: [], artFiles: [] };
  if (phase === "research") return { partFile, artGlobs: ["*_only_items.txt", "*_only.txt", "consensus.txt"], artFiles: ["adjudicated-draft.md", "diff.md"] };
  return { partFile, artGlobs: [], artFiles: ["adjudicated-draft.md"] };
}

/** Collision-resolved drill output path (port of consult-drilldown.sh resolve_out_path). Strips any
 *  prior `-N` before re-appending `-2..-99`, so re-runs don't compound; throws past 99. */
export function resolveDrilldownPath(scratchDir: string, section: string, instrument: string): string {
  const slug = section.toLowerCase().replace(/ /g, "-");
  const base = `drilldown-${slug}-${instrument}`;
  let cand = base;
  let n = 2;
  while (existsSync(join(scratchDir, `${cand}.md`))) {
    cand = `${cand.replace(/-[0-9]+$/, "")}-${n}`;
    if (++n > 100) throw new Error("resolveDrilldownPath: too many same-section drilldown collisions");
  }
  return join(scratchDir, `${cand}.md`);
}

/** Canonical export location for a finished design doc: <repoRoot>/docs/superpowers/specs/<basename>. */
export function scoreExportDocPath(repoRoot: string, basename: string): string {
  return join(repoRoot, "docs", "superpowers", "specs", basename);
}

/** Copy the single assembled `*-<topic>-design.md` out of `_score/design-doc/` into
 *  `<destRoot>/docs/superpowers/specs/`. Returns the dest path, or null if no assembled doc exists
 *  (assemble must have run first). Overwrites on re-run (latest assembled doc wins). */
export function exportDocTo(topic: string, destRoot: string, opts?: { home?: string; cwd?: string }): string | null {
  const ddir = join(scoreArtDir(topic, opts), "design-doc");
  if (!existsSync(ddir)) return null;
  const hits = readdirSync(ddir).filter((f) => f.endsWith(`-${topic}-design.md`)).sort();
  if (hits.length === 0) return null;
  const basename = hits[hits.length - 1];
  const dest = scoreExportDocPath(destRoot, basename);
  mkdirSync(join(destRoot, "docs", "superpowers", "specs"), { recursive: true });
  atomicWrite(dest, readFileSync(join(ddir, basename), "utf8"));
  return dest;
}
