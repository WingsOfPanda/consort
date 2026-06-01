// src/commands/perform.ts — single-repo command path for /consort:perform.
// Byte-faithful port of the prior bash plugin's deploy verb set; WIRES the Phase-A core modules.
// Rebrand: _deploy/->_perform/, feat/deploy-->feat/perform-, conductor sender->From: maestro.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile, kvParse } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { repoRoot, repoStateDir } from "../core/paths.js";
import { auditDoc } from "../core/audit.js";
import {
  parsePerformArgs, deriveTopicFromPath, resolveTarget, detectProvider,
  performArtDir, iterTargets, assertPerformTopic, PerformArgError, PerformResolveError,
} from "../core/perform.js";
import { isoUtc, archiveTopic } from "../core/archive.js";
import { extractComponentsPaths, matchDiffAgainstComponents } from "../core/performScope.js";
import { runnerAt, preSnapshot, createOrResumeBranch, shortstat, finishBranchAction, type Runner } from "../core/gitwork.js";
import { runForensics } from "../core/forensics.js";
import { haveCmd } from "../core/deps.js";
import { performState, composeRound1Prompt, composeFixPrompt, composeDagUnitPrompt } from "../core/performTurn.js";
import { pickInstruments } from "../core/instruments.js";
import { extractQuestionPayload } from "../core/performQuestions.js";
import { outboxOffset, outboxPath, outboxWaitSince, statusPath, resolveModel, type OutboxEvent } from "../core/ipc.js";
import { instrumentTimeoutMultiplier } from "../core/contracts.js";
import { scaledTimeout, parseLatestOffset } from "../core/scoreTurn.js";
import { parseDagLine, dagTopological, dagSectionBody, dagFanInRepos } from "../core/dag.js";
// note: verify-dag-repos uses node.repo (the DagNode slug field) + an em-dash-separated DAG line.
import {
  enumerateSiblings, captureSiblingBaseline, formatBaselineFile,
  parseBaselineFile, diffSiblingAgainstBaseline, revertAndReplay,
} from "../core/performSibling.js";
import { run as sendRun } from "./send.js";
import { detectTestCommand } from "../core/solo.js";

const PART = "cody";
const PERFORM_TURN_TIMEOUT = (): number => Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400;

/** model for the cody part = the resolved provider (codex|claude). Reads provider.txt; default codex. */
function partModel(art: string): string {
  const p = join(art, "provider.txt");
  return existsSync(p) ? (readFileSync(p, "utf8").trim() || "codex") : "codex";
}
/** Multi-repo iff the PLURAL Target header + an Execution DAG are both present (deploy-init.sh:87). */
function detectRouting(docText: string): "single" | "multi" {
  return /^\*\*Target Sub-Project\(s\):\*\*/m.test(docText) && /^## Execution DAG[ \t]*$/m.test(docText) ? "multi" : "single";
}
function usage(): number {
  log.error("usage: perform <init|audit|pre-snapshot|branch|turn-send|turn-wait|reset-status|scope-check|sibling-baseline|sibling-verify|sibling-rescue|cross-signal|summary|finish|finish-one|forensics|archive|dag-parse|wave-wait|multi-init|send-unit|drop-part|find-latest-doc|verify-dag-repos> ...");
  return 2;
}

// ---- find-latest-doc (deploy Step 0.4 no-arg source default) — newest */_score/design-doc/*-design.md by mtime ----
async function findLatestDocRun(rest: string[]): Promise<number> {
  let cwd: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--cwd") { cwd = rest[i + 1]; i++; }
    else if (rest[i].startsWith("--cwd=")) { cwd = rest[i].slice("--cwd=".length); }
  }
  const stateDir = repoStateDir(cwd ? { cwd } : undefined);
  let best: { path: string; mt: number } | null = null;
  if (existsSync(stateDir)) for (const topic of readdirSync(stateDir)) {
    const dd = join(stateDir, topic, "_score", "design-doc");
    if (!existsSync(dd)) continue;
    for (const f of readdirSync(dd)) {
      if (!f.endsWith("-design.md")) continue;
      const p = join(dd, f); let mt = 0;
      try { mt = statSync(p).mtimeMs; } catch { continue; }
      if (!best || mt > best.mt) best = { path: p, mt };
    }
  }
  if (!best) { log.error("perform find-latest-doc: no *-design.md found"); return 1; }
  process.stdout.write(`DOC=${best.path}\n`);
  return 0;
}

// ---- audit (deploy.md Step 0 "Proceed anyway" precheck, standalone) ----
// rc 0 = PASS, 1 = FAIL (ISSUE= lines on stderr), 2 = unreadable/bad usage.
async function auditRun(rest: string[]): Promise<number> {
  const doc = rest[0];
  if (!doc || rest.length !== 1) { log.error("usage: perform audit <doc>"); return 2; }
  if (!existsSync(doc)) { log.error(`perform audit: doc unreadable: ${doc}`); return 2; }
  let text: string;
  try { text = readFileSync(doc, "utf8"); } catch { log.error(`perform audit: doc unreadable: ${doc}`); return 2; }
  const ad = auditDoc(text);
  if (ad.verdict === "FAIL") { for (const i of ad.issues) process.stderr.write(`ISSUE=${i}\n`); return 1; }
  log.ok(`perform audit: PASS ${doc}`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0]; const rest = args.slice(1);
  switch (verb) {
    case "init":      return initRun(applyArgsFile(rest));
    case "audit":     return auditRun(rest);
    case "turn-send": return turnSendRun(rest);
    case "turn-wait": return turnWaitRun(rest);
    case "reset-status": return resetStatusRun(rest);
    case "pre-snapshot": return preSnapshotRun(rest);
    case "branch":       return branchRun(applyArgsFile(rest));
    case "scope-check":  return scopeCheckRun(rest);
    case "sibling-baseline": return siblingBaselineRun(rest);
    case "sibling-verify":   return siblingVerifyRun(rest);
    case "sibling-rescue":   return siblingRescueRun(rest);
    case "cross-signal":     return crossSignalRun(rest);
    case "summary":      return summaryRun(rest);
    case "finish":       return finishRun(rest);
    case "finish-one":   return finishOneRun(rest);
    case "forensics":    return forensicsRun(rest);
    case "archive":      return archiveRun(rest);
    case "dag-parse":    return dagParseRun(rest);
    case "wave-wait":    return waveWaitRun(rest);
    case "multi-init": return multiInitRun(rest);
    case "send-unit":  return sendUnitRun(rest);
    case "drop-part":  return dropPartRun(rest);
    case "find-latest-doc": return findLatestDocRun(rest);
    case "verify-dag-repos": return verifyDagReposRun(rest);
    default:          return usage();
  }
}

