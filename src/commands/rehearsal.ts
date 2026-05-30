// /consort:rehearsal CLI verbs (Phase B front half). Ports deep-research-init.sh
// (slug/codex-gate/flags/scaffolding) + the deep-research.md Phase 0-3 surface.
// Phase C: experiment-send (dispatch ONE experiment to a persistent codex part).
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile, kvParse } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { archiveTopic, isoUtc } from "../core/archive.js";
import { deriveSlug } from "../core/solo.js";
import { extractMetric, formatMetricBlock, formatSotaBlock, parseMetricMd } from "../core/rehearsalMetric.js";
import { rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir } from "../core/rehearsal.js";
import { computeScore, type ScoreFs, type ScoreComputation } from "../core/rehearsalScore.js";
import { parseState, mergeState, reconcileFromOutbox, readHaltFlag } from "../core/rehearsalState.js";
import { checkCompletion, checkTimeBudget } from "../core/rehearsalComplete.js";
import { normalizeResult, type ResultJson } from "../core/rehearsalResult.js";
import { renderSessionSummary, type StatusRow, type EventRow } from "../core/rehearsalSummary.js";
import { finalizePhase, parseHardConstraints } from "../core/rehearsalFinalize.js";
import { buildStatusBrief, type PartBrief } from "../core/rehearsalBrief.js";
import { initScanState, monitorScan, type MonitorScanState } from "../core/rehearsalMonitor.js";
import {
  renderExperimentPrompt, buildSotaBlock, assembleHardwareBlock, hardwareDiffAlert,
  formatPeersBlock, buildDispatchState, EXP_ID_RE, INSTRUMENT_RE, type PeerRow,
} from "../core/rehearsalExperiment.js";
import { captureArtDir } from "../core/forensics.js";
import { parseScoreboard, buildHandoffKv, type HandoffInput } from "../core/rehearsalHandoff.js";
import { buildConsensus } from "../core/rehearsalConsensus.js";
import { instrumentBinary, consultTimeout } from "../core/contracts.js";
import { inboxWrite, inboxPath, outboxPath, paneMetaRead, resolveModel } from "../core/ipc.js";
import { paneSend, killNow } from "../core/tmux.js";
import { haveCmd } from "../core/deps.js";
import { spawnRosterArg, parsePanesFile, spawnResultsTsv, spawnTally, type SpawnResult } from "../core/score.js";
import { pickInstruments } from "../core/instruments.js";
import { repoRoot } from "../core/paths.js";
import { run as spawnRun } from "./spawn.js";
import { run as preflightRun } from "./preflight.js";
import { run as sendRun } from "./send.js";
import { run as codaRun } from "./coda.js";

type PathOpts = { home?: string; cwd?: string };

export interface RehearsalInitDeps {
  haveCmd(name: string): boolean;
  instrumentBinary(name: string): string | undefined;
  now(): string;
  probeHardware?(path: string): void;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

interface InitArgs {
  topic: string;
  seedFrom?: string;
  timeBudget?: string;
  metric?: string;
  slug?: string;
  badFlag?: string;
}

function parseInitArgs(args: string[]): InitArgs {
  let topic = "";
  let seedFrom: string | undefined, timeBudget: string | undefined, metric: string | undefined, slug: string | undefined, badFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const flag = eq > 0 ? a.slice(0, eq) : a;
      const inline = eq > 0 ? a.slice(eq + 1) : undefined;
      const val = (): string | undefined => inline ?? args[++i];
      if (flag === "--seed-from") seedFrom = val();
      else if (flag === "--time-budget") timeBudget = val();
      else if (flag === "--metric") metric = val();
      else if (flag === "--slug") slug = val();
      else { badFlag = a; }
    } else { topic = args.slice(i).join(" "); break; }
  }
  return { topic, seedFrom, timeBudget, metric, slug, badFlag };
}

/** Resolve a --time-budget token to whole seconds (or the literal "none"). */
function resolveTimeBudget(v: string): string {
  if (v === "none") return "none";
  if (/^[1-9][0-9]*h$/.test(v)) return String(parseInt(v, 10) * 3600);
  if (/^[1-9][0-9]*s$/.test(v)) return String(parseInt(v, 10));
  if (/^[1-9][0-9]*$/.test(v)) return v;
  throw new Error(`invalid --time-budget: '${v}' (expected 'none', '<N>h', '<N>s', or positive seconds)`);
}

export async function initWith(args: string[], deps: RehearsalInitDeps): Promise<number> {
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const p = parseInitArgs(args);
  if (p.badFlag) { log.error(`rehearsal init: unknown flag: ${p.badFlag}`); return 2; }
  if (!p.topic) { log.error("rehearsal init: topic required"); return 2; }

  let resolvedBudget: string | undefined;
  if (p.timeBudget !== undefined) {
    try { resolvedBudget = resolveTimeBudget(p.timeBudget); }
    catch (e) { log.error(`rehearsal init: ${(e as Error).message}`); return 2; }
  }

  const binary = deps.instrumentBinary("codex");
  if (!binary) { log.error("rehearsal init: codex has no entry in contracts.yaml"); return 3; }
  if (!deps.haveCmd(binary)) { log.error("rehearsal init: codex binary not on PATH; install codex and run /consort:soundcheck"); return 3; }

  let slug: string;
  if (p.slug !== undefined) {
    if (!/^[a-z][a-z0-9-]{0,19}$/.test(p.slug)) { log.error(`rehearsal init: --slug must match ^[a-z][a-z0-9-]{0,19}$; got '${p.slug}'`); return 2; }
    slug = p.slug;
  } else { slug = deriveSlug(p.topic); }
  if (!slug) { log.error("rehearsal init: topic produced an empty slug; provide alphanumerics"); return 2; }

  const art = rehearsalArtDir(slug, deps.opts);
  if (existsSync(art)) { log.error(`rehearsal init: topic already in flight: ${art}`); return 2; }
  if (p.seedFrom && !existsSync(p.seedFrom)) { log.error(`rehearsal init: --seed-from not found: ${p.seedFrom}`); return 1; }

  mkdirSync(art, { recursive: true });
  atomicWrite(join(art, "topic.txt"), p.topic);
  atomicWrite(join(art, "metric.txt"), extractMetric(p.topic) + "\n");
  if (p.seedFrom) atomicWrite(join(art, "seed-from.txt"), p.seedFrom + "\n");
  (deps.probeHardware ?? ((): void => {}))(join(art, "hardware.txt"));

  if (p.metric !== undefined) {
    try { atomicWrite(join(art, "metric.md"), formatMetricBlock(parseKv(p.metric))); }
    catch (e) { log.error(`rehearsal init: --metric: ${(e as Error).message}`); return 2; }
  }
  if (resolvedBudget !== undefined) {
    atomicWrite(join(art, "time-budget.txt"), resolvedBudget + "\n");
    atomicWrite(join(art, "session-start.txt"), deps.now() + "\n");
  }

  out(`TOPIC=${slug}`);
  out(`ART=${art}`);
  return 0;
}

const liveInitDeps: RehearsalInitDeps = {
  haveCmd, instrumentBinary,
  now: () => isoUtc(),
};

interface VerbOpts { opts?: PathOpts }

/** Parse "k=v,k2=v2,..." into a record (first '=' splits; values may contain '='). */
function parseKv(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const pair of s.split(",")) { const i = pair.indexOf("="); if (i > 0) o[pair.slice(0, i)] = pair.slice(i + 1); }
  return o;
}

/** Extract a trailing-positional <topic> + a --kv "<...>" value from args. */
function takeKvFlag(args: string[]): { topic: string; kv: string } {
  let topic = "", kv = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--kv") { kv = args[++i] ?? ""; }
    else if (!args[i].startsWith("--") && !topic) { topic = args[i]; }
  }
  return { topic, kv };
}

export async function metricWith(args: string[], v: VerbOpts = {}): Promise<number> {
  const { topic, kv } = takeKvFlag(args);
  if (!topic) { log.error("rehearsal metric: topic required"); return 2; }
  try { atomicWrite(join(rehearsalArtDir(topic, v.opts), "metric.md"), formatMetricBlock(parseKv(kv))); }
  catch (e) { log.error(`rehearsal metric: ${(e as Error).message}`); return 2; }
  return 0;
}

export async function sotaWith(args: string[], v: VerbOpts = {}): Promise<number> {
  const { topic, kv } = takeKvFlag(args);
  if (!topic) { log.error("rehearsal sota: topic required"); return 2; }
  const f = parseKv(kv);
  const refs: string[] = [];
  for (let i = 1; i <= 7; i++) { if (f[`ref_${i}`]) refs.push(f[`ref_${i}`]); }
  try {
    atomicWrite(join(rehearsalArtDir(topic, v.opts), "sota.md"),
      formatSotaBlock({ topic: f.topic ?? "", metric: f.metric ?? "", sweep_date: f.sweep_date ?? "", queries: f.queries, refs }));
  } catch (e) { log.error(`rehearsal sota: ${(e as Error).message}`); return 2; }
  return 0;
}

