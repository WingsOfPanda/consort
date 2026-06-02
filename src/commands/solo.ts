// src/commands/solo.ts
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { repoRoot } from "../core/paths.js";
import { soloArtDir, soloExecDir, deriveSlug, parseSoloArgs, detectTestCommand, renderSummary, renderResume, type SummaryFacts } from "../core/solo.js";
import { runForensics, runFlag } from "../core/forensics.js";
import { instrumentBinary } from "../core/contracts.js";
import { haveCmd } from "../core/deps.js";
import { pickRandomInstrument } from "../core/instruments.js";
import { runnerAt, preSnapshot, createOrResumeBranch, finishBranch } from "../core/gitwork.js";
import type { Runner } from "../core/gitwork.js";
import { outboxOffset, outboxPath, outboxWaitSince, statusPath, type OutboxEvent } from "../core/ipc.js";
import { composeRound1Prompt, composeFixPrompt, classifyTurn, parseOffset } from "../core/turn.js";
import { run as sendRun } from "./send.js";
import { readIfExists } from "../core/fsread.js";

function usage(): number {
  log.error("usage: solo <init|branch|turn-send|turn-wait|detect-test|finish|forensics|summary> ...");
  return 2;
}

export interface InitDeps {
  haveCmd(name: string): boolean;
  instrumentBinary(name: string): string | undefined;
  pickRandomInstrument(topic: string): string | null;
}
const liveInitDeps: InitDeps = { haveCmd, instrumentBinary, pickRandomInstrument };

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest));
    case "branch": return branchRun(rest);
    case "turn-send": return turnSendRun(rest);
    case "turn-wait": return turnWaitRun(rest);
    case "detect-test": return detectTestRun(rest);
    case "finish": return finishRun(rest);
    case "forensics": return forensicsRun(rest);
    case "flag": return runFlag("solo", rest[0], rest.slice(1).join(" "));
    case "summary": return summaryRun(rest);
    default: return usage();
  }
}

// ---- forensics (delegates to core runForensics). Feeds /consort:playback. ----
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("solo", soloArtDir, rest[0]);
}

async function initRun(tokens: string[]): Promise<number> {
  return initWith(tokens, liveInitDeps);
}