// ---- init (deploy-init.sh + deploy.md Step 0 audit, folded in) ----
export interface PerformInitDeps { repoRoot(): string; }
const liveInitDeps: PerformInitDeps = { repoRoot };
async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: PerformInitDeps): Promise<number> {
  let parsed; try { parsed = parsePerformArgs(tokens); }
  catch (e) { if (e instanceof PerformArgError) { log.error(e.message); return e.code; } throw e; }
  const designPath = parsed.rest.trim();
  if (!designPath || designPath.includes(" ")) { log.error("perform init: exactly one design-doc path is required"); return 2; }
  if (!existsSync(designPath)) { log.error(`perform init: design doc unreadable: ${designPath}`); return 1; }
  const text = readFileSync(designPath, "utf8");
  const topic = parsed.topic || deriveTopicFromPath(designPath);
  if (!topic) { log.error("perform init: could not derive topic; pass --topic <slug>"); return 1; }
  if (!assertPerformTopic(topic)) { log.error(`perform init: invalid topic slug '${topic}' (must match ^[a-z0-9][a-z0-9-]{0,31}$, <= 32 chars; pass a shorter --topic)`); return 2; }

  const ad = auditDoc(text);
  if (ad.verdict === "FAIL") {
    for (const i of ad.issues) process.stderr.write(`ISSUE=${i}\n`);
    if (!parsed.force) { log.error(`perform init: audit FAILED on ${designPath}`); return 1; }
    log.warn(`perform init: audit FAILED on ${designPath} but --force given; proceeding`);
  }

  const art = performArtDir(topic);
  if (existsSync(art)) { log.error(`perform init: topic already in flight: ${art} (run /consort:coda or pick a different --topic)`); return 2; }

  let targetCwd: string;
  try { targetCwd = resolveTarget(designPath, d.repoRoot()); }
  catch (e) { if (e instanceof PerformResolveError) { log.error(e.message); return e.code; } throw e; }

  const routing = parsed.targets.length > 0 ? "multi" : detectRouting(text);
  const provider: string = detectProvider(targetCwd);

  mkdirSync(art, { recursive: true });
  atomicWrite(join(art, "design.md"), text);
  atomicWrite(join(art, "topic.txt"), topic);                       // NO trailing newline
  atomicWrite(join(art, "target_cwd.txt"), targetCwd + "\n");
  atomicWrite(join(art, "provider.txt"), provider + "\n");
  atomicWrite(join(art, "auto_provider.txt"), provider + "\n");   // deploy claude-confirm marker (the auto-detected provider)
  atomicWrite(join(art, "multi-repo.txt"), (routing === "multi" ? "multi" : "single") + "\n");

  log.ok(`perform init: topic=${topic} routing=${routing} provider=${provider}`);
  process.stdout.write(`ART=${art}\nTOPIC=${topic}\nROUTING=${routing}\nPROVIDER=${provider}\nTARGET_CWD=${targetCwd}\n`);
  return 0;
}

// ---- turn-send (deploy-turn-send.sh) — offset-before-send dispatch ----
export interface PerformSendDeps { offsetFor(i: string, m: string, t: string): number; send(args: string[]): Promise<number>; }
const liveSendDeps: PerformSendDeps = { offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)), send: sendRun };
async function turnSendRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  if (!topic || !roundStr) { log.error("usage: perform turn-send <topic> <round>"); return 2; }
  if (!/^[1-9][0-9]*$/.test(roundStr)) { log.error(`perform turn-send: round must be a positive integer (got: ${roundStr})`); return 1; }
  return turnSendWith(topic, Number(roundStr), liveSendDeps);
}
export async function turnSendWith(topic: string, round: number, d: PerformSendDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform turn-send: ${art} not found — run perform init first`); return 1; }
  const model = partModel(art);
  const targetCwd = existsSync(join(art, "target_cwd.txt")) ? readFileSync(join(art, "target_cwd.txt"), "utf8").trim() : "";
  const testCmd = targetCwd ? detectTestCommand(targetCwd) : "";
  const stateFile = join(art, `turn-cody-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`perform turn-send: ${stateFile} already exists; rm to retry`); return 1; }
  const outbox = outboxPath(PART, model, topic);
  if (!existsSync(outbox)) { log.error(`perform turn-send: outbox not found at ${outbox} — was cody spawned?`); return 1; }
  const sp = statusPath(PART, model, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`perform turn-send: part not idle (state=${m[1]}); previous turn still in flight`); return 1; } }
  const promptFile = join(art, `cody_turn_prompt_${round}.md`);
  if (round === 1) atomicWrite(promptFile, composeRound1Prompt({ designPath: join(art, "design.md"), planPath: join(art, "plan.md"), verifyPath: join(art, "verify-report-1.md"), round, testCmd }));
  else { const bundle = join(art, `fix-prompt-${round}.md`); if (!existsSync(bundle)) { log.error(`perform turn-send: fix-prompt-${round}.md not found at ${bundle}; the directive must write it first`); return 1; } atomicWrite(promptFile, composeFixPrompt(round, readFileSync(bundle, "utf8"), join(art, `verify-report-${round}.md`), testCmd)); }
  const offset = d.offsetFor(PART, model, topic);             // BEFORE send (deploy_send_dispatch order)
  atomicWrite(stateFile, `OFFSET=${offset}\n`);
  const rc = await d.send(["--from", "maestro", PART, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`perform turn-send: send failed (rc=${rc}); ${stateFile} kept (rm to retry)`); return 1; }
  log.info(`[turn-send] cody round=${round} offset=${offset}`); return 0;
}