// ---- Phase B: spawn-all — pick N codex parts + batch-spawn them, reusing score's machinery ----

export interface SpawnAllDeps {
  preflight(args: string[]): Promise<number>;
  spawn(args: string[]): Promise<number>;
  repoRoot(): string;
  pickInstruments(topic: string, n: number): string[];
}
const liveSpawnAllDeps: SpawnAllDeps = { preflight: preflightRun, spawn: spawnRun, repoRoot, pickInstruments };

/** Pick N distinct codex parts for <topic>, preflight + batch-spawn them (port of score spawn-all,
 *  fixed to the codex provider). Writes parts.txt (one instrument per line) + spawn-results.tsv;
 *  returns spawnTally (all ok 0 / partial 1 / none ok 2; setup failures also 2). */
export async function spawnAllWith(args: string[], deps: SpawnAllDeps, opts?: PathOpts): Promise<number> {
  const topic = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "";
  const n = parseInt(args.find((a) => /^\d+$/.test(a)) ?? "2", 10);
  if (!topic) { log.error("rehearsal spawn-all: topic required"); return 2; }
  const art = rehearsalArtDir(topic, opts);

  const instruments = deps.pickInstruments(topic, n);
  if (instruments.length < 2) { log.error(`rehearsal spawn-all: need >= 2 codex parts; picked ${instruments.length}`); return 2; }
  const rows = instruments.map((instrument) => ({ instrument, provider: "codex" }));
  atomicWrite(join(art, "parts.txt"), instruments.join("\n") + "\n");

  const prc = await deps.preflight([topic, String(rows.length), "--roster", spawnRosterArg(rows), "--art-dir", art]);
  if (prc !== 0) { log.error(`rehearsal spawn-all: preflight failed (rc ${prc})`); return 2; }
  const panes = parsePanesFile(readFileSync(join(art, "preflight-panes.txt"), "utf8"));
  const orphans = rows.filter((r) => !panes.has(r.instrument));
  if (orphans.length) { log.error(`rehearsal spawn-all: parts missing a preflight pane: ${orphans.map((r) => r.instrument).join(", ")}`); return 2; }

  const cwd = deps.repoRoot();
  const results: SpawnResult[] = await Promise.all(rows.map(async (r) => ({
    instrument: r.instrument, provider: r.provider,
    rc: await deps.spawn([r.instrument, r.provider, topic, "--target-pane", panes.get(r.instrument)!, "--cwd", cwd]),
  })));
  atomicWrite(join(art, "spawn-results.tsv"), spawnResultsTsv(results));

  const rc = spawnTally(results.map((r) => r.rc));
  const nOk = results.filter((r) => r.rc === 0).length;
  if (rc === 0) log.ok(`rehearsal spawn-all: ${nOk}/${rows.length} codex parts ready`);
  else log.warn(`rehearsal spawn-all: ${nOk}/${rows.length} codex parts ready (rc=${rc})`);
  return rc;
}

// ---- Phase C: experiment-send — dispatch ONE experiment to a persistent codex part ----
// Ports deep-research-experiment-send.sh: gather blocks, render the experiment
// template, write prompt.md, write the inbox (canonical fence via inboxWrite),
// transition state, best-effort nudge the pane.

export interface ExperimentSendDeps {
  now(): string;                                       // isoUtc — last_event_ts
  probeHardware(): string;                             // best-effort "no-gpu" or "detected_at\t..\ngpu\t.."
  paneSend(pane: string, line: string): Promise<void>; // injected (tmux); tests pass a fake/throwing one
  consultTimeout(): number;                            // per-experiment cap (e.g. 1800); from contracts
  runSmokeTest?(script: string, cwd: string, timeoutSec: number): { ok: boolean; stderr: string };
  smokeTimeoutSec?: number;                            // default 60
  dryRun?: boolean;                                    // skip the pane nudge (tests)
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

interface ExperimentSendArgs {
  topic: string; instrument: string; expId: string; approachLabel: string; approachBrief: string;
  inputs?: string; contextFile?: string; smokeTest?: string; timeout?: string;
  badArgs?: boolean;
}

/** Flags-first then exactly 5 positionals (port of experiment-send.sh's getopts loop). */
function parseExperimentSendArgs(args: string[]): ExperimentSendArgs {
  let inputs: string | undefined, contextFile: string | undefined, smokeTest: string | undefined, timeout: string | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) break;
    if (a === "--inputs" || a.startsWith("--inputs=")) { const r = kvParse(a, args[i + 1]); inputs = r.value; i += r.shift - 1; }
    else if (a === "--context-file" || a.startsWith("--context-file=")) { const r = kvParse(a, args[i + 1]); contextFile = r.value; i += r.shift - 1; }
    else if (a === "--smoke-test" || a.startsWith("--smoke-test=")) { const r = kvParse(a, args[i + 1]); smokeTest = r.value; i += r.shift - 1; }
    else if (a === "--timeout" || a.startsWith("--timeout=")) { const r = kvParse(a, args[i + 1]); timeout = r.value; i += r.shift - 1; }
    else { return { topic: "", instrument: "", expId: "", approachLabel: "", approachBrief: "", badArgs: true }; }
  }
  const pos = args.slice(i);
  if (pos.length !== 5) return { topic: "", instrument: "", expId: "", approachLabel: "", approachBrief: "", badArgs: true };
  const [topic, instrument, expId, approachLabel, approachBrief] = pos;
  return { topic, instrument, expId, approachLabel, approachBrief, inputs, contextFile, smokeTest, timeout };
}

/** Best-effort peer snapshot for the {{PEERS_BLOCK}} slot. Reads parts.txt (one instrument/line)
 *  under art; for each peer != self, reads its state.txt (phase, current_exp_id) + its latest
 *  experiment result.json (approach_label, metric_value, status, notes). Missing files → empty
 *  cells. Returns [] when parts.txt is absent or lists only self. Faithful to the bash helper. */
function gatherPeers(art: string, self: string): PeerRow[] {
  const partsFile = join(art, "parts.txt");
  if (!existsSync(partsFile)) return [];
  const peers = readFileSync(partsFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && l !== self);
  const rows: PeerRow[] = [];
  for (const peer of peers) {
    const peerDir = partStateDir(art, peer);
    if (!existsSync(peerDir)) continue;
    let phase = "", currentExp = "";
    const statePath = join(peerDir, "state.txt");
    if (existsSync(statePath)) {
      const kv = parseState(readFileSync(statePath, "utf8"));
      phase = kv.phase ?? "";
      currentExp = kv.current_exp_id ?? "";
    }
    // Latest experiment: prefer current_exp_id, else lex-greatest exp-NNN dir.
    let latest = currentExp;
    const expsDir = join(peerDir, "experiments");
    if (!latest && existsSync(expsDir)) {
      for (const name of readdirSync(expsDir)) {
        if (EXP_ID_RE.test(name) && name > latest) latest = name;
      }
    }
    let approach = "", metric = "", status = "", notes = "";
    if (latest) {
      const resultPath = join(expsDir, latest, "result.json");
      if (existsSync(resultPath)) {
        try {
          const r = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
          approach = r.approach_label != null ? String(r.approach_label) : "";
          metric = r.metric_value != null ? String(r.metric_value) : "";
          status = r.status != null ? String(r.status) : "";
          notes = r.notes != null ? String(r.notes) : "";
        } catch { /* missing/garbled result.json → empty cells */ }
      }
    }
    rows.push({ instrument: peer, phase, currentExp: latest, approach, metric, status, notes });
  }
  return rows;
}