export async function initWith(tokens: string[], d: InitDeps): Promise<number> {
  const { topicText, provider: provArg, finish } = parseSoloArgs(tokens);
  if (!topicText) { log.error("solo init: topic text is empty"); return 1; }
  const slug = deriveSlug(topicText);
  if (!slug) { log.error("solo init: topic produced an empty slug; provide alphanumerics"); return 1; }

  const provider = provArg ?? "codex";
  const binary = d.instrumentBinary(provider);
  if (!binary) { log.error(`solo init: provider '${provider}' has no entry in contracts.yaml`); return 3; }
  if (!d.haveCmd(binary)) { log.error(`solo init: ${provider}'s binary '${binary}' is not on PATH`); return 3; }

  const art = soloArtDir(slug);
  if (existsSync(art)) { log.error(`solo init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different topic"); return 2; }

  const instrument = d.pickRandomInstrument(slug);
  if (!instrument) { log.error(`solo init: no available instrument in the pool for '${slug}'`); return 1; }

  const exec = soloExecDir(slug);
  mkdirSync(exec, { recursive: true });
  atomicWrite(join(art, "topic.txt"), slug + "\n");
  atomicWrite(join(art, "topic-text.txt"), topicText);
  atomicWrite(join(art, "selected-provider.txt"), provider + "\n");
  atomicWrite(join(art, "instrument.txt"), instrument + "\n");
  atomicWrite(join(art, "timing.txt"), `started=${isoUtc()}\n`);
  atomicWrite(join(exec, "provider.txt"), provider + "\n");
  atomicWrite(join(exec, "finish.txt"), (finish ? "yes" : "no") + "\n");

  const target = repoRoot();
  log.ok(`solo init: topic=${slug} instrument=${instrument} provider=${provider} finish=${finish ? "yes" : "no"}`);
  process.stdout.write(`SLUG=${slug}\nINSTRUMENT=${instrument}\nPROVIDER=${provider}\nFINISH=${finish ? "yes" : "no"}\nTARGET=${target}\n`);
  return 0;
}
async function branchRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: solo branch <topic>"); return 2; }
  const target = repoRoot();
  return branchWith(topic, target, runnerAt(target));
}

/** Testable core: snapshot + branch the target repo, recording execute/ facts. */
export async function branchWith(topic: string, target: string, r: Runner): Promise<number> {
  const snap = preSnapshot(r, "solo", topic);
  if (snap.state === "not-git") { log.error(`solo branch: ${target} is not a git repository`); return 1; }
  const branch = `feat/solo-${topic}`;
  const onBranch = createOrResumeBranch(r, branch);
  const exec = soloExecDir(topic);
  atomicWrite(join(exec, "target_cwd.txt"), target + "\n");
  atomicWrite(join(exec, "start-branch.txt"), snap.branch + "\n");
  atomicWrite(join(exec, "branch-base.sha"), snap.baseSha + "\n");
  atomicWrite(join(exec, "branch.txt"), branch + "\n");
  if (!onBranch) { log.warn(`solo branch: checkout ${branch} failed; staying on ${snap.branch}`); }
  log.ok(`solo branch: ${branch} (snapshot=${snap.state}, base=${snap.baseSha.slice(0, 8)})`);
  return 0;
}
export interface TurnSendDeps {
  offsetFor(instrument: string, model: string, topic: string): number;
  send(args: string[]): Promise<number>;
}

async function turnSendRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: solo turn-send <topic> <round>=1.."); return 2; }
  return turnSendWith(topic, round, {
    offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)),
    send: (args) => sendRun(args),
  });
}

export async function turnSendWith(topic: string, round: number, d: TurnSendDeps): Promise<number> {
  const art = soloArtDir(topic);
  const exec = soloExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("solo turn-send: missing instrument.txt/selected-provider.txt (run solo init)"); return 1; }

  const outbox = outboxPath(instrument, provider, topic);
  if (!existsSync(outbox)) { log.error(`solo turn-send: outbox not found at ${outbox} — was ${instrument} spawned?`); return 1; }
  const sp = statusPath(instrument, provider, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`solo turn-send: part not idle (state=${m[1]}); previous turn still in flight`); return 1; } }

  const stateFile = join(exec, `turn-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`solo turn-send: ${stateFile} already exists; rm to retry`); return 1; }

  let prompt: string;
  if (round === 1) {
    const brief = existsSync(join(art, "task-brief.md")) ? readFileSync(join(art, "task-brief.md"), "utf8") : "";
    const branch = readField(join(exec, "branch.txt")) || `feat/solo-${topic}`;
    prompt = composeRound1Prompt(brief, branch);
  } else {
    const bundle = join(exec, `fix-prompt-${round}.md`);
    if (!existsSync(bundle)) { log.error(`solo turn-send: fix bundle missing: ${bundle} (the directive must write it first)`); return 1; }
    prompt = composeFixPrompt(readFileSync(bundle, "utf8"), round);
  }

  const promptFile = join(exec, `turn-prompt-${round}.md`);
  atomicWrite(promptFile, prompt);
  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);

  const rc = await d.send([instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`solo turn-send: send failed (rc=${rc}); ${stateFile} kept for retry`); return 1; }
  log.ok(`solo turn-send: round=${round} offset=${offset}`);
  return 0;
}

/** Read the first line of a single-value state file, trimmed; "" if absent. */
function readField(path: string): string {
  return readIfExists(path).split("\n")[0].trim();
}
export interface TurnWaitDeps {
  wait(instrument: string, model: string, topic: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null>;
}

const SOLO_TURN_TIMEOUT = Number(process.env.CONSORT_SOLO_TURN_TIMEOUT) || 14400;

async function turnWaitRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: solo turn-wait <topic> <round>=1.."); return 2; }
  return turnWaitWith(topic, round, {
    wait: (i, m, t, off, ev, to) => outboxWaitSince(i, m, t, off, ev, to),
  });
}

