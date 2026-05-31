import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "../core/log.js";
import { haveCmd, inTmuxSession, tmuxVersionOk, tmuxVersionString } from "../core/deps.js";
import { globalRoot, pluginRoot } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import { contractsExist, listInstruments, instrumentBinary, instrumentConsultValidated } from "../core/contracts.js";
import { readProviderList, planRoster, formatActiveFile, formatProviderFile } from "../core/providers.js";
import { isoUtc } from "../core/archive.js";

export interface PermissionResult { rc: 0 | 1 | 2; message?: string; configPath?: string; }

export function opencodeConfigPath(cwd = process.cwd(), home = homedir()): string | null {
  const proj = join(cwd, "opencode.json");
  if (existsSync(proj)) return proj;
  const glob = join(home, ".config", "opencode", "opencode.json");
  return existsSync(glob) ? glob : null;
}

export function opencodePermissionCheck(cfgPath?: string): PermissionResult {
  const p = cfgPath ?? opencodeConfigPath();
  if (!p || !existsSync(p)) return { rc: 1, message: "no opencode.json found" };
  let obj: any;
  try { obj = JSON.parse(readFileSync(p, "utf8")); } catch { return { rc: 1, message: "opencode.json: unparseable", configPath: p }; }
  const perm = obj?.permission;
  if (perm === "allow") return { rc: 0, configPath: p };
  if (typeof perm === "string") return { rc: 1, message: `opencode.json: permission is '${perm}' (need 'allow' for part auto-approve)`, configPath: p };
  if (perm && typeof perm === "object") return { rc: 2, message: "opencode.json: object-form permission detected; soundcheck does not introspect per-tool keys", configPath: p };
  return { rc: 1, message: "opencode.json: no top-level 'permission' key (defaults to 'ask')", configPath: p };
}

const availablePath = (): string => join(globalRoot(), "providers-available.txt");
const activePath = (): string => join(globalRoot(), "providers-active.txt");

export async function run(args: string[]): Promise<number> {
  if (args[0] === "roster-plan") return rosterPlan();
  if (args[0] === "roster-set") return rosterSet(args.slice(1));
  return healthCheck();
}

function partitionAvailable(): { available: string[]; detected: string[]; skipped: string[] } {
  const available = readProviderList(availablePath());
  const detected: string[] = [];
  const skipped: string[] = [];
  for (const p of available) {
    if (instrumentConsultValidated(p)) detected.push(p);
    else skipped.push(`${p} (consult_validated: false)`);
  }
  return { available, detected, skipped };
}

function rosterPlan(): number {
  const { detected, skipped } = partitionAvailable();
  const prior = readProviderList(activePath());
  const plan = planRoster({ detectedValidated: detected, prior });
  process.stdout.write(JSON.stringify({ ...plan, skipped }) + "\n");
  return 0;
}

function rosterSet(providers: string[]): number {
  if (providers.length === 0) {
    log.error("must select at least one provider; selection unchanged");
    return 1;
  }
  const valid = new Set(partitionAvailable().detected);
  const bad = providers.filter((p) => !valid.has(p));
  if (bad.length > 0) {
    log.error(`not in the detected validated set: ${bad.join(", ")}; selection unchanged`);
    return 1;
  }
  const root = globalRoot();
  mkdirSync(root, { recursive: true });
  atomicWrite(activePath(), formatActiveFile(providers, isoUtc()));
  process.stdout.write(`active set: ${providers.join(", ")} (written to providers-active.txt)\n`);
  return 0;
}

/** Restores the predecessor plugin's medic pane-border check (cosmetic — always WARN, never FAIL).
 *  Part labels render on the border only when pane-border-status is top/bottom AND
 *  pane-border-format reads the @cs_ user-options. A stale format keyed to the old (pre-rebrand)
 *  user-options makes consort parts fall back to the raw pane_title. Pure for testing; the live
 *  tmux query lives in healthCheck. */