export async function experimentSendWith(args: string[], deps: ExperimentSendDeps): Promise<number> {
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const opts = deps.opts;
  const p = parseExperimentSendArgs(args);
  if (p.badArgs) { log.error("rehearsal experiment-send: usage: [--inputs csv] [--context-file path] [--smoke-test script] [--timeout N] <topic> <instrument> <exp-id> <approach-label> <approach-brief>"); return 2; }
  const { topic, instrument, expId, approachLabel, approachBrief } = p;

  if (!EXP_ID_RE.test(expId)) { log.error(`rehearsal experiment-send: exp-id must match exp-[0-9]+; got '${expId}'`); return 2; }
  if (!INSTRUMENT_RE.test(instrument)) { log.error(`rehearsal experiment-send: instrument must match [a-z][a-z0-9-]*; got '${instrument}'`); return 2; }

  // --inputs: each csv path must be readable.
  if (p.inputs) {
    for (const path of p.inputs.split(",")) {
      if (!path) continue;
      try { accessSync(path, fsConstants.R_OK); }
      catch { log.error(`rehearsal experiment-send: cannot read input path '${path}'`); return 2; }
    }
  }
  // --timeout: positive integer seconds.
  if (p.timeout !== undefined && !/^[1-9][0-9]*$/.test(p.timeout)) {
    log.error(`rehearsal experiment-send: --timeout must be a positive integer (seconds); got '${p.timeout}'`); return 2;
  }
  // --smoke-test: file must exist + be executable.
  if (p.smokeTest) {
    try { accessSync(p.smokeTest, fsConstants.X_OK); }
    catch { log.error(`rehearsal experiment-send: smoke-test script not executable: ${p.smokeTest}`); return 2; }
  }
  // --context-file: readable; read into taskContext.
  let taskContext = "";
  if (p.contextFile) {
    try { taskContext = readFileSync(p.contextFile, "utf8"); }
    catch { log.error(`rehearsal experiment-send: cannot read --context-file: ${p.contextFile}`); return 2; }
  }

  const art = rehearsalArtDir(topic, opts);
  if (!existsSync(art)) { log.error(`rehearsal experiment-send: topic state dir missing: ${art} (was rehearsal init run?)`); return 1; }
  const metricMd = join(art, "metric.md");
  if (!existsSync(metricMd)) { log.error(`rehearsal experiment-send: metric.md missing at ${metricMd}`); return 1; }
  const stateDir = partStateDir(art, instrument);
  const stateTxt = join(stateDir, "state.txt");
  if (!existsSync(stateTxt)) { log.error(`rehearsal experiment-send: part state.txt missing: ${stateTxt}`); return 1; }

  // 3-outcome phase gate: abandoned (2, distinct) / not-idle (1) / idle (proceed).
  const phase = parseState(readFileSync(stateTxt, "utf8")).phase ?? "";
  if (phase === "abandoned") { log.error(`rehearsal experiment-send: part ${instrument} lane is abandoned; not dispatching`); return 2; }
  if (phase !== "idle") { log.error(`rehearsal experiment-send: part ${instrument} not idle (phase=${phase}); wait or finalize first`); return 1; }

  // Branch dir + smoke-test BEFORE any state mutation.
  const branchDir = experimentDir(art, instrument, expId);
  mkdirSync(join(branchDir, "code"), { recursive: true });
  if (p.smokeTest) {
    const r = deps.runSmokeTest!(p.smokeTest, join(branchDir, "code"), deps.smokeTimeoutSec ?? 60);
    if (!r.ok) {
      atomicWrite(join(branchDir, "smoke-test.err"), r.stderr);
      log.error(`rehearsal experiment-send: smoke-test failed for ${instrument}/${expId}; stderr -> ${join(branchDir, "smoke-test.err")}`);
      return 2;
    }
  }

  const model = resolveModel(instrument, topic);
  if (!model) { log.error(`rehearsal experiment-send: no part '${instrument}' on topic '${topic}' (resolveModel null)`); return 1; }
  const outbox = outboxPath(instrument, model, topic);
  if (!existsSync(outbox)) { log.error(`rehearsal experiment-send: part outbox missing: ${outbox} (was spawn run for ${instrument}?)`); return 1; }

  // Gather template fields.
  const metricBlock = readFileSync(metricMd, "utf8");
  const metricName = parseMetricMd(metricBlock).primaryMetric;
  if (!metricName) { log.error(`rehearsal experiment-send: could not parse Primary metric from ${metricMd}`); return 1; }

  const probe = deps.probeHardware();
  const baselinePath = join(art, "hardware.txt");
  const baseline = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : null;
  const hardwareBlock = assembleHardwareBlock(probe, hardwareDiffAlert(baseline, probe));

  const topicTextPath = join(art, "topic.txt");
  const topicText = existsSync(topicTextPath) ? readFileSync(topicTextPath, "utf8") : "";
  const sotaPath = join(art, "sota.md");
  const sotaBlock = buildSotaBlock(existsSync(sotaPath) ? readFileSync(sotaPath, "utf8") : null);
  const peersBlock = formatPeersBlock(gatherPeers(art, instrument));
  const timeBudgetS = String(p.timeout ?? deps.consultTimeout());

  // Read + render the template.
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
  const templatePath = join(pluginRoot, "config", "prompt-templates", "rehearsal", "experiment.md");
  if (!existsSync(templatePath)) { log.error(`rehearsal experiment-send: template missing: ${templatePath}`); return 1; }
  const template = readFileSync(templatePath, "utf8");

  let prompt: string;
  try {
    prompt = renderExperimentPrompt(template, {
      metricBlock, hardwareBlock, outboxPath: outbox, topicText, expId,
      approachLabel, approachBrief, branchDir, metricName, timeBudgetS,
      taskContext, sotaBlock, peersBlock, artDir: art,
    });
  } catch (e) { log.error(`rehearsal experiment-send: ${(e as Error).message}`); return 1; }
  if (prompt.trim() === "") { log.error(`rehearsal experiment-send: prompt rendered empty (template substitution failed)`); return 1; }

  // Persist prompt.md, write the inbox (canonical fence), transition state.
  atomicWrite(join(branchDir, "prompt.md"), prompt);
  inboxWrite(instrument, model, topic, prompt, { from: "maestro" });
  atomicWrite(stateTxt, buildDispatchState(readFileSync(stateTxt, "utf8"), expId, deps.now()));

  // Best-effort pane nudge (NON-FATAL; inbox + state already committed).
  if (!deps.dryRun) {
    const pane = paneMetaRead(instrument, model, topic);
    if (pane) {
      try { await deps.paneSend(pane, `Read ${inboxPath(instrument, model, topic)} and execute the task. Reply when done.`); }
      catch (e) { log.warn(`rehearsal experiment-send: pane nudge failed (${(e as Error).message}); part may not have noticed inbox`); }
    }
  }

  out(`dispatched ${expId} -> ${instrument}`);
  return 0;
}

const liveExperimentSendDeps: ExperimentSendDeps = {
  now: () => isoUtc(),
  probeHardware: liveProbeHardware,
  paneSend,
  consultTimeout: () => consultTimeout("experiment"),
  runSmokeTest: (script, cwd, timeoutSec) => {
    try { execFileSync(script, [], { cwd, timeout: timeoutSec * 1000, encoding: "utf8" }); return { ok: true, stderr: "" }; }
    catch (e) { const err = e as { stderr?: string; message?: string }; return { ok: false, stderr: err.stderr ?? err.message ?? "" }; }
  },
  dryRun: process.env.CONSORT_DRY_RUN === "1",
};

/** Best-effort GPU probe via nvidia-smi; "no-gpu" on any error. */
function liveProbeHardware(): string {
  try {
    const csv = execFileSync("nvidia-smi", [
      "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits",
    ], { encoding: "utf8" }).trim();
    if (!csv) return "no-gpu";
    const lines = csv.split("\n").map((l) => {
      const [name = "", total = "", free = "", driver = ""] = l.split(",").map((c) => c.trim());
      return `gpu\t${name}\t${total}\t${free}\t${driver}`;
    });
    return [`detected_at\t${isoUtc()}`, ...lines].join("\n");
  } catch { return "no-gpu"; }
}

// ---- Phase C: score — thin FS shell over computeScore ----
// Ports deep-research-score.sh: validate the topic arg, guard the parts dir,
// run computeScore (pure), then apply the returned plan in the FROZEN order
// (scoreboard -> log -> results.tsv -> sidecars -> stale removals -> phase
// clears -> warnings) so a concurrent reader observes a consistent sequence.

export interface RehearsalScoreDeps {
  computeScore(art: string, fs: ScoreFs, now: () => string): ScoreComputation;
  fs: ScoreFs;
  writeAtomic(path: string, content: string): void;
  removeFile(path: string): void;
  now(): string;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

export async function scoreWith(args: string[], deps: RehearsalScoreDeps): Promise<number> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 1) { log.error("usage: rehearsal score <topic>"); return 2; }
  const topic = positionals[0];

  const art = rehearsalArtDir(topic, deps.opts);
  const partsRoot = partsDir(art);
  if (!existsSync(partsRoot)) { log.error(`rehearsal score: parts dir missing: ${partsRoot}`); return 1; }

  const c = deps.computeScore(art, deps.fs, deps.now);

  // FROZEN write order — a reader can observe scoreboard before results.tsv,
  // or state still non-idle mid-run; preserve the sequence.
  deps.writeAtomic(join(art, "scoreboard.md"), c.scoreboardMd);
  log.ok(`[score] scoreboard at ${join(art, "scoreboard.md")}`);
  deps.writeAtomic(join(art, "results.tsv"), c.resultsTsv);
  for (const s of c.sidecars) deps.writeAtomic(s.path, s.body);
  for (const p of c.staleSidecars) deps.removeFile(p);
  for (const pc of c.phaseClears) deps.writeAtomic(pc.statePath, pc.merged);
  for (const w of c.warnings) log.warn(w);
  return 0;
}

