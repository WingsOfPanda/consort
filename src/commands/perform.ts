// src/commands/perform.ts — single-repo command path for /consort:perform.
// Byte-faithful port of the prior bash plugin's deploy verb set; WIRES the Phase-A core modules.
// Rebrand: _deploy/->_perform/, feat/deploy-->feat/perform-, conductor sender->From: maestro.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile, kvParse } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { repoRoot, repoStateDir } from "../core/paths.js";
import { auditDoc } from "../core/audit.js";
import {
  parsePerformArgs, deriveTopicFromPath, detectProvider,
  performArtDir, iterTargets, assertPerformTopic, PerformArgError,
} from "../core/perform.js";
import { isoUtc, archiveTopic } from "../core/archive.js";
import { extractComponentsPaths, matchDiffAgainstComponents } from "../core/performScope.js";
import { runnerAt, preSnapshot, createOrResumeBranch, shortstat, finishBranchAction, type Runner } from "../core/gitwork.js";
import { runForensics, runFlag } from "../core/forensics.js";
import { haveCmd } from "../core/deps.js";
import { performState, composeRound1Prompt, composeFixPrompt } from "../core/performTurn.js";
import { extractQuestionPayload, parseQuestionPayload } from "../core/performQuestions.js";
import { outboxOffset, outboxPath, outboxWaitSince, statusPath, resolveModel, type OutboxEvent } from "../core/ipc.js";
import { instrumentTimeoutMultiplier } from "../core/contracts.js";
import { scaledTimeout, parseLatestOffset } from "../core/scoreTurn.js";
import { run as sendRun } from "./send.js";
import { detectTestCommand } from "../core/solo.js";

const PART = "tutti";
const PERFORM_TURN_TIMEOUT = (): number => Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400;

/** model for the tutti part = the resolved provider (codex|claude). Reads provider.txt; default codex. */
function partModel(art: string): string {
  const p = join(art, "provider.txt");
  return existsSync(p) ? (readFileSync(p, "utf8").trim() || "codex") : "codex";
}
/** The LAST `OBJECTIONS=<n>` count persisted in a per-dispatch state file (0 if absent). The
 *  objection cap reads + increments this on every re-arm so the count survives the background-task
 *  re-entry that drives the re-armed wait. Latest-line-wins, mirroring parseLatestOffset. */
