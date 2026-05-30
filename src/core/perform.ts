// src/core/perform.ts
// CORE paths / parse / target-resolution + provider-detection for /consort:perform.
// Byte-faithful port of the prior bash plugin's deploy core helpers (cosmetic rebrand: _deploy/ ->
// _perform/, worker-noun -> "part", deploy env prefix -> CONSORT_PERFORM_*). Logic preserved verbatim.
import { join, basename } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import { topicDir } from "./paths.js";
import { extractTarget } from "./audit.js";
import { kvParse } from "../args.js";

export { extractTarget } from "./audit.js"; // REUSED: audit.ts already ports the target-header extractor.

/** `_perform` art dir for a topic. Honors CONSORT_PERFORM_ART_DIR_OVERRIDE; else <topicDir>/_perform. */
export function performArtDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  const override = process.env.CONSORT_PERFORM_ART_DIR_OVERRIDE;
  if (override) return override;
  return join(topicDir(topic, opts), "_perform");
}

/** Topic state dir for a perform invocation. */
export function performTopicDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return topicDir(topic, opts);
}

/** Port of deploy_derive_topic: basename, strip leading YYYY-MM-DD-, then trailing -design.md else .md. */
export function deriveTopicFromPath(p: string): string {
  if (!p) return "";
  let base = basename(p);
  base = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  if (base.endsWith("-design.md")) base = base.slice(0, -"-design.md".length);
  else if (base.endsWith(".md")) base = base.slice(0, -".md".length);
  return base;
}

export interface PerformArgs {
  rest: string;
  branchMode: "branch" | "no-branch";
  branchName?: string;
  topic?: string;
  targets: string[];
}

export class PerformArgError extends Error { code = 2; }
export class PerformResolveError extends Error { code = 1; constructor(message: string) { super(message); } }
export class ProviderError extends Error { code = 1; constructor(message: string) { super(message); } }

/** Parse the perform args tokens (port of deploy-init's argv parser). Default branch-on; --no-branch
 *  opts out. --max-rounds is REJECTED (the directive strips it before init). */
export function parsePerformArgs(tokens: string[]): PerformArgs {
  let branchMode: "branch" | "no-branch" = "branch";
  let branchName: string | undefined;
  let topic: string | undefined;
  let targets: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--max-rounds" || t.startsWith("--max-rounds=")) {
      throw new PerformArgError("--max-rounds must be stripped by the directive before init");
    }
    if (t === "--no-branch") { branchMode = "no-branch"; continue; }
    if (t === "--branch" || t.startsWith("--branch=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]); branchName = value; if (shift === 2) i++; continue;
    }
    if (t === "--topic" || t.startsWith("--topic=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]); topic = value; if (shift === 2) i++; continue;
    }
    if (t === "--targets" || t.startsWith("--targets=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]);
      targets = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (shift === 2) i++; continue;
    }
    rest.push(t);
  }
  return { rest: rest.join(" "), branchMode, branchName, topic, targets };
}

/** True iff `<dir>/.git` exists as a directory (normal repo) or a file (gitdir worktree). */
function hasGitDir(dir: string): boolean {
  const dotgit = join(dir, ".git");
  if (!existsSync(dotgit)) return false;
  try { const st = statSync(dotgit); return st.isDirectory() || st.isFile(); } catch { return false; }
}

/** Port of deploy_resolve_target. No header -> cwd; invalid/ambiguous -> throw; valid + <cwd>/<slug>/.git
 *  -> <cwd>/<slug>; missing dir / no .git -> throw. Reads the doc from disk. */
export function resolveTarget(docPath: string, cwd: string): string {
  let docText: string;
  try { docText = readFileSync(docPath, "utf8"); }
  catch { throw new PerformResolveError(`resolveTarget: doc unreadable: ${docPath}`); }
  const t = extractTarget(docText);
  if (t.present && !t.valid) {
    throw new PerformResolveError(`resolveTarget: invalid or ambiguous Target Sub-Project header in ${docPath}`);
  }
  if (!t.present) return cwd;
  const slug = t.slug;
  const sub = join(cwd, slug);
  let isDir = false;
  try { isDir = statSync(sub).isDirectory(); } catch { isDir = false; }
  if (!isDir) {
    throw new PerformResolveError(`target sub-project '${slug}' not found at ${sub} (no directory; check spelling or that the sub-repo is checked out)`);
  }
  if (!hasGitDir(sub)) {
    throw new PerformResolveError(`target sub-project '${slug}' is a directory but not a git repo (no .git/ at ${sub})`);
  }
  return sub;
}

/** Port of deploy_resolve_hub: both modes resolve to repoRoot in the current contract. */
export function resolveHub(_docPath: string, repoRoot: string): string {
  return repoRoot;
}

/** Port of deploy_detect_provider. plugin.json present -> claude; else codex. Non-empty override
 *  short-circuits (codex/claude only; opencode + unknown throw). */
export function detectProvider(repoRoot: string, override?: string): "codex" | "claude" {
  if (override) {
    if (override === "codex" || override === "claude") return override;
    if (override === "opencode") {
      throw new ProviderError("perform: opencode is not a supported provider; use codex (default) or claude (plugin-dev)");
    }
    throw new ProviderError(`perform: unknown provider override '${override}' (allowed: codex, claude)`);
  }
  return existsSync(join(repoRoot, ".claude-plugin", "plugin.json")) ? "claude" : "codex";
}

export interface IterTarget { slug: string; cwd: string; }

/** Port of deploy_iter_targets. Hub mode reads parts.txt (TSV <slug>\t<cwd>); single-repo synthesizes
 *  one 'main' row from target_cwd.txt; neither file -> []. (parts.txt, NOT the worker-noun file —
 *  gate-safe; the stale-token gate bans that substring.) */
export function iterTargets(topic: string, opts?: { home?: string; cwd?: string }): IterTarget[] {
  const art = performArtDir(topic, opts);
  const partsFile = join(art, "parts.txt");
  if (existsSync(partsFile)) {
    const out: IterTarget[] = [];
    for (const line of readFileSync(partsFile, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const cols = line.split("\t");
      out.push({ slug: cols[0] ?? "", cwd: cols[1] ?? "" });
    }
    return out;
  }
  const targetCwdFile = join(art, "target_cwd.txt");
  if (existsSync(targetCwdFile)) {
    const cwd = readFileSync(targetCwdFile, "utf8").replace(/\n$/, "");
    return [{ slug: "main", cwd }];
  }
  return [];
}