export const liveScoreDeps: RehearsalScoreDeps = {
  computeScore,
  fs: {
    exists: existsSync,
    read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    listDir: (p) => { try { return readdirSync(p).sort(); } catch { return []; } },  // ENOENT-safe, per ScoreFs contract
  },
  writeAtomic: atomicWrite,
  removeFile: (p) => { try { rmSync(p, { force: true }); } catch { /* best-effort */ } },
  now: () => isoUtc(),
};

// ---- Phase C: monitor — per-part liveness scan loop ----
// Wires the pure monitorScan/initScanState (C6) into a CLI verb. The Monitor tool
// launches this persistently per part; it loops, emitting notification JSON lines to
// stdout, with the cursor + rescan-set persisted to disk for restart-survival.
// This verb is the impure shell (Date.now/statSync/readFileSync/writeFileSync are fine).

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function monitorRun(args: string[], opts?: { home?: string; cwd?: string }): Promise<number> {
  // Strip --once anywhere so it's position-independent; the rest are the 2 positionals.
  const once = args.includes("--once");
  const pos = args.filter((a) => a !== "--once");
  if (pos.length !== 2) { log.error("rehearsal monitor: usage: <topic> <instrument> [--once]"); return 2; }
  const [topic, instrument] = pos;

  const art = rehearsalArtDir(topic, opts);
  if (!existsSync(art)) { log.error(`rehearsal monitor: art dir missing: ${art}`); return 2; }

  const model = resolveModel(instrument, topic);
  if (!model) { log.error(`rehearsal monitor: no part '${instrument}' on topic '${topic}' (resolveModel null)`); return 1; }
  const outbox = outboxPath(instrument, model, topic);

  const stateDir = partStateDir(art, instrument);
  mkdirSync(stateDir, { recursive: true });
  const cursorFile = join(stateDir, "liveness-cursor.txt");
  const rescanFile = join(stateDir, "liveness-rescan-emitted.txt");
  const stateTxt = join(stateDir, "state.txt");

  const thresholds = {
    probeS: Number(process.env.CONSORT_PROBE_S ?? 900),
    stuckS: Number(process.env.CONSORT_STUCK_S ?? 1800),
    rescanEveryS: Number(process.env.CONSORT_RESCAN_EVERY_S ?? 30),
  };

  const persist = (state: MonitorScanState): void => {
    writeFileSync(cursorFile, String(state.offset));            // NO trailing newline
    writeFileSync(rescanFile, [...state.rescanEmitted].join("\n"));
  };

  // Initial cursor restore + pre-seed from the whole outbox (size = BYTES).
  const initBuf = existsSync(outbox) ? readFileSync(outbox) : Buffer.alloc(0);
  let state = initScanState(
    initBuf.length, initBuf.toString("utf8"),
    existsSync(cursorFile) ? readFileSync(cursorFile, "utf8") : null,
    existsSync(rescanFile) ? readFileSync(rescanFile, "utf8") : null,
  );
  persist(state);

  do {
    const buf = existsSync(outbox) ? readFileSync(outbox) : Buffer.alloc(0);
    const size = buf.length;
    const full = buf.toString("utf8");
    const text = buf.subarray(state.offset).toString("utf8");
    const mtime = existsSync(outbox) ? Math.floor(statSync(outbox).mtimeMs / 1000) : 0;
    const phase = (existsSync(stateTxt) ? parseState(readFileSync(stateTxt, "utf8")).phase : "") ?? "";

    const r = monitorScan(outbox, instrument, state, {
      outboxText: text, outboxFullText: full, outboxSize: size, outboxMtime: mtime,
      phase, now: Math.floor(Date.now() / 1000), nowIso: isoUtc(), thresholds,
    });
    for (const n of r.notifications) process.stdout.write(JSON.stringify(n) + "\n");

    state = r.state;
    persist(state);

    if (once) break;
    await sleep(2000);
  } while (!once);

  return 0;
}

// ---- Phase C: status-brief — render a compact chat-shaped status update (C8) ----
// Ports deep-research.sh's render_status_brief: gather per-part data (state.txt +
// result.json approach/metric, prompt.md approach fallback), read scoreboard.md,
// compute the completion signals, then hand off to the pure buildStatusBrief
// renderer. Read-only FS shell; no injected deps needed.

/** Extract the `Approach label:` value rendered into an experiment's prompt.md
 *  (template line `  Approach label:  <slug>`). Best-effort; "" when absent.
 *  Faithful to deep-research.sh's approach_from_prompt helper. */
function approachFromPrompt(promptPath: string): string {
  if (!existsSync(promptPath)) return "";
  for (const line of readFileSync(promptPath, "utf8").split("\n")) {
    const m = /^\s*Approach label:\s+(.*?)\s*$/.exec(line);
    if (m) return m[1];
  }
  return "";
}

/** Read result.json ONCE and surface the brief's two cells for a non-working part:
 *  approach (from approach_label) + metric ("<metric_value> <status>", e.g. "0.9 ok").
 *  Both default empty/"—" when the result is absent/garbled. Faithful to the bash:
 *  approach comes from result.json approach_label (prompt.md is only the fallback,
 *  applied by the caller), metric is `"$m $s"`. */
function readResultCells(resultPath: string): { approach: string; metric: string } {
  if (!existsSync(resultPath)) return { approach: "", metric: "—" };
  try {
    const r = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
    const approach = r.approach_label != null ? String(r.approach_label) : "";
    const m = r.metric_value != null ? String(r.metric_value) : "";
    const s = r.status != null ? String(r.status) : "";
    const metric = `${m} ${s}`.trim() || "—";
    return { approach, metric };
  } catch { return { approach: "", metric: "—" }; }
}

/** Parse the --latest-instrument / --latest-exp flags + the single positional <topic>. */
function parseStatusBriefArgs(args: string[]): { topic: string; latestInstrument?: string; latestExp?: string } {
  let topic = "", latestInstrument: string | undefined, latestExp: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--latest-instrument") latestInstrument = args[++i];
    else if (a === "--latest-exp") latestExp = args[++i];
    else if (!a.startsWith("--") && !topic) topic = a;
  }
  return { topic, latestInstrument, latestExp };
}

export async function statusBriefWith(args: string[], v: VerbOpts & { stdout?: (line: string) => void } = {}): Promise<number> {
  const out = v.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const p = parseStatusBriefArgs(args);
  if (!p.topic) { log.error("rehearsal status-brief: topic required"); return 2; }

  const art = rehearsalArtDir(p.topic, v.opts);

  // Per-part rows: read parts.txt (one instrument/line); for each, parse state.txt
  // (phase + current_exp_id), then approach + metric. Working parts have no
  // result.json yet -> approach from prompt.md, metric "(running)". Non-working
  // parts -> approach from result.json approach_label (prompt.md fallback), metric
  // "<metric_value> <status>". Faithful to deep-research.sh's render_status_brief.
  const parts: PartBrief[] = [];
  const partsFile = join(art, "parts.txt");
  if (existsSync(partsFile)) {
    const instruments = readFileSync(partsFile, "utf8")
      .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const instrument of instruments) {
      let phase = "?", currentOrLast = "—";
      const stateTxt = join(partStateDir(art, instrument), "state.txt");
      let curExp = "";
      if (existsSync(stateTxt)) {
        const kv = parseState(readFileSync(stateTxt, "utf8"));
        phase = kv.phase || "?";
        curExp = kv.current_exp_id ?? "";
      }
      if (curExp) {
        currentOrLast = curExp;
      } else {
        // Most-recent scored experiment from the filesystem (lexical sort on exp-NNN).
        const expsRoot = experimentsDir(art, instrument);
        if (existsSync(expsRoot)) {
          let newest = "";
          for (const name of readdirSync(expsRoot)) {
            if (EXP_ID_RE.test(name) && name > newest) newest = name;
          }
          if (newest) currentOrLast = newest;
        }
      }
      const expForFiles = curExp || (currentOrLast !== "—" ? currentOrLast : "");
      const promptPath = expForFiles ? join(experimentDir(art, instrument, expForFiles), "prompt.md") : "";
      const resultPath = expForFiles ? join(experimentDir(art, instrument, expForFiles), "result.json") : "";

      let approach: string, metric: string;
      if (phase === "working") {
        // result.json not landed yet -> approach from prompt.md, metric running.
        approach = (promptPath && approachFromPrompt(promptPath)) || "—";
        metric = "(running)";
      } else {
        // Approach from result.json's approach_label; fall back to prompt.md when empty.
        const cells = resultPath ? readResultCells(resultPath) : { approach: "", metric: "—" };
        approach = cells.approach || (promptPath && approachFromPrompt(promptPath)) || "—";
        metric = cells.metric;
      }
      parts.push({ instrument, phase, currentOrLast, approach, metric });
    }
  }

  const sbPath = join(art, "scoreboard.md");
  const scoreboardMd = existsSync(sbPath) ? readFileSync(sbPath, "utf8") : null;
  const metricPath = join(art, "metric.md");
  // Completion signals require BOTH scoreboard.md and metric.md; null otherwise so
  // the renderer shows "_(scoreboard or metric absent)_" rather than an all-`no` row.
  const completion = scoreboardMd !== null && existsSync(metricPath)
    ? checkCompletion(scoreboardMd, readFileSync(metricPath, "utf8"))
    : null;

  const latest = p.latestInstrument && p.latestExp ? { instrument: p.latestInstrument, exp: p.latestExp } : undefined;
  out(buildStatusBrief({ parts, scoreboardMd, completion, latest }));
  return 0;
}

