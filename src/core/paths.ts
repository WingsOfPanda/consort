import { createHash } from "node:crypto";
import { realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync, mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

export function globalRoot(home?: string): string {
  return home ?? process.env.CONSORT_HOME ?? join(homedir(), ".consort");
}

export function stateRoot(opts?: { home?: string; cwd?: string }): string {
  if (opts?.home) return opts.home;
  if (process.env.CONSORT_HOME) return process.env.CONSORT_HOME;
  return join(opts?.cwd ?? process.cwd(), ".consort");
}

function ensureGitignore(dir: string): void {
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, "*\n");
}

export function stateEnsure(): string {
  const root = stateRoot();
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(join(root, "archive"), { recursive: true });
  ensureGitignore(root);
  return root;
}

export function repoHash(cwd: string = process.cwd()): string {
  let real: string;
  try { real = realpathSync(cwd); } catch { real = cwd; }
  return createHash("sha256").update(real, "utf8").digest("hex");
}

export function repoStateDir(opts?: { home?: string; cwd?: string }): string {
  return join(stateRoot(opts), "state", repoHash(opts?.cwd));
}
export function topicDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(repoStateDir(opts), topic);
}
export function partDir(instrument: string, model: string, topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(topicDir(topic, opts), `${instrument}-${model}`);
}

export function repoRoot(cwd: string = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return cwd;
  }
}

export function isArtifactDir(p: string): boolean {
  return basename(p.replace(/\/+$/, "")).startsWith("_");
}

export function runDir(command: string, opts?: { sweepSecs?: number }): string {
  if (!command) throw new Error("runDir: missing <command> arg");
  const root = stateEnsure();
  const runRoot = join(root, "_run");
  mkdirSync(runRoot, { recursive: true });
  ensureGitignore(runRoot);
  const sweepMs = (opts?.sweepSecs ?? 86400) * 1000;
  for (const name of readdirSync(runRoot)) {
    const child = join(runRoot, name);
    try {
      const st = statSync(child);
      if (st.isDirectory() && Date.now() - st.mtimeMs > sweepMs) rmSync(child, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  const dir = mkdtempSync(join(runRoot, `${command}.`));
  writeFileSync(join(runRoot, ".last"), dir); // no trailing newline
  return dir;
}

export function runDirLast(): string {
  const last = join(stateRoot(), "_run", ".last");
  if (!existsSync(last)) throw new Error("runDirLast: .last missing — call runDir first");
  return readFileSync(last, "utf8");
}

export function runArgsFile(command: string, prefix?: string): string {
  const dir = runDir(command);
  const argsDir = join(stateRoot(), "_args");
  mkdirSync(argsDir, { recursive: true });
  const f = mkdtempSync(join(argsDir, `${prefix ?? command}.`)) + "/args";
  writeFileSync(f, ""); // placeholder file at a unique path
  writeFileSync(join(dir, "args-path.txt"), f); // no trailing newline
  return f;
}

export function activeProvidersPath(gRoot: string = globalRoot()): string {
  const active = join(gRoot, "providers-active.txt");
  return existsSync(active) ? active : join(gRoot, "providers-available.txt");
}
