// src/commands/score.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import {
  deriveSlug, parseScoreArgs, scoreArtDir, scoreDraftDir,
  formatRosterFile, scoreDocPath, parseMultiRepoMode, type RosterRow,
} from "../core/score.js";
import { assembleDoc, SECTIONS_SINGLE, SECTIONS_MULTI, type DocMode } from "../core/scoreDoc.js";
import { auditDoc } from "../core/audit.js";
import { readProviderList } from "../core/providers.js";
import { activeProvidersPath } from "../core/paths.js";
import { instrumentConsultValidated } from "../core/contracts.js";
import { pickInstruments } from "../core/instruments.js";

function usage(): number { log.error("usage: score <init|assemble> ..."); return 2; }

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest));
    case "assemble": return assembleRun(rest);
    default: return usage();
  }
}

export interface ScoreInitDeps {
  activeProviders(): string[];
  isValidated(provider: string): boolean;
  pickInstruments(topic: string, n: number): string[];
}
const liveInitDeps: ScoreInitDeps = {
  activeProviders: () => readProviderList(activeProvidersPath()),
  isValidated: instrumentConsultValidated,
  pickInstruments,
};

async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: ScoreInitDeps): Promise<number> {
  const { topicText, ensemble, targets } = parseScoreArgs(tokens);
  if (!topicText) { log.error("score init: topic text is empty"); return 1; }
  const topic = deriveSlug(topicText);
  if (!topic) { log.error("score init: topic produced an empty slug; provide alphanumerics"); return 1; }

  let roster = d.activeProviders().filter((p) => d.isValidated(p));
  if (roster.length < 2) {
    log.error(`score init: needs >=2 consult-validated providers; got ${roster.length}`);
    log.error("  just ask Claude directly (this session) — no /consort:score orchestration needed");
    return 1;
  }
  if (roster.length > 3) { log.warn(`score init: ${roster.length} providers available; capping the ensemble to the first 3`); roster = roster.slice(0, 3); }

  const art = scoreArtDir(topic);
  if (existsSync(art)) { log.error(`score init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different topic"); return 2; }

  const instruments = d.pickInstruments(topic, roster.length);
  if (instruments.length < roster.length) { log.error(`score init: instrument pool exhausted (need ${roster.length}, got ${instruments.length})`); return 1; }
  const rows: RosterRow[] = roster.map((provider, i) => ({ provider, instrument: instruments[i] }));

  mkdirSync(scoreDraftDir(topic), { recursive: true }); // creates _score/design-doc/.draft
  atomicWrite(join(art, "topic.txt"), topicText);
  atomicWrite(join(art, "roster.txt"), formatRosterFile(rows, isoUtc()));
  const mode = targets.length >= 2 ? "multi" : targets.length === 1 ? "single-sub" : "single";
  atomicWrite(join(art, "multi-repo.txt"), mode + "\n");
  if (targets.length > 0) atomicWrite(join(art, "targets.txt"), `# generated ${isoUtc()} by /consort:score\n${targets.join("\n")}\n`);

  log.ok(`score init: topic=${topic} N=${rows.length} ensemble=${ensemble ? "yes" : "no"} mode=${mode}`);
  process.stdout.write(
    `TOPIC=${topic}\nN=${rows.length}\nENSEMBLE=${ensemble ? "yes" : "no"}\nMODE=${mode}\n` +
    rows.map((r) => `PART=${r.instrument}:${r.provider}`).join("\n") + "\n",
  );
  return 0;
}

function readIf(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }

async function assembleRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score assemble <topic>"); return 2; }
  const art = scoreArtDir(topic);
  const draftDir = scoreDraftDir(topic);
  if (!existsSync(draftDir)) { log.error(`score assemble: no draft dir at ${draftDir} (run score init + draft sections)`); return 2; }

  const title = (readIf(join(art, "topic.txt")).split("\n")[0] || topic).trim();
  const mode: DocMode = parseMultiRepoMode(readIf(join(art, "multi-repo.txt")));
  const targets = mode === "single" ? [] : parseRosterTargets(readIf(join(art, "targets.txt")));
  const keys = mode === "multi" ? SECTIONS_MULTI : SECTIONS_SINGLE;
  const drafts = new Map<string, string>();
  for (const k of keys) { const f = join(draftDir, `${k}.md`); if (existsSync(f)) drafts.set(k, readFileSync(f, "utf8").replace(/\n+$/, "")); }

  const date = isoUtc().slice(0, 10);
  const doc = assembleDoc({ title, mode, date, targets, drafts });
  const out = scoreDocPath(topic, date);
  mkdirSync(join(art, "design-doc"), { recursive: true });
  atomicWrite(out, doc);

  const result = auditDoc(doc);
  const auditText = [`VERDICT=${result.verdict}`, ...result.issues.map((i) => `ISSUE=${i}`)].join("\n") + "\n";
  atomicWrite(join(art, "design-doc", "audit.log"), auditText);
  if (result.verdict === "FAIL") {
    for (const i of result.issues) process.stderr.write(`ISSUE=${i}\n`);
    log.error(`score assemble: audit FAILED on ${out} (see design-doc/audit.log)`);
    return 1;
  }
  log.ok(`score assemble: audit PASSED`);
  process.stdout.write(out + "\n");
  return 0;
}

/** targets.txt may be a plain slug-per-line list (init) or a TSV (multi-repo detect, Phase E). */
function parseRosterTargets(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.split("\t")[0]).filter(Boolean);
}
