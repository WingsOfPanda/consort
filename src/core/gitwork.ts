// src/core/gitwork.ts
import { execFileSync } from "node:child_process";

export interface RunResult { code: number; stdout: string; }
export interface Runner { run(cmd: string, args: string[]): RunResult; }

/** A cwd-bound synchronous command runner. execFileSync — never shell. */
export function runnerAt(cwd: string): Runner {
  return {
    run(cmd, args) {
      try {
        const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { code: 0, stdout };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: Buffer | string };
        return { code: typeof err.status === "number" ? err.status : 1, stdout: err.stdout != null ? String(err.stdout) : "" };
      }
    },
  };
}

export function classifyDirty(porcelain: string): boolean { return porcelain.trim().length > 0; }
export function finishAutoAction(remotes: string): "pr" | "keep" { return remotes.trim().length > 0 ? "pr" : "keep"; }

export interface SnapshotResult {
  branch: string;
  baseSha: string;
  state: "clean" | "wip-committed" | "hook-blocked" | "not-git";
}

/** Capture branch + base SHA; if the tree is dirty, commit a WIP snapshot on the current branch. */
export function preSnapshot(r: Runner, topic: string): SnapshotResult {
  if (r.run("git", ["rev-parse", "--git-dir"]).code !== 0) return { branch: "", baseSha: "", state: "not-git" };
  const branch = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)";
  const preSha = r.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  if (!classifyDirty(r.run("git", ["status", "--porcelain"]).stdout)) {
    return { branch, baseSha: preSha, state: "clean" };
  }
  r.run("git", ["add", "-A"]);
  if (r.run("git", ["commit", "-q", "-m", `chore: WIP before solo ${topic}`]).code !== 0) {
    return { branch, baseSha: preSha, state: "hook-blocked" };
  }
  return { branch, baseSha: r.run("git", ["rev-parse", "HEAD"]).stdout.trim(), state: "wip-committed" };
}

/** Create feat/solo-<topic> from current HEAD, or resume it if it already exists. */
export function createOrResumeBranch(r: Runner, name: string): boolean {
  if (r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).code === 0) {
    return r.run("git", ["checkout", "-q", name]).code === 0;
  }
  return r.run("git", ["checkout", "-q", "-b", name]).code === 0;
}

export function shortstat(r: Runner, base: string): string {
  return r.run("git", ["diff", "--shortstat", `${base}..HEAD`]).stdout.trim();
}

export interface FinishOpts {
  branch: string;
  startBranch: string;
  hasGh: boolean;
  originUrl?: string;
  title?: string;
  body?: string;
}
export interface FinishResult { action: "pr" | "keep"; outcome: string; }

/** Auto finish: remote → push + gh PR; none → keep. Always restores the start-branch checkout. Best-effort. */
export function finishBranch(r: Runner, o: FinishOpts): FinishResult {
  const action = finishAutoAction(r.run("git", ["remote"]).stdout);
  if (action === "keep") {
    r.run("git", ["checkout", "-q", o.startBranch]);
    return { action, outcome: "kept" };
  }
  let outcome: string;
  if (r.run("git", ["push", "-q", "-u", "origin", o.branch]).code === 0) {
    const url = o.originUrl ?? r.run("git", ["remote", "get-url", "origin"]).stdout.trim();
    const title = o.title ?? `solo: ${o.branch}`;
    const body = o.body ?? `Automated solo branch. Review and merge into ${o.startBranch}.`;
    if (o.hasGh && r.run("gh", ["pr", "create", "--repo", url, "--base", o.startBranch, "--head", o.branch, "--title", title, "--body", body]).code === 0) {
      outcome = "pr-opened";
    } else {
      outcome = "pr-pushed-no-gh";
    }
  } else {
    outcome = "pr-failed-kept";
  }
  r.run("git", ["checkout", "-q", o.startBranch]);
  return { action, outcome };
}