// ---- turn-wait (deploy-turn-wait.sh) — rc 0 ALWAYS; TS= carries outcome ----
export interface PerformWaitDeps { wait(i: string, m: string, t: string, off: number, ev: string[], to: number): Promise<OutboxEvent | null>; multiplier(model: string): string; now(): number; }
const liveWaitDeps: PerformWaitDeps = { wait: outboxWaitSince, multiplier: instrumentTimeoutMultiplier, now: () => Math.floor(Date.now() / 1000) };
async function turnWaitRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  if (!topic || !roundStr) { log.error("usage: perform turn-wait <topic> <round>"); return 2; }
  if (!/^[1-9][0-9]*$/.test(roundStr)) { log.error(`perform turn-wait: round must be a positive integer (got: ${roundStr})`); return 1; }
  return turnWaitWith(topic, Number(roundStr), liveWaitDeps);
}
export async function turnWaitWith(topic: string, round: number, d: PerformWaitDeps): Promise<number> {
  const art = performArtDir(topic);
  const model = partModel(art);
  const stateFile = join(art, `turn-cody-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`perform turn-wait: ${stateFile} missing — run perform turn-send first`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`perform turn-wait: OFFSET not set in ${stateFile}`); return 1; }
  const timeout = scaledTimeout(PERFORM_TURN_TIMEOUT(), d.multiplier(model));
  log.info(`[turn-wait] cody round=${round} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(PART, model, topic, offset, ["done", "error", "question"], timeout);
  const verifyPath = join(art, `verify-report-${round}.md`);
  const verifyText = existsSync(verifyPath) ? readFileSync(verifyPath, "utf8") : null;
  let ts = performState(ev, verifyText);
  if (ts === "question" && ev) {
    const payload = extractQuestionPayload(ev, d.now());
    if (payload !== null) {
      atomicWrite(join(art, `question-cody-${round}.txt`), payload);
      const bumped = outboxOffset(outboxPath(PART, model, topic));
      appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n`);
    } else { ts = "failed"; appendFileSync(stateFile, "TS=failed\n"); log.warn("[turn-wait] malformed question (no message); downgraded to failed"); }
  } else appendFileSync(stateFile, `TS=${ts}\n`);
  writeFileSync(join(art, `turn-cody-${round}.done`), "");
  log.ok(`[turn-wait] cody round=${round} TS=${ts}`); return 0;
}

// ---- reset-status — force a not-idle part back to idle (deploy "Force-retry" recovery) ----
// The not-idle gate in turnSendWith refuses when status.json state != idle. After a timed-out
// turn the part is left non-idle; the directive calls this to force-reset so the retry can send.
async function resetStatusRun(rest: string[]): Promise<number> {
  const [topic, instrument] = rest;
  if (!topic || !instrument || rest.length !== 2) { log.error("usage: perform reset-status <topic> <instrument>"); return 2; }
  const model = resolveModel(instrument, topic);
  if (model === null) { log.error(`perform reset-status: no part for instrument=${instrument} on topic=${topic}`); return 1; }
  atomicWrite(statusPath(instrument, model, topic), `{"state":"idle","last_event":"force-reset"}\n`);
  log.ok(`perform reset-status: ${instrument} state=idle`);
  return 0;
}

// ---- key=value baseline reader (port of deploy_kv_file_field) + small helpers ----
export function kvFileField(file: string, key: string): string {
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split("\n")) { const eq = line.indexOf("="); if (eq > 0 && line.slice(0, eq) === key) return line.slice(eq + 1); }
  return "";
}
function branchMapField(map: string, slug: string): string {
  if (!existsSync(map)) return "";
  for (const line of readFileSync(map, "utf8").split("\n")) { const [s, b] = line.split("\t"); if (s === slug) return b ?? ""; }
  return "";
}
function isDir(p: string): boolean { try { return statSync(p).isDirectory(); } catch { return false; } }
function hasRepoMarker(dir: string): boolean {
  return existsSync(join(dir, "CLAUDE.md")) || existsSync(join(dir, "AGENTS.md"));
}

// ---- pre-snapshot (deploy-pre-snapshot.sh) ----
async function preSnapshotRun(rest: string[]): Promise<number> {
  if (rest.length !== 1) { log.error("usage: perform pre-snapshot <topic>"); return 2; }
  return preSnapshotWith(rest[0], {}, runnerAt);
}
export async function preSnapshotWith(topic: string, opts: { home?: string; cwd?: string }, runnerFor: (cwd: string) => Runner): Promise<number> {
  const art = performArtDir(topic, opts);
  if (!existsSync(art)) { log.error(`perform pre-snapshot: art-dir missing: ${art} (run perform init first)`); return 1; }
  mkdirSync(join(art, "baselines"), { recursive: true });
  let clean = 0, committed = 0, blocked = 0;
  for (const { slug, cwd } of iterTargets(topic, opts)) {
    if (!slug || !cwd) continue;
    const snap = preSnapshot(runnerFor(cwd), "perform", topic);
    if (snap.state === "not-git") { log.error(`perform pre-snapshot: not a git repository: ${cwd}`); return 2; }
    atomicWrite(join(art, "baselines", `${slug}.tsv`),
      `slug=${slug}\ncwd=${cwd}\nbranch=${snap.branch}\nbaseline_sha=${snap.baseSha}\nstate=${snap.state}\nsnapshot_ts=${isoUtc()}\n`);
    if (snap.state === "clean") clean++; else if (snap.state === "wip-committed") committed++; else if (snap.state === "hook-blocked") blocked++;
  }
  log.ok(`perform pre-snapshot: ${clean} clean, ${committed} committed, ${blocked} hook-blocked`); return 0;
}

// ---- branch (deploy-branch.sh) ----
async function branchRun(rest: string[]): Promise<number> {
  let noBranch = false, branchName: string | undefined; const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) { const t = rest[i];
    if (t === "--no-branch") { noBranch = true; continue; }
    if (t === "--branch" || t.startsWith("--branch=")) { const { value, shift } = kvParse(t, rest[i + 1]); branchName = value; if (shift === 2) i++; continue; }
    pos.push(t); }
  if (pos.length !== 1) { log.error("usage: perform branch [--no-branch] [--branch <name>] <topic>"); return 2; }
  return branchWith({ topic: pos[0], noBranch, branchName }, {}, runnerAt);
}
export async function branchWith(a: { topic: string; noBranch: boolean; branchName?: string }, opts: { home?: string; cwd?: string }, runnerFor: (cwd: string) => Runner): Promise<number> {
  const art = performArtDir(a.topic, opts);
  if (!existsSync(art)) { log.error(`perform branch: art-dir missing: ${art} (run perform init first)`); return 1; }
  const defaultBranch = a.branchName ?? `feat/perform-${a.topic}`;
  const rows: string[] = [];
  for (const { slug, cwd } of iterTargets(a.topic, opts)) {
    if (!slug || !cwd) continue;
    const r = runnerFor(cwd); let recorded: string;
    if (a.noBranch) { recorded = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)"; log.info(`branch: (--no-branch) staying on ${recorded} in ${cwd}`); }
    else if (r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${defaultBranch}`]).code === 0) { createOrResumeBranch(r, defaultBranch); log.info(`branch: resumed ${defaultBranch} in ${cwd}`); recorded = defaultBranch; }
    else if (createOrResumeBranch(r, defaultBranch)) { log.info(`branch: created ${defaultBranch} in ${cwd}`); recorded = defaultBranch; }
    else { recorded = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)"; log.warn(`branch: checkout -b failed in ${cwd}; staying on current branch`); }
    rows.push(`${slug}\t${recorded}`);
    const baseline = join(art, "baselines", `${slug}.tsv`);
    if (existsSync(baseline)) { const m = readFileSync(baseline, "utf8").match(/^baseline_sha=(.*)$/m); if (m) atomicWrite(join(art, "branch-base.sha"), m[1] + "\n"); }
  }
  atomicWrite(join(art, "perform-branches.tsv"), rows.length ? rows.join("\n") + "\n" : "");
  log.ok(`perform branch: ${rows.length} target(s) recorded`); return 0;
}