function latestObjections(stateFile: string): number {
  if (!existsSync(stateFile)) return 0;
  const ms = [...readFileSync(stateFile, "utf8").matchAll(/^OBJECTIONS=(\d+)\s*$/gm)];
  return ms.length ? Number(ms[ms.length - 1][1]) : 0;
}
function usage(): number {
  log.error("usage: perform <init|audit|pre-snapshot|branch|turn-send|turn-wait|reset-status|scope-check|summary|finish|forensics|archive|find-latest-doc> ...");
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
    case "summary":      return summaryRun(rest);
    case "finish":       return finishRun(rest);
    case "forensics":    return forensicsRun(rest);
    case "flag":         return runFlag("perform", rest[0], rest.slice(1).join(" "));
    case "archive":      return archiveRun(rest);
    case "find-latest-doc": return findLatestDocRun(rest);
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

  const targetCwd = d.repoRoot();
  const provider = detectProvider(targetCwd);

  mkdirSync(art, { recursive: true });
  atomicWrite(join(art, "design.md"), text);
  atomicWrite(join(art, "topic.txt"), topic);                       // NO trailing newline
  atomicWrite(join(art, "target_cwd.txt"), targetCwd + "\n");
  atomicWrite(join(art, "provider.txt"), provider + "\n");
  atomicWrite(join(art, "auto_provider.txt"), provider + "\n");   // deploy claude-confirm marker (the auto-detected provider)

  log.ok(`perform init: topic=${topic} provider=${provider}`);
  process.stdout.write(`ART=${art}\nTOPIC=${topic}\nPROVIDER=${provider}\nTARGET_CWD=${targetCwd}\n`);
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
  const stateFile = join(art, `turn-${PART}-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`perform turn-send: ${stateFile} already exists; rm to retry`); return 1; }
  const outbox = outboxPath(PART, model, topic);
  if (!existsSync(outbox)) { log.error(`perform turn-send: outbox not found at ${outbox} — was ${PART} spawned?`); return 1; }
  const sp = statusPath(PART, model, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`perform turn-send: part not idle (state=${m[1]}); previous turn still in flight`); return 1; } }
  const promptFile = join(art, `${PART}_turn_prompt_${round}.md`);
  if (round === 1) atomicWrite(promptFile, composeRound1Prompt({ designPath: join(art, "design.md"), planPath: join(art, "plan.md"), verifyPath: join(art, "verify-report-1.md"), round, testCmd }));
  else { const bundle = join(art, `fix-prompt-${round}.md`); if (!existsSync(bundle)) { log.error(`perform turn-send: fix-prompt-${round}.md not found at ${bundle}; the directive must write it first`); return 1; } atomicWrite(promptFile, composeFixPrompt(round, readFileSync(bundle, "utf8"), join(art, `verify-report-${round}.md`), testCmd)); }
  const offset = d.offsetFor(PART, model, topic);             // BEFORE send (deploy_send_dispatch order)
  atomicWrite(stateFile, `OFFSET=${offset}\n`);
  const rc = await d.send(["--from", "maestro", PART, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`perform turn-send: send failed (rc=${rc}); ${stateFile} kept (rm to retry)`); return 1; }
  log.info(`[turn-send] ${PART} round=${round} offset=${offset}`); return 0;
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
  const stateFile = join(art, `turn-${PART}-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`perform turn-wait: ${stateFile} missing — run perform turn-send first`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`perform turn-wait: OFFSET not set in ${stateFile}`); return 1; }
  const timeout = scaledTimeout(PERFORM_TURN_TIMEOUT(), d.multiplier(model));
  log.info(`[turn-wait] ${PART} round=${round} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(PART, model, topic, offset, ["done", "error", "question"], timeout);
  const verifyPath = join(art, `verify-report-${round}.md`);
  const verifyText = existsSync(verifyPath) ? readFileSync(verifyPath, "utf8") : null;
  let ts = performState(ev, verifyText);
  if (ts === "question" && ev) {
    const payload = extractQuestionPayload(ev, d.now());
    if (payload !== null) {
      atomicWrite(join(art, `question-${PART}-${round}.txt`), payload);
      const bumped = outboxOffset(outboxPath(PART, model, topic));
      const objLine = parseQuestionPayload(payload).route === "objection"
        ? `OBJECTIONS=${latestObjections(stateFile) + 1}\n` : "";
      appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n${objLine}`);
    } else { ts = "failed"; appendFileSync(stateFile, "TS=failed\n"); log.warn("[turn-wait] malformed question (no message); downgraded to failed"); }
  } else appendFileSync(stateFile, `TS=${ts}\n`);
  writeFileSync(join(art, `turn-${PART}-${round}.done`), "");
  log.ok(`[turn-wait] ${PART} round=${round} TS=${ts}`); return 0;
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
 * paths. Single-repo: the diff comes from `target_cwd.txt` + `branch-base.sha`.
 */
export async function scopeCheckWith(topic: string, d: ScopeDeps): Promise<number> {
  const art = performArtDir(topic);
  const designFile = join(art, "design.md");
  const targetFile = join(art, "target_cwd.txt"), baseFile = join(art, "branch-base.sha");
  if (!existsSync(targetFile) || !existsSync(baseFile)) { log.error(`perform scope-check: target_cwd.txt/branch-base.sha missing under ${art}`); return 1; }
  if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
  const targetCwd = readFileSync(targetFile, "utf8").split("\n")[0].trim();
  const base = readFileSync(baseFile, "utf8").split("\n")[0].trim();
  const diffPaths = d.runnerFor(targetCwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
  atomicWrite(join(art, "diff-paths.txt"), diffPaths.length ? diffPaths.join("\n") + "\n" : "");
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`OOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
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
// part's feat branch + start branch, then delegates the branch action.
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

// ---- forensics (best-effort) + archive (deploy-archive.sh) ----
async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("perform", performArtDir, rest[0]);
}
export async function archiveRun(rest: string[]): Promise<number> {
  const topic = rest[0]; if (!topic) { log.error("usage: perform archive <topic>"); return 2; }
  archiveTopic(topic, "perform"); log.ok(`perform archive: archived _perform for ${topic}`); return 0;
}
