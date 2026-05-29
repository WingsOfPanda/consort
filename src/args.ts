import { readFileSync, existsSync, rmSync } from "node:fs";

export class ArgsFileError extends Error { code = 2; }
export class KvError extends Error { code = 2; constructor(public flag: string) { super(`${flag} requires a value`); } }

export function tokenizeArgsLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inS = false, inD = false, started = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (inS) { if (ch === "'") inS = false; else cur += ch; continue; }
    if (inD) { if (ch === '"') inD = false; else cur += ch; continue; }
    if (ch === "'") { inS = true; started = true; continue; }
    if (ch === '"') { inD = true; started = true; continue; }
    if (ch === " " || ch === "\t") { if (started) { out.push(cur); cur = ""; started = false; } continue; }
    cur += ch; started = true;
  }
  if (started) out.push(cur);
  return out;
}

export function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const first = readFileSync(path, "utf8").split("\n")[0] ?? "";
  return tokenizeArgsLine(first);
}

export function consumeArgsFile(path: string | undefined): void {
  if (!path) return;
  try { rmSync(path, { force: true }); } catch { /* ignore */ }
}

export function applyArgsFile(argv: string[]): string[] {
  if (argv[0] !== "--args-file") return [...argv];
  const path = argv[1];
  if (!path) throw new ArgsFileError("--args-file requires a path");
  const tokens = loadArgsFile(path);
  consumeArgsFile(path);
  return [...tokens, ...argv.slice(2)];
}

export interface KvParseResult { value: string; shift: 1 | 2; }
export function kvParse(flag: string, next?: string): KvParseResult {
  if (flag.includes("=")) return { value: flag.slice(flag.indexOf("=") + 1), shift: 1 };
  if (next === undefined) throw new KvError(flag);
  return { value: next, shift: 2 };
}
