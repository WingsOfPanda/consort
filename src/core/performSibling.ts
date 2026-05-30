// src/core/performSibling.ts
//
// Adjacent-tree commit guard for `perform` Phase A (port of deploy-sibling). Four byte-faithful
// helpers: enumerateSiblings (fs walk), captureSiblingBaseline (baseline row), diffSiblingAgainstBaseline
// (rogue-commit log), revertAndReplay (two-phase rescue). All git goes through an injected Runner.
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Runner } from "./gitwork.js";

export type EnumerateOutcome = "ok" | "not-a-directory";
export interface EnumerateResult { outcome: EnumerateOutcome; siblings: string[]; }

/** Enumerate undeclared sibling git repos directly under `hub`. `declaredTargets` slugs are excluded. */
export function enumerateSiblings(hub: string, declaredTargets: string[]): EnumerateResult {
  const excluded = new Set(declaredTargets);
  let entries: string[];
  try {
    entries = readdirSync(hub, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { outcome: "not-a-directory", siblings: [] };
  }
  const siblings: string[] = [];
  for (const slug of entries) {
    if (slug.startsWith(".")) continue;
    const dotGit = join(hub, slug, ".git");
    let isRepo = false;
    try { isRepo = statSync(dotGit).isDirectory(); } catch { isRepo = false; }
    if (!isRepo) continue;
    if (excluded.has(slug)) continue;
    siblings.push(slug);
  }
  siblings.sort();
  return { outcome: "ok", siblings };
}

export type CaptureOutcome = "ok" | "not-git" | "detached";
export interface CaptureResult { outcome: CaptureOutcome; row?: string; slug?: string; sha?: string; branch?: string; }

/** Capture a sibling's baseline row. `r` is a Runner bound to the sibling cwd; `siblingCwd` derives the slug. */
export function captureSiblingBaseline(r: Runner, siblingCwd: string): CaptureResult {
  if (r.run("git", ["rev-parse", "--git-dir"]).code !== 0) return { outcome: "not-git" };
  const symref = r.run("git", ["symbolic-ref", "--short", "HEAD"]);
  if (symref.code !== 0) return { outcome: "detached" };
  const branch = symref.stdout.trim();
  const sha = r.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const slug = basename(siblingCwd);
  const row = `${slug}\t${sha}\t${branch}\n`;
  return { outcome: "ok", row, slug, sha, branch };
}

/** Render baseline rows into the full sibling-baseline.txt body (byte-identical). */
export function formatBaselineFile(rows: string[]): string { return rows.join(""); }

export interface BaselineRow { slug: string; sha: string; branch: string; }
/** Parse sibling-baseline.txt; skips blanks; preserves tabs in the branch field via slice(2). */
export function parseBaselineFile(body: string): BaselineRow[] {
  const out: BaselineRow[] = [];
  for (const line of body.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    out.push({ slug: parts[0], sha: parts[1], branch: parts.slice(2).join("\t") });
  }
  return out;
}

export type DiffOutcome = "ok" | "not-git" | "unknown-baseline" | "missing-branch";
export interface DiffResult { outcome: DiffOutcome; log?: string; }

/** Rogue-commit log for sibling-rogue.txt; strips exactly one trailing newline (NOT trim). */
export function diffSiblingAgainstBaseline(r: Runner, baselineSha: string, branch: string): DiffResult {
  if (r.run("git", ["rev-parse", "--git-dir"]).code !== 0) return { outcome: "not-git" };
  if (r.run("git", ["rev-parse", "--verify", "-q", baselineSha]).code !== 0) return { outcome: "unknown-baseline" };
  if (r.run("git", ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).code !== 0) return { outcome: "missing-branch" };
  const log = r.run("git", ["log", `${baselineSha}..refs/heads/${branch}`, "--oneline"]).stdout.replace(/\n$/, "");
  return { outcome: "ok", log };
}

/** sibling-rogue.txt block for one sibling: `<slug>\n<log>\n`, only when log is non-empty. */
export function formatRogueBlock(slug: string, log: string): string {
  if (log.length === 0) return "";
  return `${slug}\n${log}\n`;
}

export type RevertReplayOutcome =
  | "ok" | "rescue-exists" | "branch-create-failed" | "checkout-rescue-failed"
  | "cherry-pick-conflict" | "checkout-back-failed" | "revert-conflict";
export interface RevertReplayResult { outcome: RevertReplayOutcome; rescue: string; failedSha?: string; }

/** Rescue branch name (the _deploy/->_perform/ rename). */
export function rescueBranchName(topic: string): string { return `feat/perform-${topic}-rescue`; }

/** Two-phase rescue. `r` bound to the sibling cwd; `shaList` oldest-first. No real git in tests. */
export function revertAndReplay(r: Runner, topic: string, baselineSha: string, branch: string, shaList: string[]): RevertReplayResult {
  const rescue = rescueBranchName(topic);
  if (r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${rescue}`]).code === 0) {
    return { outcome: "rescue-exists", rescue };
  }
  if (r.run("git", ["branch", rescue, baselineSha]).code !== 0) return { outcome: "branch-create-failed", rescue };
  if (r.run("git", ["checkout", "-q", rescue]).code !== 0) return { outcome: "checkout-rescue-failed", rescue };
  for (const sha of shaList) {
    if (r.run("git", ["cherry-pick", sha]).code !== 0) {
      r.run("git", ["cherry-pick", "--abort"]);
      r.run("git", ["checkout", "-q", branch]);
      return { outcome: "cherry-pick-conflict", rescue, failedSha: sha };
    }
  }
  if (r.run("git", ["checkout", "-q", branch]).code !== 0) return { outcome: "checkout-back-failed", rescue };
  for (let i = shaList.length - 1; i >= 0; i--) {
    const sha = shaList[i];
    if (r.run("git", ["revert", "--no-edit", sha]).code !== 0) {
      r.run("git", ["revert", "--abort"]);
      return { outcome: "revert-conflict", rescue, failedSha: sha };
    }
  }
  return { outcome: "ok", rescue };
}
