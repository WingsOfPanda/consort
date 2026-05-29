import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "../core/log.js";
import { haveCmd, inTmuxSession, tmuxVersionOk, tmuxVersionString } from "../core/deps.js";
import { globalRoot } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import { contractsExist, listInstruments, instrumentBinary } from "../core/contracts.js";

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

const pluginRoot = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();

export async function run(_args: string[]): Promise<number> {
  let fail = 0, warn = 0, ok = 0, total = 0;
  const root = globalRoot();
  try { mkdirSync(root, { recursive: true }); } catch { /* writable check below reports it */ }

  const ver = tmuxVersionString();
  if (!ver) { log.error("tmux: not on PATH (install: https://github.com/tmux/tmux)"); fail = 1; }
  else if (!tmuxVersionOk(ver)) { log.error(`tmux: ${ver} — consort requires >= 3.0`); fail = 1; }
  else log.ok(`tmux: ${ver}`);

  if (inTmuxSession()) log.ok(`tmux session: ${process.env.TMUX} is set`);
  else { log.warn("tmux session: not set — `tmux new -s consort` before spawning"); warn = 1; }

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

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  atomicWrite(join(globalRoot(), "providers-available.txt"),
    `# generated ${stamp} by /consort:soundcheck\n# providers detected with binary on PATH + contracts.yaml row\n${detected.join("\n")}${detected.length ? "\n" : ""}`);

  if (fail !== 0 || ok === 0) {
    if (ok === 0 && total > 0) log.error(`no providers available; install at least one of: ${listInstruments().join(" ")}`);
    process.stdout.write("Verdict: FAIL — fix items above before spawning\n");
    return 1;
  }
  process.stdout.write(`Verdict: OK — ready to spawn (${ok}/${total} providers available; ${warn} warnings)\n`);
  return 0;
}