// ---- scope-check (deploy-scope) ----
export interface ScopeDeps { runnerFor(cwd: string): Runner; }
const liveScopeDeps: ScopeDeps = { runnerFor: runnerAt };
async function scopeCheckRun(rest: string[]): Promise<number> { const topic = rest[0]; if (!topic) { log.error("usage: perform scope-check <topic>"); return 2; } return scopeCheckWith(topic, liveScopeDeps); }
/**
 * Scope conformance: collect the diff path set, then match it against the design's Components
 * paths. Multi-repo (parts.txt present) collects each declared sub-repo's diff and prefixes every
 * path with `<repo>/` (repo = basename(cwd)); single-repo path stays byte-identical (deploy.sh
 * `deploy.md:1304-1319` multi-repo diff-collection branch). Per-part baseline SHA comes from
 * `baselines/<slug>.tsv` field `baseline_sha` (the single `branch-base.sha` is last-target-wins for
 * multi and must NOT be used per-repo).
 */
export async function scopeCheckWith(topic: string, d: ScopeDeps): Promise<number> {
  const art = performArtDir(topic);
  const designFile = join(art, "design.md");
  const partsFile = join(art, "parts.txt");
  let diffPaths: string[];
  if (existsSync(partsFile)) {
    // Multi-repo (deploy.md:1304-1313): per-sub-repo diff, prefixed with the repo slug.
    if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
    diffPaths = [];
    for (const t of iterTargets(topic)) {
      if (!t.slug || !t.cwd) continue;
      const base = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "baseline_sha");
      if (!base) continue;
      const repo = basename(t.cwd);
      const sub = d.runnerFor(t.cwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
      for (const p of sub) diffPaths.push(`${repo}/${p}`);
    }
  } else {
    // Single-repo — UNCHANGED behavior (target_cwd.txt + branch-base.sha).
    const targetFile = join(art, "target_cwd.txt"), baseFile = join(art, "branch-base.sha");
    if (!existsSync(targetFile) || !existsSync(baseFile)) { log.error(`perform scope-check: target_cwd.txt/branch-base.sha missing under ${art}`); return 1; }
    if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
    const targetCwd = readFileSync(targetFile, "utf8").split("\n")[0].trim();
    const base = readFileSync(baseFile, "utf8").split("\n")[0].trim();
    diffPaths = d.runnerFor(targetCwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
  }
  atomicWrite(join(art, "diff-paths.txt"), diffPaths.length ? diffPaths.join("\n") + "\n" : "");
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`OOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
}

// ---- sibling guard (deploy-sibling-baseline.sh / deploy-sibling-verify.sh / deploy-sibling.sh) ----
export interface SiblingDeps { runnerFor(cwd: string): Runner; }
const liveSiblingDeps: SiblingDeps = { runnerFor: runnerAt };

async function siblingBaselineRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-baseline <topic> <hub-cwd>"); return 2; }
  return siblingBaselineWith(topic, hub, liveSiblingDeps);
}
export async function siblingBaselineWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform sibling-baseline: art-dir missing: ${art}`); return 1; }
  if (!isDir(hubCwd)) { log.error(`perform sibling-baseline: hub-cwd not a directory: ${hubCwd}`); return 1; }
  const declared = iterTargets(topic).map((t) => basename(t.cwd)).filter((x) => x.length > 0);
  const { outcome, siblings } = enumerateSiblings(hubCwd, declared);
  if (outcome === "not-a-directory") { log.error(`perform sibling-baseline: hub-cwd not enumerable: ${hubCwd}`); return 1; }
  const rows: string[] = [];
  for (const slug of siblings) {
    const sibCwd = join(hubCwd, slug);
    const res = captureSiblingBaseline(d.runnerFor(sibCwd), sibCwd);
    if (res.outcome === "ok" && res.row) rows.push(res.row);
    else log.warn(`perform sibling-baseline: skipped ${slug} (${res.outcome})`);
  }
  atomicWrite(join(art, "sibling-baseline.txt"), formatBaselineFile(rows));
  log.info(`perform sibling-baseline: ${rows.length} sibling repo(s) captured`);
  return 0;
}

async function siblingVerifyRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-verify <topic> <hub-cwd>"); return 2; }
  return siblingVerifyWith(topic, hub, liveSiblingDeps);
}
export async function siblingVerifyWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  const baselineFile = join(art, "sibling-baseline.txt");
  if (!isDir(hubCwd)) { log.error(`perform sibling-verify: hub-cwd not a directory: ${hubCwd}`); return 1; }
  if (!existsSync(baselineFile)) { log.error(`perform sibling-verify: no sibling-baseline.txt under ${art} (run sibling-baseline first)`); return 1; }
  const rows = parseBaselineFile(readFileSync(baselineFile, "utf8"));
  const out: string[] = [];
  for (const { slug, sha, branch } of rows) {
    const sibCwd = join(hubCwd, slug);
    const res = diffSiblingAgainstBaseline(d.runnerFor(sibCwd), sha, branch);
    if (res.outcome !== "ok") { log.warn(`perform sibling-verify: diff failed for ${slug} (${res.outcome}); skipping`); continue; }
    for (const line of (res.log ?? "").split("\n")) {
      if (line.length === 0) continue;
      const sp = line.indexOf(" ");
      const csha = sp === -1 ? line : line.slice(0, sp);
      const subject = sp === -1 ? line : line.slice(sp + 1);   // byte-faithful to bash ${line#* }
      out.push(`${slug}\t${csha}\t${subject}`);
    }
  }
  atomicWrite(join(art, "sibling-rogue.txt"), out.length ? out.join("\n") + "\n" : "");
  if (out.length > 0) log.warn(`perform sibling-verify: ${out.length} rogue commit(s) on undeclared sibling main branches`);
  return 0;
}