export async function turnWaitWith(topic: string, round: number, d: TurnWaitDeps): Promise<number> {
  const art = soloArtDir(topic);
  const exec = soloExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("solo turn-wait: missing instrument.txt/selected-provider.txt"); return 1; }
  const stateFile = join(exec, `turn-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`solo turn-wait: ${stateFile} missing (run solo turn-send first)`); return 1; }
  const offset = parseOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`solo turn-wait: OFFSET not set in ${stateFile}`); return 1; }

  log.info(`solo turn-wait: round=${round} offset=${offset} timeout=${SOLO_TURN_TIMEOUT}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], SOLO_TURN_TIMEOUT);
  const ts = classifyTurn(ev);
  if (ts === "question" && ev) atomicWrite(join(exec, `question-${round}.txt`), JSON.stringify(ev) + "\n");
  appendFileSync(stateFile, `TS=${ts}\n`);
  log.ok(`solo turn-wait: round=${round} TS=${ts}`);
  return 0;
}
async function detectTestRun(rest: string[]): Promise<number> {
  const cwd = rest[0] || repoRoot();
  process.stdout.write(detectTestCommand(cwd) + "\n");
  return 0;
}
async function finishRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: solo finish <topic>"); return 2; }
  const target = readField(join(soloExecDir(topic), "target_cwd.txt")) || repoRoot();
  return finishWith(topic, runnerAt(target), haveCmd("gh"));
}

export async function finishWith(topic: string, r: Runner, hasGh: boolean): Promise<number> {
  const exec = soloExecDir(topic);
  const branch = readField(join(exec, "branch.txt"));
  const startBranch = readField(join(exec, "start-branch.txt")) || "main";
  const doFinish = readField(join(exec, "finish.txt")) === "yes";

  if (!doFinish) {
    r.run("git", ["checkout", "-q", startBranch]);
    atomicWrite(join(exec, "finish-result.txt"), `none\tbranch-only (kept ${branch})\n`);
    log.ok(`solo finish: branch-only — kept ${branch}, restored ${startBranch}`);
    return 0;
  }
  const brief = existsSync(join(soloArtDir(topic), "task-brief.md")) ? readFileSync(join(soloArtDir(topic), "task-brief.md"), "utf8") : "";
  const verify = readField(join(exec, "verify-result.txt"));
  const res = finishBranch(r, {
    branch, startBranch, hasGh,
    title: `solo: ${branch}`,
    body: `${brief}\n\nVerify: ${verify}\n\n(Automated solo branch — review and merge into ${startBranch}.)`,
  });
  atomicWrite(join(exec, "finish-result.txt"), `${res.action}\t${res.outcome}\n`);
  log.ok(`solo finish: ${res.action} → ${res.outcome}`);
  return 0;
}
async function summaryRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: solo summary <topic> [--aborted <phase> <gate> <reason...>]"); return 2; }
  const art = soloArtDir(topic);
  const exec = soloExecDir(topic);

  const started = kvField(join(art, "timing.txt"), "started") || "unknown";
  let ended: string | undefined;
  let duration: number | undefined;

  const i = rest.indexOf("--aborted");
  const aborted = i >= 0;
  if (!aborted) {
    ended = isoUtc();
    const s = Date.parse(started), e = Date.parse(ended);
    duration = Number.isFinite(s) && Number.isFinite(e) ? Math.round((e - s) / 1000) : 0;
    atomicWrite(join(art, "timing.txt"), `started=${started}\nended=${ended}\nduration=${duration}\n`);
  }

  const facts: SummaryFacts = {
    topic,
    status: aborted ? "aborted" : "ok",
    started, ended, duration,
    provider: readField(join(art, "selected-provider.txt")) || "unknown",
    instrument: readField(join(art, "instrument.txt")) || "unknown",
    branch: readField(join(exec, "branch.txt")) || "unknown",
    verify: readField(join(exec, "verify-result.txt")) || "unknown",
    diffStats: readField(join(exec, "diff-stats.txt")) || "unknown",
    archived: readField(join(art, "archived-path.txt")) || "(not archived)",
    targetCwd: readField(join(exec, "target_cwd.txt")) || "<target>",
    branchBase: readField(join(exec, "branch-base.sha")) || "<base>",
    abortedPhase: aborted ? rest[i + 1] : undefined,
    abortedGate: aborted ? rest[i + 2] : undefined,
    abortedReason: aborted ? rest.slice(i + 3).join(" ") || "unknown" : undefined,
  };

  atomicWrite(join(art, "SUMMARY.md"), renderSummary(facts));
  if (aborted) {
    atomicWrite(join(art, "RESUME.md"), renderResume({
      topic, branch: facts.branch, artDir: art, phase: facts.abortedPhase ?? "unknown", gate: facts.abortedGate ?? "unknown",
    }));
  }
  log.ok(`solo summary: wrote ${join(art, "SUMMARY.md")}`);
  return 0;
}

/** Read a `key=value` line from a KV file; "" if absent. */
function kvField(path: string, key: string): string {
  if (!existsSync(path)) return "";
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = readFileSync(path, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}
