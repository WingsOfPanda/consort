import { execa } from "execa";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { labelFor, colorFor, labelFmt } from "./colors.js";

// ---------- pure arg builders (unit-tested) ----------
export function splitRightArgs(launch: string, target?: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-h"];
  if (target) a.push("-t", target);
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function splitDownArgs(launch: string, target: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", target];
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function respawnArgs(pane: string, launch: string, cwd?: string): string[] {
  const a = ["respawn-pane", "-k", "-t", pane];
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function setOptionArgs(pane: string, opt: string, val: string): string[] {
  return ["set-option", "-p", "-t", pane, opt, val];
}
export function sendKeysLiteralArgs(pane: string, line: string): string[] {
  return ["send-keys", "-t", pane, "-l", line];
}
export function sendKeysEnterArgs(pane: string): string[] {
  return ["send-keys", "-t", pane, "Enter"];
}

// Pane-border config so the per-pane @cs_label_fmt (stamped by paneLabelSet) actually renders on the
// pane border. Without it the border shows the program's own pane title (the raw TUI name). Rebranded
// port of the prior bash plugin's tmux.conf convention to the @cs_ user-options; falls back to #{pane_title}
// for panes with no @cs_ label (e.g. the conductor). The `#,` is an escaped comma inside #[...].
export function paneBorderArgs(): string[][] {
  return [
    ["set-option", "-g", "pane-border-status", "top"],
    ["set-option", "-g", "pane-border-format",
      " #{?@cs_label_fmt,#{@cs_label_fmt},#[fg=#{?@cs_color,#{@cs_color},default}#,bold]#{?@cs_label,#{@cs_label},#{pane_title}}#[default]} "],
    ["set-hook", "-g", "after-select-pane",
      'set-option -g pane-active-border-style "fg=#{?@cs_color,#{@cs_color},green}"'],
  ];
}
/** Force pane-border-status on a specific window (by pane or window id) so a window-local
 *  `pane-border-status off` can't suppress the @cs_ part label that paneLabelSet stamped. */
export function windowBorderStatusArgs(target: string): string[] {
  return ["set-option", "-w", "-t", target, "pane-border-status", "top"];
}
export function wrapLaunch(launch: string, hasBashrc: boolean = existsSync(join(homedir(), ".bashrc"))): string {
  return hasBashrc ? `bash -ic 'exec ${launch}'` : launch;
}
export function sentinelCommand(labelFmt: string): string {
  // printf the colored label + reserved notice, then hold the pane open.
  return `printf '%s\\n  preflight pane reserved — awaiting spawn...\\n' ${JSON.stringify(labelFmt)}; sleep infinity`;
}

// ---------- execa wrappers (live tmux) ----------
async function tmux(args: string[]): Promise<string> {
  const { stdout } = await execa("tmux", args);
  return stdout.trim();
}
export const splitRight = (launch: string, target?: string, cwd?: string) => tmux(splitRightArgs(launch, target, cwd));
export const splitDown = (launch: string, target: string, cwd?: string) => tmux(splitDownArgs(launch, target, cwd));
// respawn-pane reuses the SAME pane (and prints nothing), so the resulting pane id IS the target.
// Return it explicitly — never the empty stdout, which would leave callers with a blank pane id.
export const respawn = async (pane: string, launch: string, cwd?: string): Promise<string> => {
  await tmux(respawnArgs(pane, launch, cwd));
  return pane;
};

export async function setOption(pane: string, opt: string, val: string): Promise<void> { await tmux(setOptionArgs(pane, opt, val)); }

/** Apply the orchestra pane-border config (idempotent `set -g`) so part labels render on the
 *  border instead of the raw TUI title. Called from spawn; tolerant of tmux errors. Returns
 *  false if any set-option failed (caller may warn). */
export async function ensurePaneBorders(): Promise<boolean> {
  let ok = true;
  for (const a of paneBorderArgs()) { try { await tmux(a); } catch { ok = false; } }
  return ok;
}

/** Set pane-border-status top on `target`'s window; false on tmux error (never throws). */
export async function ensureWindowBorderStatus(target: string): Promise<boolean> {
  try { await tmux(windowBorderStatusArgs(target)); return true; } catch { return false; }
}

export async function paneAlive(pane: string): Promise<boolean> {
  const { stdout } = await execa("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  return stdout.split("\n").includes(pane);
}

export async function paneSend(pane: string, line: string): Promise<void> {
  await execa("tmux", sendKeysLiteralArgs(pane, line));
  await new Promise((r) => setTimeout(r, 300)); // load-bearing beat before Enter
  await execa("tmux", sendKeysEnterArgs(pane));
}

export async function capturePane(pane: string, lines?: number): Promise<string> {
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-t", pane]);
    return lines ? stdout.split("\n").slice(-lines).join("\n") : stdout;
  } catch { return ""; }
}

export async function killNow(pane: string): Promise<void> {
  try { await execa("tmux", ["kill-pane", "-t", pane]); } catch { /* tolerate */ }
}

export async function selectLayoutMainVertical(target: string): Promise<void> {
  await execa("tmux", ["select-layout", "-t", target, "main-vertical"]);
}

export async function conductorPane(): Promise<string> {
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return tmux(["display-message", "-p", "#{pane_id}"]);
}

// --- pane labels (the three @cs_* user-options) ---
export function paneLabelSetArgs(pane: string, instrument: string, model: string, topic: string): string[][] {
  return [
    setOptionArgs(pane, "@cs_label", labelFor(instrument, model, topic)),
    setOptionArgs(pane, "@cs_color", colorFor(instrument)),
    setOptionArgs(pane, "@cs_label_fmt", labelFmt(instrument, model, topic)),
  ];
}
export async function paneLabelSet(pane: string, instrument: string, model: string, topic: string): Promise<void> {
  for (const args of paneLabelSetArgs(pane, instrument, model, topic)) await execa("tmux", args);
}

// --- graceful kill with FINE banner ---
export function gracefulRespawnCommand(snap: string, pluginRoot: string, label: string, color: string): string {
  return `cat '${snap}'; node '${pluginRoot}/dist/consort.cjs' _banner '${label}' '${color}'; rm -f '${snap}'`;
}

export async function paneLabel(pane: string): Promise<string> {
  try { return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_label}"])).stdout; } catch { return ""; }
}
export async function paneColor(pane: string): Promise<string> {
  try { return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_color}"])).stdout; } catch { return ""; }
}

export async function killGraceful(pane: string, pluginRoot: string): Promise<void> {
  if (!(await paneAlive(pane))) return;
  const label = (await paneLabel(pane)) || "part";
  const color = await paneColor(pane);
  const snap = join(mkdtempSync(join(tmpdir(), "cs-snap-")), "snap.txt");
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-e", "-t", pane]);
    writeFileSync(snap, stdout);
  } catch { writeFileSync(snap, ""); }
  await respawn(pane, gracefulRespawnCommand(snap, pluginRoot, label, color));
}

// --- preflight grid ---
export interface PreflightEntry { instrument: string; model: string; cwd?: string; }
export async function preflightLayout(topic: string, roster: PreflightEntry[], opts: { writePanes: (tsv: string) => void }): Promise<Array<{ instrument: string; pane: string }>> {
  const conductor = await conductorPane();
  const created: string[] = [];
  const out: Array<{ instrument: string; pane: string }> = [];
  let prev = conductor;
  let flag: "-h" | "-v" = "-h";
  try {
    for (const e of roster) {
      const sentinel = sentinelCommand(labelFmt(e.instrument, e.model, topic));
      const args = ["split-window", "-P", "-F", "#{pane_id}", flag, "-t", prev];
      if (e.cwd) args.push("-c", e.cwd);
      args.push(sentinel);
      const { stdout } = await execa("tmux", args);
      const pane = stdout.trim();
      created.push(pane);
      await paneLabelSet(pane, e.instrument, e.model, topic);
      out.push({ instrument: e.instrument, pane });
      prev = pane;
      flag = "-v";
    }
    await selectLayoutMainVertical(conductor);
    await ensureWindowBorderStatus(conductor);
    opts.writePanes(out.map((o) => `${o.instrument}\t${o.pane}`).join("\n") + "\n");
    return out;
  } catch (e) {
    for (const p of created) { try { await execa("tmux", ["kill-pane", "-t", p]); } catch { /* */ } }
    throw e;
  }
}
