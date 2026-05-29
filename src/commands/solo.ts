// src/commands/solo.ts
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { repoRoot } from "../core/paths.js";
import { soloArtDir, soloExecDir, deriveSlug, parseSoloArgs, detectTestCommand } from "../core/solo.js";
import { instrumentBinary } from "../core/contracts.js";
import { haveCmd } from "../core/deps.js";
import { pickRandomInstrument } from "../core/instruments.js";
import { runnerAt, preSnapshot, createOrResumeBranch } from "../core/gitwork.js";
import type { Runner } from "../core/gitwork.js";
import { outboxOffset, outboxPath, outboxWaitSince, type OutboxEvent } from "../core/ipc.js";
import { composeRound1Prompt, composeFixPrompt, classifyTurn, parseOffset } from "../core/turn.js";
import { run as sendRun } from "./send.js";

function usage(): number {
  log.error("usage: solo <init|branch|turn-send|turn-wait|detect-test|finish|summary> ...");
  return 2;
}

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
    case "summary": return summaryRun(rest);
    default: return usage();
  }
}

// Handlers are filled in by later tasks. Stubs keep the dispatcher compilable.
async function initRun(tokens: string[]): Promise<number> {
  const { topicText, provider: provArg, finish } = parseSoloArgs(tokens);
  if (!topicText) { log.error("solo init: topic text is empty"); return 1; }
  const slug = deriveSlug(topicText);
  if (!slug) { log.error("solo init: topic produced an empty slug; provide alphanumerics"); return 1; }

  const provider = provArg ?? "codex";
  const binary = instrumentBinary(provider);
  if (!binary) { log.error(`solo init: provider '${provider}' has no entry in contracts.yaml`); return 3; }
  if (!haveCmd(binary)) { log.error(`solo init: ${provider}'s binary '${binary}' is not on PATH`); return 3; }

  const art = soloArtDir(slug);
  if (existsSync(art)) { log.error(`solo init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different topic"); return 2; }

  const instrument = pickRandomInstrument(slug);
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
  const snap = preSnapshot(r, topic);
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
  return existsSync(path) ? readFileSync(path, "utf8").split("\n")[0].trim() : "";
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
async function finishRun(_a: string[]): Promise<number> { log.error("solo finish: not implemented"); return 2; }
async function summaryRun(_a: string[]): Promise<number> { log.error("solo summary: not implemented"); return 2; }
