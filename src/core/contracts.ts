import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { globalRoot, pluginRoot } from "./paths.js";

export function contractsPath(): string {
  const user = join(globalRoot(), "contracts.yaml");
  return existsSync(user) ? user : join(pluginRoot(), "config", "contracts.yaml");
}

export interface Instrument {
  binary?: string;
  modes?: Record<string, string[]>;
  default_mode?: string;
  ready_timeout_s?: number;
  bootstrap_sleep_s?: number;
  timeout_multiplier?: unknown;
  consult_validated?: boolean;
}
type Doc = Record<string, any>;

function load(): Doc {
  const p = contractsPath();
  if (!existsSync(p)) return {};
  try { return (parse(readFileSync(p, "utf8")) as Doc) ?? {}; } catch { return {}; }
}

export function listInstruments(): string[] {
  return Object.keys(load()).filter((k) => k !== "consult");
}
function inst(name: string): Instrument | undefined {
  const d = load(); return name !== "consult" ? (d[name] as Instrument) : undefined;
}

export function instrumentBinary(name: string): string | undefined { return inst(name)?.binary || undefined; }
export function instrumentDefaultMode(name: string): string | undefined { return inst(name)?.default_mode || undefined; }
export function instrumentModeArgs(name: string, mode: string): string[] | undefined {
  const m = inst(name)?.modes?.[mode];
  return Array.isArray(m) ? m.map(String) : undefined;
}
export function instrumentReadyTimeout(name: string): number {
  const v = inst(name)?.ready_timeout_s;
  return typeof v === "number" ? v : 30;
}
export function instrumentBootstrapSleep(name: string): number {
  const v = inst(name)?.bootstrap_sleep_s;
  if (typeof v === "number") return v;
  return name === "claude" ? 12 : 8;
}
export function instrumentTimeoutMultiplier(name: string): string {
  const raw = inst(name)?.timeout_multiplier;
  const s = raw == null ? "" : String(raw);
  if (/^[0-9]+(\.[0-9]+)?$/.test(s) && Number(s) > 0) return s;
  return "1.0";
}
export function instrumentConsultValidated(name: string): boolean {
  if (!name) throw new TypeError("instrumentConsultValidated: missing provider arg");
  return inst(name)?.consult_validated === true;
}

export type ConsultKind = "research" | "verify" | "adversary" | "experiment";
const CONSULT_DEFAULTS: Record<ConsultKind, number> = { research: 600, verify: 300, adversary: 600, experiment: 1800 };
export function consultTimeout(kind: ConsultKind): number {
  if (!(kind in CONSULT_DEFAULTS)) throw new Error(`consultTimeout: kind must be 'research', 'verify', 'adversary', or 'experiment'; got '${kind}'`);
  const v = (load().consult ?? {})[`${kind}_timeout_s`];
  return /^[1-9][0-9]*$/.test(String(v)) ? Number(v) : CONSULT_DEFAULTS[kind];
}

export function contractsExist(): boolean { return existsSync(contractsPath()); }
