import { execFileSync } from "node:child_process";

export function haveCmd(name: string): boolean {
  try {
    // `name` is passed as $1 (never interpolated into the command string) → injection-safe + no DEP0190.
    execFileSync("/bin/sh", ["-c", 'command -v "$1"', "sh", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function tmuxVersionString(run?: () => string | null): string | null {
  if (run) return run();
  if (!haveCmd("tmux")) return null;
  try {
    return execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function tmuxVersionOk(versionString?: string): boolean {
  const v = versionString ?? tmuxVersionString();
  if (!v) return false;
  const stripped = v.replace(/^tmux /, "");
  const majorRaw = stripped.split(".")[0] ?? "";
  const major = parseInt(majorRaw.replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(major) && major >= 3;
}

export function inTmuxSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TMUX);
}