// ---- Phase D: finalize — Phase 4->5 wind-down. Idempotent FS orchestration. ----
// Ports deep-research-finalize.sh: per-part reconcile + phase normalization,
// result.json normalization, intermediate-checkpoint prune, pane-artifact link,
// size + audit warnings, and a wholesale session-summary.md re-render. consort
// adaptations: NO active-marker lifecycle (omit the rm -f active-<sid>.txt step;
// hook.ts is a no-op), and session-summary.md is the FULL renderSessionSummary.

export interface RehearsalFinalizeDeps {
  now(): string;
  keepIntermediate?: boolean;
  sizeWarnGb?: number;
  stdout?: (l: string) => void;
  opts?: PathOpts;
}

const GIB = 1073741824;

/** Read a file as utf8, or "" when absent/unreadable. */
function readOr(path: string, fallback = ""): string {
  try { return readFileSync(path, "utf8"); } catch { return fallback; }
}

/** List the exp-NNN dirs directly under a part's experiments root (ENOENT-safe). */
function listExpDirs(expsRoot: string): string[] {
  try {
    return readdirSync(expsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && EXP_ID_RE.test(e.name))
      .map((e) => e.name).sort();
  } catch { return []; }
}

/** Recursive byte size (sum of regular-file sizes) under dir. */
function dirByteSize(dir: string): number {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirByteSize(p);
    else if (e.isFile()) { try { total += statSync(p).size; } catch { /* skip */ } }
  }
  return total;
}

/** Count regular files at depth 1 of dir. */
function fileCountDepth1(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length;
  } catch { return 0; }
}

export async function finalizeWith(args: string[], deps: RehearsalFinalizeDeps): Promise<number> {
  const opts = deps.opts;
  // Argument parse: finalize [--keep-intermediate] <topic>.
  let keep = deps.keepIntermediate ?? false;
  let rest = args;
  if (rest[0] === "--keep-intermediate") { keep = true; rest = rest.slice(1); }
  if (rest.length !== 1 || rest[0].startsWith("--")) {
    log.error("usage: rehearsal finalize [--keep-intermediate] <topic>"); return 2;
  }
  const topic = rest[0];

  // 1. art dir must exist.
  const art = rehearsalArtDir(topic, opts);
  if (!existsSync(art) || !statSync(art).isDirectory()) {
    log.error(`finalize: art-dir missing: ${art}`); return 1;
  }

  // Parts list (one instrument per non-blank line). Used in steps 2 + 9.
  const partsFile = join(art, "parts.txt");
  const instruments = existsSync(partsFile)
    ? readFileSync(partsFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];

  // 2. Per-part reconcile + phase normalization.
  for (const instrument of instruments) {
    const stateDir = partStateDir(art, instrument);
    const stateTxt = join(stateDir, "state.txt");
    if (!existsSync(stateTxt)) continue;

    // (a) reconcile: replay the PANE outbox tail past the liveness cursor.
    const cursorRaw = readOr(join(stateDir, "liveness-cursor.txt"));
    const offset = Number.parseInt(cursorRaw.trim(), 10) || 0;
    const model = resolveModel(instrument, topic);
    const ob = model ? outboxPath(instrument, model, topic) : "";
    let tail = "";
    if (ob && existsSync(ob)) {
      try { tail = readFileSync(ob).subarray(offset).toString("utf8"); } catch { tail = ""; }
    }
    const curExp = parseState(readOr(stateTxt)).current_exp_id ?? "";
    const doneResultExists = !!curExp && existsSync(join(experimentDir(art, instrument, curExp), "result.json"));
    const recon = reconcileFromOutbox(tail, doneResultExists);
    if (recon === "failed" || recon === "idle") {
      atomicWrite(stateTxt, mergeState(readOr(stateTxt), { phase: recon }));
    }

    // (b) phase case-map.
    const phase = parseState(readOr(stateTxt)).phase ?? "";
    const np = finalizePhase(phase);
    if (np) atomicWrite(stateTxt, mergeState(readOr(stateTxt), { phase: np }));
  }

  // 3. (OMIT active-marker removal — consort has no active-marker lifecycle.)

  // 4. normalize_result: enforce status/metric_value joint validity per exp.
  for (const instrument of instruments) {
    const expsRoot = experimentsDir(art, instrument);
    for (const expId of listExpDirs(expsRoot)) {
      const resultPath = join(expsRoot, expId, "result.json");
      if (!existsSync(resultPath)) continue;
      let parsed: ResultJson;
      try { parsed = JSON.parse(readFileSync(resultPath, "utf8")) as ResultJson; } catch { continue; }
      const norm = normalizeResult(parsed);
      if (norm.status !== parsed.status || norm.metric_value !== parsed.metric_value) {
        atomicWrite(resultPath, JSON.stringify(norm));
        log.info(`normalize: ${instrument}/${expId} -> ${norm.status}`);
      }
    }
  }

  // 5. prune intermediate checkpoints (skip if --keep-intermediate).
  if (!keep) {
    for (const instrument of instruments) {
      const expsRoot = experimentsDir(art, instrument);
      for (const expId of listExpDirs(expsRoot)) {
        const expDir = join(expsRoot, expId);
        const resultPath = join(expDir, "result.json");
        if (!existsSync(resultPath)) continue;
        let keptRel: string;
        try {
          const r = JSON.parse(readFileSync(resultPath, "utf8")) as { checkpoint_path?: unknown };
          keptRel = r.checkpoint_path != null ? String(r.checkpoint_path) : "";
        } catch { continue; }
        if (!keptRel || keptRel === "null") continue;
        // Resolve relative to the exp dir; reject paths that escape it.
        const keptAbs = resolve(expDir, keptRel);
        if (keptAbs !== expDir && !keptAbs.startsWith(expDir + "/")) {
          log.warn(`prune: checkpoint_path escapes exp dir: ${keptRel} (in ${expDir}); skipping`);
          continue;
        }
        let entries: string[];
        try { entries = readdirSync(expDir); } catch { continue; }
        for (const name of entries) {
          if (!name.endsWith(".pt")) continue;
          const pt = join(expDir, name);
          if (pt === keptAbs) continue;
          try { if (statSync(pt).isFile()) rmSync(pt, { force: true }); } catch { /* best-effort */ }
        }
      }
    }
  }

  // 6. link pane artifacts: relative symlinks of the pane outbox/inbox into the art tree.
  for (const instrument of instruments) {
    const model = resolveModel(instrument, topic);
    if (!model) continue;
    const targetDir = partStateDir(art, instrument);
    mkdirSync(targetDir, { recursive: true });
    const paneFiles: Array<[string, string]> = [
      ["outbox.jsonl", outboxPath(instrument, model, topic)],
      ["inbox.md", inboxPath(instrument, model, topic)],
    ];
    for (const [name, src] of paneFiles) {
      if (!existsSync(src)) { log.warn(`link_pane_artifacts: pane file missing for ${instrument}: ${name}`); continue; }
      const linkPath = join(targetDir, name);
      const rel = relative(targetDir, src);
      try {
        try { if (lstatSync(linkPath)) unlinkSync(linkPath); } catch { /* nothing to replace */ }
        symlinkSync(rel, linkPath);
      } catch { /* best-effort */ }
    }
  }

  // 7. compute size warnings (post-prune). TRUNCATE warnings.txt first.
  const warningsPath = join(art, "warnings.txt");
  const threshold = (deps.sizeWarnGb ?? 2) * GIB;
  const sizeLines: string[] = [];
  for (const instrument of instruments) {
    const expsRoot = experimentsDir(art, instrument);
    for (const expId of listExpDirs(expsRoot)) {
      const expDir = join(expsRoot, expId);
      const bytes = dirByteSize(expDir);
      if (bytes >= threshold) {
        const gb = (bytes / GIB).toFixed(1);
        sizeLines.push(`size_warn\t${instrument}/${expId}\t${gb}\t${fileCountDepth1(expDir)}`);
      }
    }
  }
  atomicWrite(warningsPath, sizeLines.length ? sizeLines.join("\n") + "\n" : "");

  // 8. audit diff: append audit_warn rows for prompt/audit knob mismatches (AFTER size).
  const auditLines: string[] = [];
  for (const instrument of instruments) {
    const expsRoot = experimentsDir(art, instrument);
    for (const expId of listExpDirs(expsRoot)) {
      const expDir = join(expsRoot, expId);
      const promptMd = join(expDir, "prompt.md");
      const auditJson = join(expDir, "audit.json");
      if (!existsSync(promptMd) || !existsSync(auditJson)) continue;
      let audit: Record<string, unknown>;
      try { audit = JSON.parse(readFileSync(auditJson, "utf8")) as Record<string, unknown>; } catch { continue; }
      for (const { key, value } of parseHardConstraints(readFileSync(promptMd, "utf8"))) {
        const actual = audit[key];
        if (actual == null || String(actual) === "null") continue;
        if (String(value) !== String(actual)) {
          auditLines.push(`audit_warn\t${instrument}/${expId}\t${key}\tprompt=${value}  actual=${String(actual)}`);
        }
      }
    }
  }
  if (auditLines.length) {
    const existing = readOr(warningsPath);
    atomicWrite(warningsPath, existing + auditLines.join("\n") + "\n");
  }

  // 9. render session-summary.md (FULL re-render; wholesale atomic replace).
  const statusRows: StatusRow[] = [];
  for (const instrument of instruments) {
    const stateTxt = join(partStateDir(art, instrument), "state.txt");
    if (existsSync(stateTxt)) {
      const kv = parseState(readOr(stateTxt));
      statusRows.push({
        instrument,
        phase: kv.phase ?? "?",
        current: kv.current_exp_id ?? "",
        lastTs: kv.last_event_ts ?? "?",
        lastEvent: kv.last_event ?? "?",
      });
    } else {
      statusRows.push({ instrument, phase: "?", current: "", lastTs: "?", lastEvent: "?" });
    }
  }

  const scoreboardPath = join(art, "scoreboard.md");
  const scoreboardMd = existsSync(scoreboardPath) ? readFileSync(scoreboardPath, "utf8") : null;
  const metricPath = join(art, "metric.md");
  const completion = scoreboardMd !== null && existsSync(metricPath)
    ? checkCompletion(scoreboardMd, readFileSync(metricPath, "utf8"))
    : null;

  const budgetPath = join(art, "time-budget.txt");
  const startPath = join(art, "session-start.txt");
  let hardCap: boolean | null = null;
  if (existsSync(budgetPath) && existsSync(startPath)) {
    try {
      hardCap = checkTimeBudget(
        readFileSync(budgetPath, "utf8").trim(),
        readFileSync(startPath, "utf8").trim(),
        Math.floor(Date.parse(deps.now()) / 1000),
      );
    } catch { hardCap = null; }
  }

  // Recent events: tail-10 of EACH part's PANE outbox, merged + sorted desc by ts, capped 10.
  const allEvents: EventRow[] = [];
  for (const instrument of instruments) {
    const model = resolveModel(instrument, topic);
    if (!model) continue;
    const ob = outboxPath(instrument, model, topic);
    if (!existsSync(ob)) continue;
    const lines = readOr(ob).split("\n").filter((l) => l.trim() !== "").slice(-10);
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as { ts?: unknown; event?: unknown };
        allEvents.push({ ts: o.ts != null ? String(o.ts) : "", instrument, event: o.event != null ? String(o.event) : "" });
      } catch { /* skip non-JSON */ }
    }
  }
  allEvents.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const recentEvents = allEvents.slice(0, 10);

  // Warnings -> bullet lines (faithful to render_summary's Warnings section).
  const warnings: string[] = [];
  for (const line of readOr(warningsPath).split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("\t");
    if (f[0] === "size_warn") {
      warnings.push(`- size_warn: ${f[1]} ${f[2]} GB (${f[3]} files)`);
    } else if (f[0] === "audit_warn") {
      warnings.push(`- audit_warn: ${f[1]} ${f[2]} (${f[3]})`);
    }
  }

  const haltPath = join(art, "halt.flag");
  const halt = readHaltFlag(existsSync(haltPath) ? readFileSync(haltPath, "utf8") : null);

  const startedIso = existsSync(startPath) ? readFileSync(startPath, "utf8").trim() : "(unknown)";
  const budget = existsSync(budgetPath) ? readFileSync(budgetPath, "utf8").trim() : "none";

  const summary = renderSessionSummary({
    topic, updatedIso: deps.now(), startedIso, budget,
    statusRows, scoreboardMd, completion, hardCap, recentEvents, warnings, halt,
    finalizedIso: deps.now(),
  });
  atomicWrite(join(art, "session-summary.md"), summary);

  log.ok("finalize: cleanup complete");
  return 0;
}

