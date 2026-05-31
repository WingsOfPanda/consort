// src/commands/prelude.ts — /consort:prelude CLI verbs (port of meditate). Built on score's DI
// pattern + IPC/wait/archive helpers; meditate-specific logic lives in src/core/prelude*.ts.
// NOTE: verbs are added task-by-task; the dispatcher's switch grows as each verb lands.
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc, archiveTopic } from "../core/archive.js";
import { preludeArtDir, deriveSlug } from "../core/prelude.js";
import { extractHandoffData } from "../core/preludeHandoff.js";
import { runForensics } from "../core/forensics.js";
import { killNow } from "../core/tmux.js";
import {
  type RosterRow, formatRosterFile, parseRosterFile, spawnRosterArg, spawnResultsTsv, spawnTally,
  parsePanesFile, type SpawnResult,
} from "../core/score.js";
import { readProviderList } from "../core/providers.js";
import { activeProvidersPath, repoRoot } from "../core/paths.js";
import { pickInstruments } from "../core/instruments.js";
import { instrumentConsultValidated, consultTimeout, instrumentTimeoutMultiplier } from "../core/contracts.js";
import { classifyTopic } from "../core/preludeLit.js";
import { computeSignals, renderSkipRecord, type Decision } from "../core/preludeConfidence.js";
import { outboxOffset, outboxPath, outboxWaitSince, type OutboxEvent } from "../core/ipc.js";
import { parseLatestOffset, scaledTimeout, researchState, verifyState } from "../core/scoreTurn.js";
import { composePreludeResearchPrompt, composeAdversaryPrompt, litGuidance } from "../core/preludeTurn.js";
import { run as sendRun } from "./send.js";
import { run as spawnRun } from "./spawn.js";
import { run as preflightRun } from "./preflight.js";
import { readIfExists as readIf } from "../core/fsread.js";

function usage(): number {
  log.error("usage: prelude <init|classify|spawn-all|research-send|research-wait|synth-preliminary|" +
    "confidence|adversary-send|adversary-wait|synth-final|forensics|teardown|handoff-extract> ...");
  return 2;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest));
    case "classify": return classifyRun(rest);
    case "spawn-all": return spawnAllRun(rest);
    case "research-send": return researchSendRun(rest);
    case "research-wait": return researchWaitRun(rest);
    case "synth-preliminary": return synthPreliminaryRun(rest);
    case "confidence": return confidenceRun(rest);
    case "adversary-send": return adversarySendRun(rest);
    case "adversary-wait": return adversaryWaitRun(rest);
    case "synth-final": return synthFinalRun(rest);
    case "forensics": return forensicsRun(rest);
    case "teardown": return teardownRun(rest);
    case "handoff-extract": return handoffExtractRun(rest);
    default: return usage();
  }
}

// ---- init ----

export interface PreludeInitDeps {
  activeProviders(): string[];
  isValidated(provider: string): boolean;
  pickInstruments(topic: string, n: number): string[];
}
const livePreludeInitDeps: PreludeInitDeps = {
  activeProviders: () => readProviderList(activeProvidersPath()),
  isValidated: instrumentConsultValidated,
  pickInstruments,
};
async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, livePreludeInitDeps); }