async function siblingRescueRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-rescue <topic> <hub-cwd>"); return 2; }
  return siblingRescueWith(topic, hub, liveSiblingDeps);
}
/**
 * Revert + replay on a feat branch — recovery for rogue sibling commits.
 * Byte-faithful port of deploy.md:1242-1261 (the inline revert-and-replay call
 * that sourced deploy-sibling.sh). consort has no shell libs, so it is a verb.
 * Groups rogue SHAs per slug in sibling-rogue.txt row order (deploy.md:1244-1248),
 * passes them verbatim to revertAndReplay (which builds feat/perform-<topic>-rescue),
 * and APPENDS `<slug>\trescued|rescue-failed` to sibling-rescue.txt.
 */
export async function siblingRescueWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  const rogueFile = join(art, "sibling-rogue.txt"), baselineFile = join(art, "sibling-baseline.txt");
  if (!existsSync(rogueFile)) { log.error(`perform sibling-rescue: no sibling-rogue.txt under ${art}`); return 1; }
  if (!existsSync(baselineFile)) { log.error(`perform sibling-rescue: no sibling-baseline.txt under ${art}`); return 1; }
  // Group rogue SHAs by slug in sibling-rogue.txt row order (deploy.md:1244-1248).
  const shasBySlug = new Map<string, string[]>();
  const order: string[] = [];
  for (const line of readFileSync(rogueFile, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const [slug, sha] = line.split("\t");
    if (!slug) continue;
    if (!shasBySlug.has(slug)) { shasBySlug.set(slug, []); order.push(slug); }
    if (sha) shasBySlug.get(slug)!.push(sha);
  }
  const baseBySlug = new Map(parseBaselineFile(readFileSync(baselineFile, "utf8")).map((r) => [r.slug, r]));
  const resultRows: string[] = [];
  for (const slug of order) {
    const b = baseBySlug.get(slug);
    if (!b) { log.warn(`perform sibling-rescue: no baseline row for ${slug}; skipping`); continue; }
    const sibCwd = join(hubCwd, slug);
    const res = revertAndReplay(d.runnerFor(sibCwd), topic, b.sha, b.branch, shasBySlug.get(slug)!);
    if (res.outcome === "ok") { log.ok(`perform sibling-rescue: rescued ${slug} (${res.rescue})`); resultRows.push(`${slug}\trescued`); }
    else { log.warn(`perform sibling-rescue: rescue failed for ${slug} (${res.outcome})`); resultRows.push(`${slug}\trescue-failed`); }
  }
  appendFileSync(join(art, "sibling-rescue.txt"), resultRows.length ? resultRows.join("\n") + "\n" : "");
  return 0;
}

// ---- cross-repo "feels unsafe" signal (deploy.md:1063-1085) ----
export interface CrossSignalDeps { runnerFor(cwd: string): Runner; }
const liveCrossSignalDeps: CrossSignalDeps = { runnerFor: runnerAt };
async function crossSignalRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: perform cross-signal <topic>"); return 2; }
  return crossSignalWith(topic, liveCrossSignalDeps);
}
/**
 * Compute the deterministic "feels unsafe" heuristic the multi-repo cross-verify
 * stage reads. Byte-faithful port of deploy.md:1063-1085: WAVE_COUNT (unique
 * wave column of dag-waves.txt), FAN_IN_REPOS (dagFanInRepos), SHARED_PATHS
 * (filesystem paths touched by >= 2 parts, per-part baseline from
 * baselines/<slug>.tsv field baseline_sha), and UNSAFE (1 iff any trigger fires).
 * Emits all four as KV stdout; the bug collection itself stays Maestro directive work.
 */
export async function crossSignalWith(topic: string, d: CrossSignalDeps): Promise<number> {
  const art = performArtDir(topic);
  const wavesFile = join(art, "dag-waves.txt"), edgesFile = join(art, "dag-edges.txt");
  if (!existsSync(wavesFile)) { log.error(`perform cross-signal: dag-waves.txt missing under ${art} (run dag-parse first)`); return 1; }
  const wavesText = readFileSync(wavesFile, "utf8");
  const edgesText = existsSync(edgesFile) ? readFileSync(edgesFile, "utf8") : "";
  const waves = new Set<string>();
  for (const line of wavesText.split("\n")) { if (line.length === 0) continue; waves.add(line.split("\t")[0]); }
  const waveCount = waves.size;
  const fanIn = dagFanInRepos(edgesText, wavesText);
  const pathCount = new Map<string, number>();
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const base = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "baseline_sha");
    if (!base) continue;
    const diff = d.runnerFor(t.cwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout;
    for (const p of diff.split("\n")) { if (p.length === 0) continue; pathCount.set(p, (pathCount.get(p) ?? 0) + 1); }
  }
  const shared = [...pathCount.entries()].filter(([, n]) => n >= 2).map(([p]) => p).sort();
  const unsafe = waveCount >= 3 || fanIn.length > 0 || shared.length > 0 ? 1 : 0;
  if (waveCount >= 3) log.warn(`feels unsafe: wave count ${waveCount} >= 3`);
  if (fanIn.length > 0) log.warn(`feels unsafe: fan-in repos: ${fanIn.join(" ")}`);
  if (shared.length > 0) log.warn(`feels unsafe: shared filesystem paths: ${shared.join(" ")}`);
  process.stdout.write(`WAVE_COUNT=${waveCount}\nFAN_IN_REPOS=${fanIn.join(" ")}\nSHARED_PATHS=${shared.join(" ")}\nUNSAFE=${unsafe}\n`);
  return 0;
}