const liveFinalizeDeps: RehearsalFinalizeDeps = {
  now: () => isoUtc(),
  keepIntermediate: process.env.CONSORT_REHEARSAL_KEEP_INTERMEDIATE ? true : undefined,
  sizeWarnGb: Number(process.env.CONSORT_REHEARSAL_SIZE_WARN_GB) || 2,
};

// ---- Phase D: refine — STATELESS mid-experiment scope-narrowing. ----
// Ports deep-research-refine.sh: write a numbered refine-N.md into the LIVE
// branch (experiment) dir + a best-effort pane nudge. By contract this NEVER
// mutates the state machine (no state.txt / phase / scoreboard touch) — it only
// drops a refinement note the part reads before continuing its current experiment.

export interface RehearsalRefineDeps {
  send(args: string[]): Promise<number>;
  dryRun?: boolean;
  stdout?: (l: string) => void;
  opts?: PathOpts;
}

interface RefineArgs { topic: string; instrument: string; expId: string; text: string; ok: boolean }

/** EXACTLY 4 positionals: <topic> <instrument> <exp-id> <refinement-text>. The
 *  quoted multi-word refinement-text already arrives as one token (applyArgsFile). */
function parseRefineArgs(args: string[]): RefineArgs {
  if (args.length !== 4) return { topic: "", instrument: "", expId: "", text: "", ok: false };
  const [topic, instrument, expId, text] = args;
  return { topic, instrument, expId, text, ok: true };
}

export async function refineWith(args: string[], deps: RehearsalRefineDeps): Promise<number> {
  const p = parseRefineArgs(args);
  if (!p.ok) { log.error("rehearsal refine: usage: <topic> <instrument> <exp-id> <refinement-text>"); return 2; }
  const { topic, instrument, expId, text } = p;

  if (!INSTRUMENT_RE.test(instrument)) { log.error(`instrument must match [a-z][a-z0-9-]*; got '${instrument}'`); return 2; }
  if (!EXP_ID_RE.test(expId)) { log.error(`exp-id must match 'exp-[0-9]+'; got '${expId}'`); return 2; }

  const art = rehearsalArtDir(topic, deps.opts);
  const branchDir = experimentDir(art, instrument, expId);
  if (!existsSync(branchDir) || !statSync(branchDir).isDirectory()) { log.error(`branch dir missing: ${branchDir}`); return 1; }

  // First FREE slot (not max+1) — faithful to the bash `while [ -f refine-$n.md ]`.
  let n = 1;
  while (existsSync(join(branchDir, `refine-${n}.md`))) n++;
  const refinePath = join(branchDir, `refine-${n}.md`);

  // The single trailing newline IS part of the content (bash `printf '%s\n'`).
  atomicWrite(refinePath, text + "\n");
  log.info(`[refine] wrote ${refinePath}`);

  // Best-effort pane nudge (NON-FATAL; refine-N.md is already on disk).
  if (!deps.dryRun) {
    const msg = `REFINE: read ${refinePath} before continuing your current experiment (${expId}).`;
    try {
      const rc = await deps.send(["--from", "maestro", instrument, topic, msg]);
      if (rc !== 0) log.warn(`[refine] send nudge failed; part may not have noticed refine-${n}.md`);
    } catch { log.warn(`[refine] send nudge failed; part may not have noticed refine-${n}.md`); }
  }

  log.ok(`[refine] ${instrument}/${expId} refine-${n}.md sent`);
  return 0;
}

const liveRefineDeps: RehearsalRefineDeps = {
  send: (a) => sendRun(a),
  dryRun: process.env.CONSORT_DRY_RUN === "1",
};

// ---- Phase D: handoff-extract — write handoff-data.kv from the archived art dir. ----
// Ports deep-research-handoff-extract.sh + its extract-handoff-data helper.
// Takes the ART-DIR path DIRECTLY (the directive reruns post-archive with the rebound
// $ART), so the positional is the art dir itself; per-experiment result.json is resolved
// RELATIVE to that art dir — do NOT call rehearsalArtDir on it.