export function paneBorderDiagnosis(pbs: string, pbf: string): { ok: boolean; lines: string[] } {
  const fix = [
    "  fix: `consort` spawn sets this automatically, or add to ~/.tmux.conf:",
    "    set -g pane-border-status top",
    "    set -g pane-border-format ' #{?@cs_label_fmt,#{@cs_label_fmt},#[fg=#{?@cs_color,#{@cs_color},default}#,bold]#{?@cs_label,#{@cs_label},#{pane_title}}#[default]} '",
  ];
  if (pbs !== "top" && pbs !== "bottom") {
    return { ok: false, lines: [`pane-border-status is '${pbs || "off"}'; part labels won't render on pane borders`, ...fix] };
  }
  if (!pbf.includes("@cs_label")) {
    return { ok: false, lines: ["pane-border-format doesn't read @cs_label; consort part names won't show on pane borders", ...fix] };
  }
  return { ok: true, lines: [`pane-border: status=${pbs}, format @cs_label-aware (part names visible)`] };
}

function tmuxGlobalOption(name: string): string {
  try { return execFileSync("tmux", ["show-options", "-gv", name], { encoding: "utf8" }).trim(); } catch { return ""; }
}

function healthCheck(): number {
  let fail = 0, warn = 0, ok = 0, total = 0;
  const root = globalRoot();
  try { mkdirSync(root, { recursive: true }); } catch { /* writable check below reports it */ }

  const ver = tmuxVersionString();
  if (!ver) { log.error("tmux: not on PATH (install: https://github.com/tmux/tmux)"); fail = 1; }
  else if (!tmuxVersionOk(ver)) { log.error(`tmux: ${ver} — consort requires >= 3.0`); fail = 1; }
  else log.ok(`tmux: ${ver}`);

  if (inTmuxSession()) {
    log.ok(`tmux session: ${process.env.TMUX} is set`);
    const diag = paneBorderDiagnosis(tmuxGlobalOption("pane-border-status"), tmuxGlobalOption("pane-border-format"));
    if (diag.ok) log.ok(`  ${diag.lines[0]}`);
    else { for (const l of diag.lines) log.warn(l); warn = 1; }
  } else { log.warn("tmux session: not set — `tmux new -s consort` before spawning"); warn = 1; }

  if (existsSync(root)) log.ok(`state dir: ${root} (writable)`);
  else { log.error(`state dir: ${root} cannot be created or is not writable`); fail = 1; }

  for (const f of ["contracts.yaml", "instruments.yaml"]) {
    const dest = join(globalRoot(), f);
    if (existsSync(dest)) log.ok(`config: ${f}`);
    else {
      const shipped = join(pluginRoot(), "config", f);
      if (existsSync(shipped)) { try { copyFileSync(shipped, dest); log.ok(`config: ${f} (copied default into state dir)`); } catch { log.error(`config: ${f} missing; copy from plugin defaults failed`); fail = 1; } }
      else { log.error(`config: ${f} not in state dir and not shipped at ${shipped}`); fail = 1; }
    }
  }

  const detected: string[] = [];
  if (!contractsExist()) { log.error(`contracts.yaml not found at ${join(globalRoot(), "contracts.yaml")}`); fail = 1; }
  else {
    for (const prov of listInstruments()) {
      total++;
      const bin = instrumentBinary(prov);
      if (!bin) { log.warn(`  ${prov}: binary field missing in contracts.yaml`); continue; }
      if (haveCmd(bin)) { log.ok(`  ${prov} (${bin}): installed`); ok++; detected.push(prov); }
      else log.warn(`  ${prov} (${bin}): not on PATH — skip if you don't use this provider`);
    }
    if (detected.includes("opencode")) {
      const r = opencodePermissionCheck();
      if (r.rc === 0) log.ok("  opencode auto-approve: 'permission: allow' detected");
      else log.warn(`  opencode auto-approve: ${r.message}${r.rc === 2 ? " (non-fatal)" : ""}`);
    }
  }

  atomicWrite(availablePath(), formatProviderFile(detected, isoUtc(), "providers detected with binary on PATH + contracts.yaml row"));

  if (fail !== 0 || ok === 0) {
    if (ok === 0 && total > 0) log.error(`no providers available; install at least one of: ${listInstruments().join(" ")}`);
    process.stdout.write("Verdict: FAIL — fix items above before spawning\n");
    return 1;
  }
  process.stdout.write(`Verdict: OK — ready to spawn (${ok}/${total} providers available; ${warn} warnings)\n`);
  return 0;
}
