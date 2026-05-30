// src/commands/playback.ts — /consort:playback verbs. survey = read-only list + trend digest;
// archive = accrue trend + move surveyed files to .reviewed/. Logic lives in core/playback.ts.
// Port of the prior plugin's review-forensics.sh + forensics-mark-reviewed.sh (review half).
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, renameSync, type Dirent } from "node:fs";
import { join, dirname } from "node:path";
import { log } from "../core/log.js";
import { globalRoot } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import {
  parseForensicsFrontmatter, parseMechanicalFindings, parseSince,
  parseTrendLedger, accrue, renderTrendDigest, reviewedTarget,
} from "../core/playback.js";

function forensicsRoot(): string { return join(globalRoot(), "forensics"); }

/** Walk forensicsRoot for *.md files; exclude the top-level `.reviewed/` subtree unless included. */
function walkForensics(root: string, includeReviewed: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === root && e.name === ".reviewed" && !includeReviewed) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

function readLedgerText(root: string): string | null {
  try { return readFileSync(join(root, ".trends.json"), "utf8"); } catch { return null; }
}

export interface SurveyOpts { all?: boolean; command?: string; since?: string; now?: number; }

export async function surveyWith(o: SurveyOpts): Promise<number> {
  const root = forensicsRoot();
  let cutoff: number | null = null;
  if (o.since) { try { cutoff = parseSince(o.since, o.now ?? Date.now()); } catch (e: any) { log.error(`playback survey: ${e?.message ?? e}`); return 2; } }
  const files = walkForensics(root, Boolean(o.all));
  let n = 0;
  for (const f of files) {
    let text: string; try { text = readFileSync(f, "utf8"); } catch { continue; }
    const meta = parseForensicsFrontmatter(text);
    if (o.command && meta.command !== o.command) continue;
    if (cutoff !== null) { let mt = 0; try { mt = statSync(f).mtimeMs; } catch { /* */ } if (mt < cutoff) continue; }
    process.stdout.write(`${f}\t${meta.command}\t${meta.topic}\t${meta.nFindings}\n`);
    n++;
  }
  process.stdout.write("TRENDS\n");
  for (const t of renderTrendDigest(parseTrendLedger(readLedgerText(root)), 20)) {
    process.stdout.write(`${t.signature}\t${t.count}\t${t.firstSeen}\t${t.lastSeen}\n`);
  }
  log.info(`playback survey: ${n} forensics file(s)`);
  return 0;
}

export interface ArchiveOpts { now?: Date; }

export async function archiveWith(paths: string[], o: ArchiveOpts = {}): Promise<number> {
  const root = forensicsRoot();
  const ledger = parseTrendLedger(readLedgerText(root));
  const date = (o.now ?? new Date()).toISOString().slice(0, 10);
  let moved = 0;
  for (const p of paths) {
    const target = reviewedTarget(root, p);
    if (target === null) { log.warn(`playback archive: skip (not under forensics root): ${p}`); continue; }
    if (target === p) { log.info(`playback archive: already reviewed: ${p}`); continue; }
    let text: string;
    try { text = readFileSync(p, "utf8"); } catch { log.warn(`playback archive: skip (unreadable): ${p}`); continue; }
    const findings = parseMechanicalFindings(text);
    try { mkdirSync(dirname(target), { recursive: true }); renameSync(p, target); }
    catch (e: any) { log.warn(`playback archive: move failed for ${p}: ${e?.message ?? e}`); continue; }
    accrue(ledger, findings, date);                       // only after a successful move
    moved++;
  }
  atomicWrite(join(root, ".trends.json"), JSON.stringify(ledger, null, 2) + "\n");
  log.ok(`playback archive: ${moved} file(s) moved to .reviewed/, trend updated`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0]; const rest = args.slice(1);
  if (verb === "survey") {
    const o: SurveyOpts = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--all") o.all = true;
      else if (rest[i] === "--command") o.command = rest[++i];
      else if (rest[i] === "--since") o.since = rest[++i];
      else { log.error(`playback survey: unknown flag '${rest[i]}'`); return 2; }
    }
    return surveyWith(o);
  }
  if (verb === "archive") {
    if (rest.length === 0) { log.error("usage: playback archive <path...>"); return 2; }
    return archiveWith(rest);
  }
  log.error("usage: playback <survey|archive> ...");
  return 2;
}