export interface RehearsalHandoffDeps {
  now(): string;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

/** Read result.json under art and parse it; {} on any failure. */
function readResultJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return {}; }
}

export async function handoffExtractWith(args: string[], deps: RehearsalHandoffDeps): Promise<number> {
  const art = args[0];
  if (!art || !existsSync(art) || !statSync(art).isDirectory()) {
    log.error(`rehearsal handoff-extract: art-dir required (got '${art ?? ""}')`); return 2;
  }
  const topicTxt = join(art, "topic.txt");
  if (!existsSync(topicTxt)) { log.error(`rehearsal handoff-extract: topic.txt missing under ${art}`); return 2; }
  const topic = readFileSync(topicTxt, "utf8").replace(/\n/g, " ").replace(/\s+$/, "");

  const sbPath = join(art, "scoreboard.md");
  const { winner, runnerUps } = parseScoreboard(existsSync(sbPath) ? readFileSync(sbPath, "utf8") : "");

  // Landscape doc: first rehearsal-*.md under art -> its basename (omit if none).
  let landscapeDoc: string | undefined;
  for (const name of readdirSync(art).sort()) {
    if (/^rehearsal-.*\.md$/.test(name) && statSync(join(art, name)).isFile()) { landscapeDoc = name; break; }
  }
  const hasMetricMd = existsSync(join(art, "metric.md"));
  const generatedTs = deps.now();

  let input: HandoffInput;
  if (!winner) {
    input = { topic, landscapeDoc, hasMetricMd, generatedTs, winner: null, runnerUps: [] };
  } else {
    const expRel = `parts/${winner.instrument}/experiments/${winner.expId}`;
    const result = readResultJson(join(art, expRel, "result.json"));
    const approach = result.approach_label != null ? String(result.approach_label) : "";
    const notes = String(result.notes ?? "").replace(/\n/g, " ");
    let checkpoint: string | undefined;
    const ckptRaw = result.checkpoint_path != null ? String(result.checkpoint_path) : "";
    if (ckptRaw && ckptRaw !== "null") {
      checkpoint = ckptRaw.startsWith("/") ? ckptRaw : `${expRel}/${ckptRaw}`;
    }
    const runners = runnerUps.map((r) => {
      const rr = readResultJson(join(art, `parts/${r.instrument}/experiments/${r.expId}`, "result.json"));
      return { instrument: r.instrument, exp: r.expId, metric: r.metric, approach: rr.approach_label != null ? String(rr.approach_label) : "" };
    });
    input = {
      topic, landscapeDoc, hasMetricMd, generatedTs,
      winner: {
        instrument: winner.instrument, exp: winner.expId, approach, metric: winner.metric,
        checkpoint, notes: notes || undefined, codeDir: `${expRel}/code/`,
      },
      runnerUps: runners,
    };
  }

  atomicWrite(join(art, "handoff-data.kv"), buildHandoffKv(input));
  log.ok(`handoff-data.kv written: ${join(art, "handoff-data.kv")}`);
  return 0;
}

const liveHandoffDeps: RehearsalHandoffDeps = { now: () => isoUtc() };

// ---- Phase D: teardown — the rehearsal-state ARCHIVE step. ----
// Ports deep-research-teardown.sh, consort-idiomatic: do the rehearsal-specific
// pre-steps (best-effort preflight orphan kill + shared/ sweep + winner symlink),
// then call the shipped archiveTopic (status-stamp + mv _rehearsal -> archive +
// rmdir-if-empty). The PANE teardown is the separate top-level `coda --pairs`
// (run by the directive BEFORE this verb) — NOT this verb's job.

export interface RehearsalTeardownDeps {
  killPane(pane: string): Promise<void>;
  archiveTopic(topic: string, suite: "rehearsal"): string | null;
  now(): string;
  stdout?: (l: string) => void;
  opts?: PathOpts;
}

/** Recursively delete *.tmp / *.lock under `dir` to a max depth (best-effort). */
function sweepTmpLock(dir: string, depth: number): void {
  if (depth < 0) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { sweepTmpLock(p, depth - 1); }
    else if (e.isFile() && (e.name.endsWith(".tmp") || e.name.endsWith(".lock"))) {
      try { rmSync(p, { force: true }); } catch { /* best-effort */ }
    }
  }
}

export async function teardownWith(args: string[], deps: RehearsalTeardownDeps): Promise<number> {
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const topic = args[0];
  if (!topic) { log.error("rehearsal teardown: topic required"); return 2; }

  const art = rehearsalArtDir(topic, deps.opts);
  if (!existsSync(art) || !statSync(art).isDirectory()) { log.error(`${art} not found`); return 1; }

  // 1. Preflight orphan kill (best-effort). Normally already dead from `coda
  //    --pairs`; no-op when preflight-panes.txt is absent (tests/dogfood).
  const pf = join(art, "preflight-panes.txt");
  if (existsSync(pf)) {
    for (const line of readFileSync(pf, "utf8").split("\n")) {
      const pane = line.trim();
      if (!pane) continue;
      try { await deps.killPane(pane); } catch { /* best-effort */ }
    }
  }

  // 2. shared/ sweep (best-effort): drop *.tmp / *.lock leak shapes (depth <= 2).
  //    Scoped to shared/ so part experiment dirs are untouched.
  const shared = join(art, "shared");
  if (existsSync(shared) && statSync(shared).isDirectory()) sweepTmpLock(shared, 2);

  // 3. winner symlink (best-effort): scoreboard top-1 ok row ->
  //    parts/<instrument>/experiments/<exp-id>/code (RELATIVE so it survives the
  //    archive mv; the symlink rides along inside _rehearsal).
  const sbPath = join(art, "scoreboard.md");
  if (existsSync(sbPath)) {
    const { winner } = parseScoreboard(readFileSync(sbPath, "utf8"));
    if (winner) {
      const rel = `parts/${winner.instrument}/experiments/${winner.expId}/code`;
      if (existsSync(join(art, rel)) && statSync(join(art, rel)).isDirectory()) {
        const link = join(art, "winner");
        try { rmSync(link, { force: true }); } catch { /* nothing to replace */ }
        symlinkSync(rel, link);
        log.ok(`[teardown] winner symlink -> ${rel} (${winner.instrument}/${winner.expId})`);
      } else {
        log.warn(`[teardown] scoreboard top-1 dir missing: ${join(art, rel)}; no symlink`);
      }
    } else {
      log.info("[teardown] scoreboard has no ok rows; no winner symlink");
    }
  }

  // 4. archive: status-stamp + mv _rehearsal -> archive + rmdir-if-empty topic dir.
  const dest = deps.archiveTopic(topic, "rehearsal");
  if (dest) {
    out(dest);
    log.ok(`[teardown] archived ${topic} -> ${dest}`);
  }
  return 0;
}

const liveTeardownDeps: RehearsalTeardownDeps = {
  killPane: (p) => killNow(p),
  archiveTopic: (t, s) => archiveTopic(t, s),
  now: () => isoUtc(),
};

// ---- Phase D: forensics — thin captureArtDir wrapper (mirrors score.ts::forensicsRun). ----

export async function forensicsRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("rehearsal forensics: topic required"); return 2; }
  const path = captureArtDir({ artDir: rehearsalArtDir(topic), command: "rehearsal" });
  if (path) { log.ok(`forensics captured: ${path}`); process.stdout.write(path + "\n"); }
  else log.info("rehearsal forensics: no mechanical findings");
  return 0;
}

// ---- Phase D: fresh-part — graceful codex-session reset by pane respawn. ----
// Ports the deep-research fresh-part reset: teardown the part's pane + respawn the SAME
// instrument on the SAME topic, reset runtime state (phase=idle, current_exp_id=,
// probe_sent_ts=) but PRESERVE exp_counter. Refuse mid-experiment (phase=working).
// state event last_event=fresh-part-respawn.