export async function initWith(tokens: string[], d: PreludeInitDeps): Promise<number> {
  const topicText = tokens.join(" ").trim();
  if (!topicText) { log.error("prelude init: topic text is empty"); return 1; }
  const topic = deriveSlug(topicText);
  if (!topic) { log.error("prelude init: topic produced an empty slug; provide alphanumerics"); return 1; }

  let roster = d.activeProviders().filter((p) => d.isValidated(p));
  if (roster.length < 2) {
    log.error(`prelude init: needs >=2 consult-validated providers; got ${roster.length}`);
    log.error("  just ask Claude directly (this session) — no /consort:prelude orchestration needed");
    return 1;
  }
  if (roster.length > 3) { log.warn(`prelude init: ${roster.length} providers available; capping to the first 3`); roster = roster.slice(0, 3); }

  const art = preludeArtDir(topic);
  if (existsSync(art)) { log.error(`prelude init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different topic"); return 2; }

  const instruments = d.pickInstruments(topic, roster.length);
  if (instruments.length < roster.length) { log.error(`prelude init: instrument pool exhausted (need ${roster.length}, got ${instruments.length})`); return 1; }
  const rows: RosterRow[] = roster.map((provider, i) => ({ provider, instrument: instruments[i] }));

  mkdirSync(art, { recursive: true });
  atomicWrite(join(art, "topic.txt"), topicText);
  atomicWrite(join(art, "roster.txt"), formatRosterFile(rows, isoUtc()));

  log.ok(`prelude init: topic=${topic} N=${rows.length}`);
  process.stdout.write(
    `TOPIC=${topic}\nN=${rows.length}\nART=${art}\n` +
    rows.map((r) => `PART=${r.instrument}:${r.provider}`).join("\n") + "\n",
  );
  return 0;
}

// ---- classify (lit auto-detect) ----
export async function classifyRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: prelude classify <topic>"); return 2; }
  const art = preludeArtDir(topic);
  if (!existsSync(art)) { log.error(`prelude classify: ${art} not found (run prelude init)`); return 1; }
  const topicText = readIf(join(art, "topic.txt")).trim();
  const track = classifyTopic(topicText);
  atomicWrite(join(art, "lit-track.txt"), `${track}\nreason: auto-detect via keyword scan\n`);
  log.ok(`prelude classify: lit-track=${track}`);
  return 0;
}

// ---- spawn-all ----
export interface PreludeSpawnAllDeps {
  preflight(args: string[]): Promise<number>;
  spawn(args: string[]): Promise<number>;
  repoRoot(): string;
}
const livePreludeSpawnAllDeps: PreludeSpawnAllDeps = { preflight: preflightRun, spawn: spawnRun, repoRoot };

async function spawnAllRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: prelude spawn-all <topic>"); return 2; }
  return spawnAllWith(topic, livePreludeSpawnAllDeps);
}

export async function spawnAllWith(topic: string, d: PreludeSpawnAllDeps): Promise<number> {
  const art = preludeArtDir(topic);
  const rosterPath = join(art, "roster.txt");
  if (!existsSync(rosterPath)) { log.error(`prelude spawn-all: roster.txt missing at ${rosterPath} (run prelude init)`); return 2; }
  const rows = parseRosterFile(readFileSync(rosterPath, "utf8"));
  if (rows.length < 2) { log.error(`prelude spawn-all: need >=2 parts in roster.txt, got ${rows.length}`); return 2; }

  const pf = await d.preflight([topic, String(rows.length), "--roster", spawnRosterArg(rows), "--art-dir", art]);
  if (pf !== 0) { log.error(`prelude spawn-all: preflight failed (rc=${pf})`); return 2; }

  const panesPath = join(art, "preflight-panes.txt");
  if (!existsSync(panesPath)) { log.error(`prelude spawn-all: preflight wrote no ${panesPath}`); return 2; }
  const panes = parsePanesFile(readFileSync(panesPath, "utf8"));
  const orphans = rows.filter((r) => !panes.has(r.instrument));
  if (orphans.length) { log.error(`prelude spawn-all: parts missing a preflight pane: ${orphans.map((r) => r.instrument).join(", ")}`); return 2; }

  const cwd = d.repoRoot();
  const results: SpawnResult[] = await Promise.all(rows.map(async (r) => {
    const rc = await d.spawn([r.instrument, r.provider, topic, "--target-pane", panes.get(r.instrument)!, "--cwd", cwd]);
    return { instrument: r.instrument, provider: r.provider, rc };
  }));
  atomicWrite(join(art, "spawn-results.tsv"), spawnResultsTsv(results));

  const rc = spawnTally(results.map((r) => r.rc));
  const nOk = results.filter((r) => r.rc === 0).length;
  if (rc === 0) log.ok(`prelude spawn-all: ${nOk}/${rows.length} parts ready`);
  else log.warn(`prelude spawn-all: ${nOk}/${rows.length} parts ready (rc=${rc})`);
  return rc;
}

// ---- research-send / research-wait ----
export interface ResearchSendDeps {
  offsetFor(instrument: string, model: string, topic: string): number;
  send(args: string[]): Promise<number>;
}
const liveResearchSendDeps: ResearchSendDeps = {
  offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)),
  send: sendRun,
};
async function researchSendRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: prelude research-send <topic> <instrument> <provider>"); return 2; }
  return researchSendWith(topic, instrument, provider, liveResearchSendDeps);
}
export async function researchSendWith(topic: string, instrument: string, provider: string, d: ResearchSendDeps): Promise<number> {
  const art = preludeArtDir(topic);
  const stateFile = join(art, `research-${instrument}.txt`);
  if (existsSync(stateFile)) { log.error(`prelude research-send: ${stateFile} exists; rm to retry`); return 1; }
  const topicText = readIf(join(art, "topic.txt")).trim();
  if (!topicText) { log.error(`prelude research-send: topic.txt missing/empty at ${art} (run prelude init)`); return 1; }

  const track = readIf(join(art, "lit-track.txt")).startsWith("ON") ? "ON" : "OFF";
  const findingsPath = join(art, `findings-${instrument}.md`); // art-dir-flat (faithful to meditate)
  const promptFile = join(art, `${instrument}_research_prompt.md`);
  atomicWrite(promptFile, composePreludeResearchPrompt(topicText, findingsPath, litGuidance(track)));

  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);
  const rc = await d.send(["--from", "maestro", instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`prelude research-send: send failed (rc=${rc}); ${stateFile} kept (rm to redo)`); return 1; }
  log.ok(`prelude research-send: ${instrument} offset=${offset}`);
  return 0;
}

export interface ResearchWaitDeps {
  wait(instrument: string, model: string, topic: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null>;
  multiplier(provider: string): string;
}
const liveResearchWaitDeps: ResearchWaitDeps = {
  wait: (i, m, t, off, ev, to) => outboxWaitSince(i, m, t, off, ev, to),
  multiplier: instrumentTimeoutMultiplier,
};
async function researchWaitRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: prelude research-wait <topic> <instrument> <provider>"); return 2; }
  return researchWaitWith(topic, instrument, provider, liveResearchWaitDeps);
}
export async function researchWaitWith(topic: string, instrument: string, provider: string, d: ResearchWaitDeps): Promise<number> {
  const art = preludeArtDir(topic);
  const stateFile = join(art, `research-${instrument}.txt`);
  if (!existsSync(stateFile)) { log.error(`prelude research-wait: ${stateFile} missing (run prelude research-send first)`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`prelude research-wait: OFFSET not set in ${stateFile}`); return 1; }

  const timeout = scaledTimeout(consultTimeout("research"), d.multiplier(provider));
  log.info(`prelude research-wait: ${instrument} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], timeout);

  const findingsPath = join(art, `findings-${instrument}.md`);
  const findingsText = existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : null;
  const fs = researchState(ev, findingsText);
  if (fs === "question" && ev) {
    atomicWrite(join(art, `question-${instrument}.txt`), JSON.stringify(ev) + "\n");
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nFS=question\n`);
  } else {
    appendFileSync(stateFile, `FS=${fs}\n`);
  }
  writeFileSync(join(art, `research-${instrument}.done`), "");
  log.ok(`prelude research-wait: ${instrument} FS=${fs}`);
  return 0;
}

/** Roster rows whose `<prefix>-<instrument>.md` art file is missing/empty → list of the missing filenames. */
function missingRosterArtifacts(art: string, rows: RosterRow[], prefix: string): string[] {
  return rows.filter((r) => !readIf(join(art, `${prefix}-${r.instrument}.md`)).trim()).map((r) => `${prefix}-${r.instrument}.md`);
}

// ---- synth-preliminary (input validator) ----
export async function synthPreliminaryRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: prelude synth-preliminary <topic>"); return 2; }
  const art = preludeArtDir(topic);
  if (!existsSync(art)) { log.error(`prelude synth-preliminary: ${art} not found — run prelude init`); return 1; }
  for (const f of ["topic.txt", "roster.txt"]) {
    if (!readIf(join(art, f)).trim()) { log.error(`prelude synth-preliminary: missing or empty: ${join(art, f)}`); return 1; }
  }
  const rows = parseRosterFile(readIf(join(art, "roster.txt")));
  const missing = missingRosterArtifacts(art, rows, "findings");
  if (missing.length) {
    log.error("prelude synth-preliminary: blocked — missing or empty findings:");
    for (const m of missing) log.error(`  - ${join(art, m)}`);
    return 1;
  }
  const out = join(art, "landscape-draft.md");
  log.ok(`prelude synth-preliminary: inputs validated for ${topic}`);
  process.stdout.write(out + "\n");
  return 0;
}

// ---- confidence (5-signal gate; two-call contract) ----
export async function confidenceRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: prelude confidence <topic> [--decision skip|continue]"); return 2; }
  let decision: Decision | null = null;
  const di = rest.indexOf("--decision");
  if (di >= 0) {
    const v = rest[di + 1];
    if (v !== "skip" && v !== "continue") { log.error("prelude confidence: --decision must be 'skip' or 'continue'"); return 2; }
    decision = v;
  }
  const art = preludeArtDir(topic);
  const draft = readIf(join(art, "landscape-draft.md"));
  if (!draft.trim()) { log.error(`prelude confidence: landscape-draft.md missing/empty at ${art}`); return 1; }
  const rows = parseRosterFile(readIf(join(art, "roster.txt")));
  const findings = rows.map((r) => readIf(join(art, `findings-${r.instrument}.md`)));

  const s = computeSignals(draft, findings);
  log.info(`prelude confidence: S1=${s.s1} S2=${s.s2} S3=${s.s3} S4=${s.s4} S5=${s.s5} — ALL_HOLD=${s.allHold}`);
  process.stdout.write(`ALL_HOLD=${s.allHold}\n`);

  if (decision) { // --decision path: record the user's choice
    atomicWrite(join(art, "adversary-skip.txt"), renderSkipRecord({ signals: s, decision, now: isoUtc() }));
    return 0;
  }
  if (!s.allHold) { // gate not offered → record not-offered, fall through to adversary
    atomicWrite(join(art, "adversary-skip.txt"), renderSkipRecord({ signals: s, decision: "not-offered", now: isoUtc() }));
  }
  // ALL_HOLD=true with no flag: write nothing — the Maestro asks, then re-invokes with --decision.
  return 0;
}

// ---- adversary-send / adversary-wait ----
async function adversarySendRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: prelude adversary-send <topic> <instrument> <provider>"); return 2; }
  return adversarySendWith(topic, instrument, provider, liveResearchSendDeps);
}
export async function adversarySendWith(topic: string, instrument: string, provider: string, d: ResearchSendDeps): Promise<number> {
  const art = preludeArtDir(topic);
  const draft = readIf(join(art, "landscape-draft.md"));
  if (!draft.trim()) { log.error("prelude adversary-send: landscape-draft.md missing or empty — run synth-preliminary first"); return 1; }
  const stateFile = join(art, `adversary-${instrument}.txt`);
  if (existsSync(stateFile)) { log.error(`prelude adversary-send: ${stateFile} exists; rm to retry`); return 1; }

  const outPath = join(art, `adversary-${instrument}.md`);
  const promptFile = join(art, `${instrument}_adversary_prompt.md`);
  atomicWrite(promptFile, composeAdversaryPrompt(draft, instrument, outPath));

  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);
  const rc = await d.send(["--from", "maestro", instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`prelude adversary-send: send failed (rc=${rc}); ${stateFile} kept (rm to redo)`); return 1; }
  log.ok(`prelude adversary-send: ${instrument} offset=${offset}`);
  return 0;
}

async function adversaryWaitRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: prelude adversary-wait <topic> <instrument> <provider>"); return 2; }
  return adversaryWaitWith(topic, instrument, provider, liveResearchWaitDeps);
}
export async function adversaryWaitWith(topic: string, instrument: string, provider: string, d: ResearchWaitDeps): Promise<number> {
  const art = preludeArtDir(topic);
  const stateFile = join(art, `adversary-${instrument}.txt`);
  if (!existsSync(stateFile)) { log.error(`prelude adversary-wait: ${stateFile} missing (run prelude adversary-send first)`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`prelude adversary-wait: OFFSET not set in ${stateFile}`); return 1; }

  const timeout = scaledTimeout(consultTimeout("adversary"), d.multiplier(provider));
  log.info(`prelude adversary-wait: ${instrument} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], timeout);

  const outPath = join(art, `adversary-${instrument}.md`);
  const text = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
  const as = verifyState(ev, text); // done -> ok iff non-empty; mirrors the adversary wait's -s check
  if (as === "question" && ev) {
    atomicWrite(join(art, `question-${instrument}.txt`), JSON.stringify(ev) + "\n");
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nAS=question\n`);
  } else {
    appendFileSync(stateFile, `AS=${as}\n`);
  }
  writeFileSync(join(art, `adversary-${instrument}.done`), "");
  log.ok(`prelude adversary-wait: ${instrument} AS=${as}`);
  return 0;
}

// ---- synth-final (input validator) ----
export async function synthFinalRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: prelude synth-final <topic>"); return 2; }
  const art = preludeArtDir(topic);
  if (!existsSync(art)) { log.error(`prelude synth-final: ${art} not found`); return 1; }
  if (!readIf(join(art, "landscape-draft.md")).trim()) { log.error("prelude synth-final: landscape-draft.md missing"); return 1; }
  if (!readIf(join(art, "topic.txt")).trim()) { log.error("prelude synth-final: topic.txt missing"); return 1; }

  const skipped = /^user_decision: skip$/m.test(readIf(join(art, "adversary-skip.txt")));
  if (!skipped) {
    const rows = parseRosterFile(readIf(join(art, "roster.txt")));
    const missing = missingRosterArtifacts(art, rows, "adversary");
    if (missing.length) {
      log.error("prelude synth-final: blocked — adversary ran but critiques missing:");
      for (const m of missing) log.error(`  - ${join(art, m)}`);
      return 1;
    }
  }
  const today = isoUtc().slice(0, 10);
  const out = join(art, `landscape-${today}-${topic}.md`);
  log.ok(`prelude synth-final: inputs validated for ${topic} (adversary_ran=${skipped ? 0 : 1})`);
  process.stdout.write(out + "\n");
  return 0;
}

// ---- forensics (delegates to core runForensics) ----
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("prelude", preludeArtDir, rest[0]);
}

// ---- teardown (orphan kill + archive; panes torn down by the directive's coda --pairs) ----
export interface PreludeTeardownDeps {
  killPane(pane: string): Promise<void>;
  archiveTopic(topic: string, suite: "prelude"): string | null;
  stdout?: (l: string) => void;
}
const livePreludeTeardownDeps: PreludeTeardownDeps = {
  killPane: (p) => killNow(p),
  archiveTopic: (t, s) => archiveTopic(t, s),
};
async function teardownRun(rest: string[]): Promise<number> { return teardownWith(rest, livePreludeTeardownDeps); }

export async function teardownWith(args: string[], deps: PreludeTeardownDeps): Promise<number> {
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const topic = args[0];
  if (!topic) { log.error("prelude teardown: topic required"); return 2; }
  const art = preludeArtDir(topic);
  if (!existsSync(art) || !statSync(art).isDirectory()) { log.error(`${art} not found`); return 1; }

  const pf = join(art, "preflight-panes.txt");
  if (existsSync(pf)) {
    for (const line of readFileSync(pf, "utf8").split("\n")) {
      const pane = line.trim();
      if (!pane) continue;
      try { await deps.killPane(pane); } catch { /* best-effort */ }
    }
  }
  const dest = deps.archiveTopic(topic, "prelude");
  if (dest) { out(dest); log.ok(`[teardown] archived ${topic} -> ${dest}`); }
  return 0;
}

// ---- handoff-extract (runs against the archived art-dir) ----
export async function handoffExtractRun(rest: string[]): Promise<number> {
  const artDir = rest[0];
  if (!artDir) { log.error("usage: prelude handoff-extract <art-dir>"); return 2; }
  const path = extractHandoffData(artDir);
  if (!path) { log.error(`prelude handoff-extract: art-dir or topic.txt missing under ${artDir}`); return 2; }
  log.ok(`prelude handoff-extract: wrote ${path}`);
  process.stdout.write(path + "\n");
  return 0;
}
