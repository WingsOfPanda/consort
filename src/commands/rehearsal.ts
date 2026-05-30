// /consort:rehearsal CLI verbs (Phase B front half). Ports deep-research-init.sh
// (slug/codex-gate/flags/scaffolding) + the deep-research.md Phase 0-3 surface.
// Phase C: experiment-send (dispatch ONE experiment to a persistent codex part).
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile, kvParse } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { deriveSlug } from "../core/solo.js";
import { extractMetric, formatMetricBlock, formatSotaBlock, parseMetricMd } from "../core/rehearsalMetric.js";
import { rehearsalArtDir, partsDir, partStateDir, experimentDir } from "../core/rehearsal.js";
import { computeScore, type ScoreFs, type ScoreComputation } from "../core/rehearsalScore.js";
import { parseState } from "../core/rehearsalState.js";
import {
  renderExperimentPrompt, buildSotaBlock, assembleHardwareBlock, hardwareDiffAlert,
  formatPeersBlock, buildDispatchState, EXP_ID_RE, INSTRUMENT_RE, type PeerRow,
} from "../core/rehearsalExperiment.js";
import { instrumentBinary, consultTimeout } from "../core/contracts.js";
import { inboxWrite, inboxPath, outboxPath, paneMetaRead, resolveModel } from "../core/ipc.js";
import { paneSend } from "../core/tmux.js";
import { haveCmd } from "../core/deps.js";
import { spawnRosterArg, parsePanesFile, spawnResultsTsv, spawnTally, type SpawnResult } from "../core/score.js";
import { pickInstruments } from "../core/instruments.js";
import { repoRoot } from "../core/paths.js";
import { run as spawnRun } from "./spawn.js";
import { run as preflightRun } from "./preflight.js";

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

export async function run(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  switch (verb) {
    case "init": return initWith(applyArgsFile(rest), liveInitDeps);
    case "metric": return metricWith(rest);
    case "sota": return sotaWith(rest);
    case "spawn-all": return spawnAllWith(rest, liveSpawnAllDeps);
    case "experiment-send": return experimentSendWith(applyArgsFile(rest), liveExperimentSendDeps);
    case "score": return scoreWith(rest, liveScoreDeps);
    default: log.error(`rehearsal: unknown verb: ${verb ?? "(none)"}`); return 2;
  }
}