export interface RehearsalFreshPartDeps {
  teardown(topic: string, instrument: string): Promise<void>;
  spawn(args: string[]): Promise<number>;
  now(): string;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

export async function freshPartWith(args: string[], deps: RehearsalFreshPartDeps): Promise<number> {
  if (args.length !== 2) { log.error("rehearsal fresh-part: usage: <topic> <instrument>"); return 2; }
  const [topic, instrument] = args;
  if (!INSTRUMENT_RE.test(instrument)) { log.error(`instrument must match [a-z][a-z0-9-]*; got '${instrument}'`); return 2; }

  const art = rehearsalArtDir(topic, deps.opts);
  const stateTxt = join(partStateDir(art, instrument), "state.txt");
  if (!existsSync(stateTxt)) { log.error(`part state.txt missing: ${stateTxt}`); return 1; }

  const prev = parseState(readFileSync(stateTxt, "utf8"));
  // Refuse mid-experiment (rc 1, faithful to the bash — NOT rc 2).
  if (prev.phase === "working") {
    log.error(`part ${instrument} is mid-experiment (phase=working); abort or wait for done before fresh-part.`);
    return 1;
  }

  // Preserve the experiment counter (next dispatch numbers correctly); default 0 if non-numeric.
  const prevCounter = /^[0-9]+$/.test(prev.exp_counter ?? "") ? (prev.exp_counter as string) : "0";

  // Teardown the live pane gracefully — best-effort; a missing/dead pane must not block respawn.
  log.info(`[fresh-part] tearing down ${instrument}'s pane on ${topic} ...`);
  try { await deps.teardown(topic, instrument); } catch { /* best-effort — a missing/dead pane must not block respawn */ }

  // Respawn in a new pane — same instrument, same topic.
  log.info(`[fresh-part] respawning ${instrument} ...`);
  const rc = await deps.spawn([instrument, "codex", topic]);
  if (rc !== 0) { log.error(`spawn failed for ${instrument} on ${topic}`); return 1; }

  // Reset runtime state AFTER a successful spawn, preserving exp_counter (+ all other keys).
  atomicWrite(stateTxt, mergeState(readFileSync(stateTxt, "utf8"), {
    last_event: "fresh-part-respawn",
    last_event_ts: deps.now(),
    phase: "idle",
    current_exp_id: "",
    exp_counter: prevCounter,
    probe_sent_ts: "",
  }));

  log.ok(`[fresh-part] ${instrument} respawned on ${topic}; state preserved (exp_counter=${prevCounter})`);
  return 0;
}

const liveFreshPartDeps: RehearsalFreshPartDeps = {
  teardown: (t, i) => codaRun(["--pairs", t, i]).then(() => undefined),
  spawn: (a) => spawnRun(a),
  now: () => isoUtc(),
};

// ---- Phase D: abort — graceful one-shot teardown. ----
// Ports deep-research-abort.sh: capture Monitor task ids BEFORE teardown (teardown
// archives monitor-tasks.txt away), write halt.flag, finalize, teardown, then print a
// TaskStop deferral hint (LOG ONLY — TaskStop itself is the directive's harness tool).

export interface RehearsalAbortDeps {
  finalize(topic: string): Promise<number>;
  teardown(topic: string): Promise<number>;
  now(): string;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

export async function abortWith(args: string[], deps: RehearsalAbortDeps): Promise<number> {
  if (args.length < 1 || args.length > 2) { log.error("rehearsal abort: usage: <topic> [reason]"); return 2; }
  const topic = args[0];
  const reason = args[1] ?? "unspecified";

  const art = rehearsalArtDir(topic, deps.opts);
  if (!existsSync(art) || !statSync(art).isDirectory()) {
    log.error(`no active rehearsal session for topic: ${topic} (art-dir ${art} missing)`); return 1;
  }

  // Capture Monitor task ids BEFORE teardown moves monitor-tasks.txt into the archive.
  const mt = join(art, "monitor-tasks.txt");
  const ids = existsSync(mt)
    ? readFileSync(mt, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : [];

  // halt.flag — the ONE state file written NON-atomically (plain writeFileSync),
  // faithful to the bash brace-group redirect + the loop's plain write.
  writeFileSync(join(art, "halt.flag"), `halted_by=user\nhalted_at=${deps.now()}\nreason=${reason}\n`);
  log.info(`halt.flag written (${reason})`);

  const frc = await deps.finalize(topic);
  if (frc !== 0) { log.error("finalize failed"); return 1; }
  const trc = await deps.teardown(topic);
  if (trc !== 0) { log.error("teardown failed"); return 1; }

  // TaskStop deferral hint (LOG ONLY — TaskStop is the harness tool the directive fires).
  if (ids.length > 0) {
    log.info(`note: ${ids.length} Monitor task(s) still active; will TaskStop on next Maestro turn (halt.flag detected):`);
    for (const id of ids) log.info(`  - ${id}`);
  } else {
    log.info("no Monitor tasks to stop");
  }

  log.ok(`rehearsal session ${topic} aborted`);
  return 0;
}

const liveAbortDeps: RehearsalAbortDeps = {
  finalize: (t) => finalizeWith([t], liveFinalizeDeps),
  teardown: (t) => teardownWith([t], liveTeardownDeps),
  now: () => isoUtc(),
};

// ---- Phase D: consensus — advisory latest-ok agreement matrix. ----
// Ports deep-research-consensus.sh (standalone, advisory). Walks each part's
// experiments in ascending order, keeps the lexically-greatest exp whose
// result.json parses with status === "ok" as that part's representative, then
// hands the per-part field maps to the pure buildConsensus renderer.

export interface RehearsalConsensusDeps {
  now(): string;
  epsilon?: number;
  stdout?: (line: string) => void;
  opts?: PathOpts;
}

interface ConsensusArgs { topic: string; epsilon: number; badArgs: boolean }

/** Parse --epsilon=<f> / --epsilon <f> (default 0.01) + a single positional <topic>. */
function parseConsensusArgs(args: string[]): ConsensusArgs {
  let epsilon = 0.01, topic = "", badArgs = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--epsilon" || a.startsWith("--epsilon=")) { const r = kvParse(a, args[i + 1]); epsilon = parseFloat(r.value); i += r.shift - 1; }
    else if (a.startsWith("-")) { badArgs = true; }
    else { topic = a; }
  }
  return { topic, epsilon, badArgs };
}

export async function consensusWith(args: string[], deps: RehearsalConsensusDeps): Promise<number> {
  const p = parseConsensusArgs(args);
  if (p.badArgs) { log.error("rehearsal consensus: unknown flag"); return 2; }
  if (!p.topic) { log.error("rehearsal consensus: topic required"); return 2; }
  const epsilon = deps.epsilon ?? p.epsilon;

  const art = rehearsalArtDir(p.topic, deps.opts);
  const partsRoot = partsDir(art);
  if (!existsSync(partsRoot)) { log.error(`rehearsal consensus: no parts dir under ${art}`); return 1; }

  // Per part: the lexically-greatest exp-NNN whose result.json parses with status === "ok".
  const latestOk: Record<string, Record<string, unknown>> = {};
  let instruments: string[];
  try {
    instruments = readdirSync(partsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { instruments = []; }
  for (const instrument of instruments) {
    const expsRoot = experimentsDir(art, instrument);
    let names: string[];
    try { names = readdirSync(expsRoot).filter((n) => EXP_ID_RE.test(n)).sort(); } catch { continue; }
    let newest = "";
    for (const exp of names) {
      const resultPath = join(experimentDir(art, instrument, exp), "result.json");
      if (!existsSync(resultPath)) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>; } catch { continue; }
      if (parsed.status !== "ok") continue;
      if (exp > newest) { newest = exp; latestOk[instrument] = parsed; }
    }
  }

  if (Object.keys(latestOk).length === 0) { log.error("rehearsal consensus: no ok result.json files found"); return 1; }

  const md = buildConsensus(latestOk, { topic: p.topic, nowIso: deps.now(), epsilon });
  atomicWrite(join(art, "consensus.md"), md);
  log.ok(`[consensus] wrote ${join(art, "consensus.md")} (${Object.keys(latestOk).length} parts)`);
  return 0;
}

const liveConsensusDeps: RehearsalConsensusDeps = { now: () => isoUtc() };

export async function run(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  switch (verb) {
    case "init": return initWith(applyArgsFile(rest), liveInitDeps);
    case "metric": return metricWith(rest);
    case "sota": return sotaWith(rest);
    case "spawn-all": return spawnAllWith(rest, liveSpawnAllDeps);
    case "experiment-send": return experimentSendWith(applyArgsFile(rest), liveExperimentSendDeps);
    case "score": return scoreWith(rest, liveScoreDeps);
    case "monitor": return monitorRun(rest);
    case "status-brief": return statusBriefWith(rest);
    case "finalize": return finalizeWith(rest, liveFinalizeDeps);
    case "refine": return refineWith(applyArgsFile(rest), liveRefineDeps);
    case "handoff-extract": return handoffExtractWith(rest, liveHandoffDeps);
    case "teardown": return teardownWith(rest, liveTeardownDeps);
    case "fresh-part": return freshPartWith(rest, liveFreshPartDeps);
    case "forensics": return forensicsRun(rest);
    case "abort": return abortWith(applyArgsFile(rest), liveAbortDeps);
    case "consensus": return consensusWith(rest, liveConsensusDeps);
    default: log.error(`rehearsal: unknown verb: ${verb ?? "(none)"}`); return 2;
  }
}