// ---- summary (deploy-summary.sh) ----
export interface SummaryDeps { runnerFor(cwd: string): Runner; now(): string; }
const liveSummaryDeps: SummaryDeps = { runnerFor: runnerAt, now: () => isoUtc() };
async function summaryRun(rest: string[]): Promise<number> { const topic = rest[0]; if (!topic) { log.error("usage: perform summary <topic>"); return 2; } return summaryWith(topic, liveSummaryDeps); }
export async function summaryWith(topic: string, d: SummaryDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform summary: art-dir missing: ${art}`); return 1; }
  mkdirSync(join(art, "posts"), { recursive: true });
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const baseline = join(art, "baselines", `${t.slug}.tsv`), post = join(art, "posts", `${t.slug}.tsv`);
    if (!existsSync(baseline)) { log.error(`perform summary: baseline missing for slug=${t.slug} (${baseline})`); continue; }
    if (!isDir(t.cwd)) { log.warn(`perform summary: target gone for slug=${t.slug} (cwd=${t.cwd}); omitting block`); continue; }
    const r = d.runnerFor(t.cwd); postSweep(r, topic, baseline, post, d.now());
    process.stdout.write(formatSummaryBlock(r, baseline, post) + "\n\n");
  }
  return 0;
}
function postSweep(r: Runner, topic: string, baseline: string, post: string, ts: string): void {
  const slug = kvFileField(baseline, "slug"), cwd = kvFileField(baseline, "cwd"), base = kvFileField(baseline, "branch");
  const postBranch = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)";
  const dirty = r.run("git", ["status", "--porcelain"]).stdout.trim();
  let state: string;
  if (!dirty) state = "no-leftovers";
  else { r.run("git", ["add", "-A"]); state = r.run("git", ["commit", "-q", "-m", `chore: post-perform leftovers for ${topic}`]).code === 0 ? "swept" : (log.warn(`perform post-sweep: commit hook blocked sweep in ${cwd}`), "sweep-failed"); }
  const postSha = r.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  atomicWrite(post, `slug=${slug}\ncwd=${cwd}\nbranch=${postBranch}\npost_sha=${postSha}\nstate=${state}\nbranch_changed=${base === postBranch ? "false" : "true"}\nsweep_ts=${ts}\n`);
}
function formatSummaryBlock(r: Runner, baseline: string, post: string): string {
  const slug = kvFileField(baseline, "slug"), cwd = kvFileField(baseline, "cwd"), baseBranch = kvFileField(baseline, "branch"), baselineSha = kvFileField(baseline, "baseline_sha"), baseState = kvFileField(baseline, "state");
  const postBranch = kvFileField(post, "branch"), postSha = kvFileField(post, "post_sha"), postState = kvFileField(post, "state"), changed = kvFileField(post, "branch_changed");
  const L: string[] = [`=== ${slug} [${cwd}] ===`];
  if (changed === "true") L.push(`  [WARNING: branch changed from ${baseBranch} to ${postBranch}]`);
  if (baseState === "hook-blocked") L.push("  [WARNING: pre-perform snapshot hook-blocked; baseline = pre-attempt HEAD]");
  if (postState === "sweep-failed") L.push("  [WARNING: post-perform sweep hook-blocked; leftovers remain in working tree]");
  if (baseBranch === "(detached)") L.push("  [WARNING: baseline branch detached]");
  L.push(`  branch:     ${postBranch}`); L.push(`  baseline:   ${baselineSha}   ${baseBranch}   (${baseState})`); L.push(`  HEAD:       ${postSha}   ${postBranch}`);
  const stat = shortstat(r, baselineSha);
  L.push(stat ? `  diff stat:  ${stat}` : "  diff stat:  (no changes since baseline)");
  L.push("  commits (oldest -> newest):");
  const commits = r.run("git", ["log", "--reverse", "--oneline", `${baselineSha}..HEAD`]).stdout.replace(/\n+$/, "");
  L.push(commits ? commits.split("\n").map((c) => "    " + c).join("\n") : "    (no commits since baseline)");
  return L.join("\n");
}

// ---- finish (deploy-finish.sh) ----
export interface FinishDeps { runnerFor(cwd: string): Runner; hasGh: boolean; }
const liveFinishDeps: FinishDeps = { runnerFor: runnerAt, hasGh: haveCmd("gh") };
async function finishRun(rest: string[]): Promise<number> {
  const topic = rest[0], action = rest[1];
  if (!topic || !action) { log.error("usage: perform finish <topic> <merge|pr|keep|discard>"); return 2; }
  if (!["merge", "pr", "keep", "discard"].includes(action)) { log.error(`perform finish: unknown action '${action}'`); return 2; }
  return finishWith(topic, action as "merge" | "pr" | "keep" | "discard", liveFinishDeps);
}
// Shared per-target finish body (deploy-finish.sh:1398-1419 / deploy.md:1398-1419). Resolves the
// part's feat branch + start branch, then delegates the branch action. Used by both finishWith
// (apply-to-all, truncate) and finishOneWith (single target, append).
function applyFinish(art: string, t: { slug: string; cwd: string }, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): string {
  const branch = branchMapField(join(art, "perform-branches.tsv"), t.slug);
  const startBranch = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "branch");
  return finishBranchAction(d.runnerFor(t.cwd), { branch, startBranch, action, hasGh: d.hasGh });
}
export async function finishWith(topic: string, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform finish: art-dir missing: ${art}`); return 1; }
  const results = join(art, "finish-results.tsv"); writeFileSync(results, "");
  let n = 0;
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const outcome = applyFinish(art, { slug: t.slug, cwd: t.cwd }, action, d);
    appendFileSync(results, `${t.slug}\t${action}\t${outcome}\n`);
    log.info(`finish: ${t.slug} -> ${action} -> ${outcome}`); n++;
  }
  log.ok(`perform finish: ${n} target(s) completed`); return 0;
}
// Per-repo finish-one (deploy-finish.sh:1398-1419 / deploy.md:1398-1419, per-target granularity):
// finishes a SINGLE target by slug and APPENDS to finish-results.tsv (no truncate). The multi-repo
// directive truncates finish-results.tsv once, then calls finish-one per repo (finish menu per target).
async function finishOneRun(rest: string[]): Promise<number> {
  const [topic, slug, action] = rest;
  if (!topic || !slug || !action) { log.error("usage: perform finish-one <topic> <slug> <merge|pr|keep|discard>"); return 2; }
  if (!["merge", "pr", "keep", "discard"].includes(action)) { log.error(`perform finish-one: unknown action '${action}'`); return 2; }
  return finishOneWith(topic, slug, action as "merge" | "pr" | "keep" | "discard", liveFinishDeps);
}
export async function finishOneWith(topic: string, slug: string, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform finish-one: art-dir missing: ${art}`); return 1; }
  const target = iterTargets(topic).find((t) => t.slug === slug);
  if (!target || !target.cwd) { log.error(`perform finish-one: no target slug=${slug}`); return 1; }
  const outcome = applyFinish(art, { slug: target.slug, cwd: target.cwd }, action, d);
  appendFileSync(join(art, "finish-results.tsv"), `${slug}\t${action}\t${outcome}\n`);
  log.info(`finish: ${slug} -> ${action} -> ${outcome}`); return 0;
}

// ---- forensics (best-effort) + archive (deploy-archive.sh) ----
async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("perform", performArtDir, rest[0]);
}
export async function archiveRun(rest: string[]): Promise<number> {
  const topic = rest[0]; if (!topic) { log.error("usage: perform archive <topic>"); return 2; }
  archiveTopic(topic, "perform"); log.ok(`perform archive: archived _perform for ${topic}`); return 0;
}

// ---- dag-parse (deploy-dag-parse.sh) — the multi-repo DAG executor wiring ----
export interface DagParseDeps { artDir(topic: string): string; }
const liveDagParseDeps: DagParseDeps = { artDir: (t) => performArtDir(t) };
async function dagParseRun(rest: string[]): Promise<number> {
  if (rest.length !== 1 || !rest[0]) { log.error("usage: perform dag-parse <topic>"); return 2; }
  return dagParseWith(rest[0], liveDagParseDeps);
}
export async function dagParseWith(topic: string, d: DagParseDeps): Promise<number> {
  const art = d.artDir(topic);
  const docPath = join(art, "design.md");
  if (!existsSync(docPath)) { log.error(`perform dag-parse: design.md not found under ${art} (run perform init first)`); return 1; }
  const body = dagSectionBody(readFileSync(docPath, "utf8"));
  if (body.length === 0) { log.error("perform dag-parse: design doc missing '## Execution DAG' section"); return 1; }
  const nodes: string[] = [];
  const rows = new Map<string, { repo: string; path: string; desc: string }>();
  const edges: Array<[string, string]> = [];
  for (const line of body) {
    if (line.trim() === "") continue;
    if (!/^[ \t]*\d+\./.test(line)) continue;
    const node = parseDagLine(line);
    if (node === null) { log.error(`perform dag-parse: malformed DAG line: ${line}`); return 1; }
    nodes.push(node.step);
    rows.set(node.step, { repo: node.repo, path: node.path, desc: node.desc });
    if (node.deps !== "none" && node.deps !== "") for (const dep of node.deps.split(",")) edges.push([dep, node.step]);
  }
  if (nodes.length === 0) { log.error("perform dag-parse: no DAG lines parsed from '## Execution DAG' section"); return 1; }
  const topo = dagTopological(edges, nodes);
  if (topo === null) return 1;                                   // dagTopological wrote the stderr diagnostic
  const wavesText = topo.map((r) => { const [w, s] = r.split("\t"); const x = rows.get(s)!; return `${w}\t${s}\t${x.repo}\t${x.path}\t${x.desc}`; }).join("\n") + "\n";
  const edgesText = edges.length ? edges.map(([f, t]) => `${f}\t${t}`).join("\n") + "\n" : "";
  atomicWrite(join(art, "dag-waves.txt"), wavesText);
  atomicWrite(join(art, "dag-edges.txt"), edgesText);
  const waveCount = Number(topo[topo.length - 1].split("\t")[0]);
  log.ok(`perform dag-parse: ${nodes.length} steps in ${waveCount} wave(s)`);
  process.stdout.write(`WAVES=${waveCount}\nSTEPS=${nodes.length}\n`);
  return 0;
}

// ---- wave-wait (deploy-wave-wait.sh) — per-part barrier; rc 0 ALWAYS ----
const PERFORM_WAVE_TIMEOUT = (): number =>
  Number(process.env.CONSORT_PERFORM_WAVE_TIMEOUT_OVERRIDE) || Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400;
async function waveWaitRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: perform wave-wait <topic> <instrument> <provider>"); return 2; }
  if (!assertPerformTopic(topic) || !/^[a-z0-9_-]+$/.test(instrument) || !/^[a-z0-9_-]+$/.test(provider)) { log.error("perform wave-wait: bad topic/instrument/provider"); return 2; }
  return waveWaitWith(topic, instrument, provider, liveWaitDeps);
}
export async function waveWaitWith(topic: string, instrument: string, provider: string, d: PerformWaitDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform wave-wait: _perform art-dir missing for ${topic}`); return 1; }
  const timeout = scaledTimeout(PERFORM_WAVE_TIMEOUT(), d.multiplier(provider));
  log.info(`[wave-wait] ${instrument} timeout=${timeout}s`);
  const ev = await d.wait(instrument, provider, topic, 0, ["done", "error"], timeout);
  let ts: string; const extra: string[] = [];
  if (ev === null) { ts = "timeout"; extra.push(`TIMEOUT_S=${timeout}`); log.warn(`[wave-wait] ${instrument} TS=timeout`); }
  else if (ev.event === "done") { ts = "ok"; extra.push("EVENT=done"); log.ok(`[wave-wait] ${instrument} TS=ok`); }
  else if (ev.event === "error") { ts = "failed"; extra.push("EVENT=error", `REASON=${typeof ev.reason === "string" ? ev.reason : ""}`); log.error(`[wave-wait] ${instrument} TS=failed`); }
  else { ts = "failed"; extra.push("EVENT=unknown"); log.error(`[wave-wait] ${instrument} TS=failed (unknown event)`); }
  atomicWrite(join(art, `wave-${instrument}.txt`), `TS=${ts}\nINSTRUMENT=${instrument}\nPROVIDER=${provider}\nTOPIC=${topic}\n` + extra.map((l) => l + "\n").join(""));
  writeFileSync(join(art, `wave-${instrument}.done`), "");
  return 0;
}

// ---- multi-init (deploy-multi-init.sh) — assign one part per sub-repo in DAG order ----
export interface MultiInitDeps { detectProvider(cwd: string): "codex" | "claude"; pickInstruments(topic: string, n: number): string[]; runnerFor(cwd: string): Runner; }
const liveMultiInitDeps: MultiInitDeps = { detectProvider: (c) => detectProvider(c), pickInstruments, runnerFor: runnerAt };
async function multiInitRun(rest: string[]): Promise<number> {
  if (rest.length !== 2) { log.error("usage: perform multi-init <topic> <hub-cwd>"); return 2; }
  return multiInitWith(rest[0], rest[1], liveMultiInitDeps);
}
export async function multiInitWith(topic: string, hubCwd: string, d: MultiInitDeps): Promise<number> {
  const art = performArtDir(topic);
  const wavesFile = join(art, "dag-waves.txt");
  if (!existsSync(wavesFile)) { log.error(`perform multi-init: dag-waves.txt not found at ${wavesFile} (run perform dag-parse first)`); return 1; }
  const reposOrdered: string[] = []; const seen = new Set<string>(); const repoToPath = new Map<string, string>();
  for (const line of readFileSync(wavesFile, "utf8").split("\n")) {
    const cols = line.split("\t"); const repo = cols[2];
    if (!repo) continue;
    if (!seen.has(repo)) { seen.add(repo); reposOrdered.push(repo); repoToPath.set(repo, cols[3] || "none"); }
  }
  if (reposOrdered.length === 0) { log.error("perform multi-init: no repos in dag-waves.txt"); return 1; }
  const instruments = d.pickInstruments(topic, reposOrdered.length);
  if (instruments.length < reposOrdered.length) { log.error(`perform multi-init: instrument pool exhausted (need ${reposOrdered.length}, got ${instruments.length})`); return 1; }
  const rows: string[] = [];
  for (let i = 0; i < reposOrdered.length; i++) {
    const repo = reposOrdered[i];
    const p = repoToPath.get(repo)!;
    const cwd = p !== "none" && p !== "" ? p : join(hubCwd, repo);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) { log.error(`perform multi-init: sub-repo '${repo}' not found at ${cwd}`); return 1; }
    if (!hasRepoMarker(cwd)) { log.error(`perform multi-init: sub-repo '${repo}' has no CLAUDE.md or AGENTS.md at ${cwd}`); return 1; }
    const provider = d.detectProvider(cwd);
    const instrument = instruments[i];
    rows.push(`${instrument}\t${cwd}\t${provider}`);
    const sha = d.runnerFor(cwd).run("git", ["rev-parse", "HEAD"]).stdout.trim();
    atomicWrite(join(art, `${instrument}-branch-base.sha`), sha + "\n");
  }
  atomicWrite(join(art, "parts.txt"), rows.join("\n") + "\n");
  log.ok(`perform multi-init: ${reposOrdered.length} part(s) assigned for ${topic}`);
  return 0;
}

// ---- send-unit (deploy.md Step 3b per-repo dispatch) — compose + deliver the dag-unit prompt ----
export interface SendUnitDeps { send(args: string[]): Promise<number>; }
const liveSendUnitDeps: SendUnitDeps = { send: sendRun };
async function sendUnitRun(rest: string[]): Promise<number> {
  if (rest.length !== 2) { log.error("usage: perform send-unit <topic> <repo>"); return 2; }
  return sendUnitWith(rest[0], rest[1], liveSendUnitDeps);
}
export async function sendUnitWith(topic: string, repo: string, d: SendUnitDeps): Promise<number> {
  const art = performArtDir(topic);
  let instrument = "";
  const partsFile = join(art, "parts.txt");
  for (const line of (existsSync(partsFile) ? readFileSync(partsFile, "utf8").split("\n") : [])) {
    const c = line.split("\t"); if (c[1] && basename(c[1]) === repo) { instrument = c[0]; break; }
  }
  if (!instrument) { log.error(`perform send-unit: no part for repo '${repo}' in parts.txt`); return 1; }
  const waves = readFileSync(join(art, "dag-waves.txt"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const total = new Set(waves.map((w) => w[2])).size;
  const myStep = waves.find((w) => w[2] === repo)?.[1] ?? "";
  const stepToRepo = new Map(waves.map((w) => [w[1], w[2]]));
  const edgesFile = join(art, "dag-edges.txt");
  const edges = (existsSync(edgesFile) ? readFileSync(edgesFile, "utf8") : "").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const upstreamRepos = edges.filter(([, to]) => to === myStep).map(([from]) => stepToRepo.get(from)).filter((x): x is string => Boolean(x));
  const upstreamCsv = upstreamRepos.join(",");
  const prompt = composeDagUnitPrompt({ slug: repo, designPath: join(art, "design.md"), step: myStep, total, upstreamCsv });
  const promptFile = join(art, `${instrument}_dag_unit_prompt.md`);
  atomicWrite(promptFile, prompt);
  const rc = await d.send(["--from", "maestro", instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`perform send-unit: send failed (rc=${rc}) for ${repo}`); return 1; }
  log.info(`[send-unit] ${instrument} -> ${repo} (step ${myStep}/${total}, upstream: ${upstreamCsv || "none"})`);
  return 0;
}

// ---- drop-part (deploy "proceed degraded") — rewrite parts.txt, removing one part's row ----
// When a sub-repo persistently fails in a multi-repo run, the directive ships the rest: it drops
// the failing part by instrument and reports the new N. The rewritten parts.txt stays byte-faithful
// to the multiInitWith format (trailing newline; empty file when no rows remain) so iterTargets
// reads it transparently.
async function dropPartRun(rest: string[]): Promise<number> {
  const [topic, instrument] = rest;
  if (!topic || !instrument || rest.length !== 2) { log.error("usage: perform drop-part <topic> <instrument>"); return 2; }
  const partsFile = join(performArtDir(topic), "parts.txt");
  if (!existsSync(partsFile)) { log.error(`perform drop-part: parts.txt missing`); return 1; }
  const kept: string[] = []; let dropped = false;
  for (const line of readFileSync(partsFile, "utf8").split("\n")) {
    if (line.length === 0) continue;
    if (line.split("\t")[0] === instrument) { dropped = true; continue; }
    kept.push(line);
  }
  if (!dropped) { log.error(`perform drop-part: no part for instrument=${instrument}`); return 1; }
  atomicWrite(partsFile, kept.length ? kept.join("\n") + "\n" : "");
  log.ok(`perform drop-part: dropped ${instrument}, ${kept.length} part(s) remain`);
  process.stdout.write(`N=${kept.length}\n`);
  return 0;
}

// ---- verify-dag-repos (deploy.md prose-DAG rescue precheck) — per-slug repo-layout check ----
// Reads the topic's design.md, extracts the unique DAG repo slugs (dagSectionBody + parseDagLine),
// then reports per-slug `ok | missing-dir | missing-marker` against <hub>/<slug>. A repo is ok iff
// the dir exists AND has CLAUDE.md or AGENTS.md (same marker rule as multiInitWith). Hub defaults to
// repoRoot() when --cwd is omitted. rc 1 if any slug is bad, else 0; rc 2 on bad usage.
async function verifyDagReposRun(rest: string[]): Promise<number> {
  let topic: string | undefined; let hub: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--cwd") { hub = rest[i + 1]; i++; }
    else if (t.startsWith("--cwd=")) { hub = t.slice("--cwd=".length); }
    else if (!topic) topic = t;
  }
  if (!topic) { log.error("usage: perform verify-dag-repos <topic> [--cwd <hub>]"); return 2; }
  const doc = join(performArtDir(topic), "design.md");
  if (!existsSync(doc)) { log.error(`perform verify-dag-repos: design.md missing under ${performArtDir(topic)}`); return 1; }
  const hubDir = hub ?? repoRoot();
  const slugs: string[] = [];
  for (const line of dagSectionBody(readFileSync(doc, "utf8"))) {
    const node = parseDagLine(line);
    if (node && !slugs.includes(node.repo)) slugs.push(node.repo);
  }
  let bad = 0;
  for (const slug of slugs) {
    const dir = join(hubDir, slug);
    let st: string;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) st = "missing-dir";
    else if (!hasRepoMarker(dir)) st = "missing-marker";
    else st = "ok";
    if (st !== "ok") bad++;
    process.stdout.write(`REPO=${slug}\tSTATUS=${st}\n`);
  }
  return bad > 0 ? 1 : 0;
}
