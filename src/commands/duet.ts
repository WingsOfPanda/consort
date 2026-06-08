// src/commands/duet.ts — /consort:duet collaborative cross-repo session.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { instrumentBinary } from "../core/contracts.js";
import { haveCmd } from "../core/deps.js";
import { pickRandomInstrument } from "../core/instruments.js";
import { runnerAt, preSnapshot, createOrResumeBranch, finishBranchPrMerge } from "../core/gitwork.js";
import type { Runner } from "../core/gitwork.js";
import { readIfExists } from "../core/fsread.js";
import { runForensics, runFlag } from "../core/forensics.js";
import { detectTestCommand } from "../core/solo.js";
import { repoRoot } from "../core/paths.js";
import { parseDuetArgs, deriveSlug, duetArtDir, duetExecDir, renderDuetSummary, renderDuetResume } from "../core/duet.js";
import type { DuetSummaryFacts } from "../core/duet.js";
import { composeDuetBrief, composeDuetFollowup } from "../core/duetTurn.js";
import { classifyTurn } from "../core/turn.js";
import { parseLatestOffset } from "../core/scoreTurn.js";
import { outboxOffset, outboxPath, statusPath, outboxWaitSince } from "../core/ipc.js";
import type { OutboxEvent } from "../core/ipc.js";
import { run as sendRun } from "./send.js";

function usage(): number {
  log.error("usage: duet <init|branch|round-send|round-wait|relay|detect-test|finish|forensics|flag|summary> ...");
  return 2;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest, { valueFlags: new Set(["--provider", "--repo"]) }));
    case "branch": return branchRun(rest);
    case "round-send": return roundSendRun(rest);
    case "round-wait": return roundWaitRun(rest);
    case "relay": return relayRun(rest);
    case "detect-test": return detectTestRun(rest);
    case "finish": return finishRun(rest);
    case "summary": return summaryRun(rest);
    case "forensics": return runForensics("duet", duetArtDir, rest[0]);
    case "flag": return runFlag("duet", rest[0], rest.slice(1).join(" "));
    default: return usage();
  }
}

export interface InitDeps {
  haveCmd(bin: string): boolean;
  instrumentBinary(provider: string): string | undefined;
  pickRandomInstrument(slug: string): string | null;
  isGitRepo(dir: string): boolean;
  headSha(dir: string): string;
}
const liveInitDeps: InitDeps = {
  haveCmd, instrumentBinary, pickRandomInstrument,
  isGitRepo: (dir) => runnerAt(dir).run("git", ["rev-parse", "--is-inside-work-tree"]).code === 0,
  headSha: (dir) => runnerAt(dir).run("git", ["rev-parse", "HEAD"]).stdout.trim(),
};

async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: InitDeps): Promise<number> {
  const { repo, taskText, provider: provArg, inPlace } = parseDuetArgs(tokens);
  if (!taskText) { log.error("duet init: task text is empty"); return 1; }
  if (!repo) { log.error("duet init: --repo <abs-path> is required"); return 1; }
  if (!repo.startsWith("/") || /\s/.test(repo)) { log.error(`duet init: --repo must be a whitespace-free absolute path: '${repo}'`); return 1; }
  if (!existsSync(repo)) { log.error(`duet init: --repo does not exist: ${repo}`); return 1; }
  if (!inPlace && !d.isGitRepo(repo)) { log.error(`duet init: --repo is not a git repository (use --in-place to skip isolation): ${repo}`); return 1; }

  const slug = deriveSlug(taskText);
  if (!slug) { log.error("duet init: task produced an empty slug; provide alphanumerics"); return 1; }

  const provider = provArg ?? "codex";
  const binary = d.instrumentBinary(provider);
  if (!binary) { log.error(`duet init: provider '${provider}' has no entry in contracts.yaml`); return 3; }
  if (!d.haveCmd(binary)) { log.error(`duet init: ${provider}'s binary '${binary}' is not on PATH`); return 3; }

  const art = duetArtDir(slug);
  if (existsSync(art)) { log.error(`duet init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different task"); return 2; }

  const instrument = d.pickRandomInstrument(slug);
  if (!instrument) { log.error(`duet init: no available instrument in the pool for '${slug}'`); return 1; }

  const mode = inPlace ? "in-place" : "branch";
  const exec = duetExecDir(slug);
  mkdirSync(exec, { recursive: true });
  atomicWrite(join(art, "topic.txt"), slug + "\n");
  atomicWrite(join(art, "topic-text.txt"), taskText);
  atomicWrite(join(art, "selected-provider.txt"), provider + "\n");
  atomicWrite(join(art, "instrument.txt"), instrument + "\n");
  atomicWrite(join(art, "timing.txt"), `started=${isoUtc()}\n`);
  atomicWrite(join(exec, "provider.txt"), provider + "\n");
  atomicWrite(join(exec, "mode.txt"), mode + "\n");
  atomicWrite(join(exec, "target_cwd.txt"), repo + "\n");      // INVARIANT: init owns this (branch is skipped under --in-place)
  atomicWrite(join(exec, "repo-b-head.txt"), (inPlace ? "" : d.headSha(repo)) + "\n");

  log.ok(`duet init: topic=${slug} instrument=${instrument} provider=${provider} mode=${mode} repo=${repo}`);
  process.stdout.write(`SLUG=${slug}\nINSTRUMENT=${instrument}\nPROVIDER=${provider}\nMODE=${mode}\nTARGET=${repo}\n`);
  return 0;
}

function readField(path: string): string {
  return readIfExists(path).split("\n")[0].trim();
}

async function branchRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet branch <topic>"); return 2; }
  const target = readField(join(duetExecDir(topic), "target_cwd.txt"));
  if (!target) { log.error("duet branch: target_cwd.txt missing — run duet init first"); return 1; }
  return branchWith(topic, target, runnerAt(target));
}

export async function branchWith(topic: string, target: string, r: Runner): Promise<number> {
  const snap = preSnapshot(r, "duet", topic);
  if (snap.state === "not-git") { log.error(`duet branch: ${target} is not a git repository`); return 1; }
  const branch = `feat/duet-${topic}`;
  // Single-occupancy: refuse if repo B is already on a DIFFERENT duet branch from another live session.
  if (snap.branch.startsWith("feat/duet-") && snap.branch !== branch) {
    log.error(`duet branch: ${target} is already on ${snap.branch} (another duet session?) — refusing`);
    return 1;
  }
  const onBranch = createOrResumeBranch(r, branch);
  const exec = duetExecDir(topic);
  atomicWrite(join(exec, "start-branch.txt"), snap.branch + "\n");
  atomicWrite(join(exec, "branch-base.sha"), snap.baseSha + "\n");
  atomicWrite(join(exec, "branch.txt"), branch + "\n");
  if (!onBranch) { log.warn(`duet branch: checkout ${branch} failed; staying on ${snap.branch}`); }
  log.ok(`duet branch: ${branch} (snapshot=${snap.state}, base=${snap.baseSha.slice(0, 8)})`);
  return 0;
}

export interface TurnSendDeps {
  offsetFor(instrument: string, model: string, topic: string): number;
  send(args: string[]): Promise<number>;
}
const DUET_TURN_TIMEOUT = Number(process.env.CONSORT_DUET_TURN_TIMEOUT) || 14400;

async function roundSendRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: duet round-send <topic> <round>=1.."); return 2; }
  return roundSendWith(topic, round, {
    offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)),
    send: (args) => sendRun(args),
  });
}

export async function roundSendWith(topic: string, round: number, d: TurnSendDeps): Promise<number> {
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet round-send: missing instrument.txt/selected-provider.txt (run duet init)"); return 1; }

  const outbox = outboxPath(instrument, provider, topic);
  if (!existsSync(outbox)) { log.error(`duet round-send: outbox not found at ${outbox} — was ${instrument} spawned?`); return 1; }
  const sp = statusPath(instrument, provider, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`duet round-send: part not idle (state=${m[1]}); previous round still in flight`); return 1; } }

  const stateFile = join(exec, `round-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`duet round-send: ${stateFile} already exists; rm to retry`); return 1; }

  let prompt: string;
  if (round === 1) {
    const task = readIfExists(join(art, "topic-text.txt"));
    const repo = readField(join(exec, "target_cwd.txt"));
    const branch = readField(join(exec, "branch.txt")) || "the current branch";
    prompt = composeDuetBrief(task, repo, branch);
  } else {
    const bundle = join(exec, `followup-${round}.md`);
    if (!existsSync(bundle)) { log.error(`duet round-send: follow-up bundle missing: ${bundle} (the directive must write it first)`); return 1; }
    prompt = composeDuetFollowup(readFileSync(bundle, "utf8"), round);
  }

  const promptFile = join(exec, `round-prompt-${round}.md`);
  atomicWrite(promptFile, prompt);
  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);

  const rc = await d.send([instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`duet round-send: send failed (rc=${rc}); ${stateFile} kept for retry`); return 1; }
  log.ok(`duet round-send: round=${round} offset=${offset}`);
  return 0;
}

export interface TurnWaitDeps {
  wait(instrument: string, model: string, topic: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null>;
}

async function roundWaitRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: duet round-wait <topic> <round>=1.."); return 2; }
  return roundWaitWith(topic, round, { wait: (i, m, t, off, ev, to) => outboxWaitSince(i, m, t, off, ev, to) });
}

export async function roundWaitWith(topic: string, round: number, d: TurnWaitDeps): Promise<number> {
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet round-wait: missing instrument.txt/selected-provider.txt"); return 1; }
  const stateFile = join(exec, `round-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`duet round-wait: ${stateFile} missing (run duet round-send first)`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`duet round-wait: OFFSET not set in ${stateFile}`); return 1; }

  log.info(`duet round-wait: round=${round} offset=${offset} timeout=${DUET_TURN_TIMEOUT}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], DUET_TURN_TIMEOUT);
  const ts = classifyTurn(ev);
  if (ts === "question" && ev) {
    atomicWrite(join(exec, `question-${round}.txt`), JSON.stringify(ev) + "\n");
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n`);
  } else {
    appendFileSync(stateFile, `TS=${ts}\n`);
  }
  log.ok(`duet round-wait: round=${round} TS=${ts}`);
  return 0;
}

// Local mirror of solo.ts's private kvField (reads a key=value line from a state file).
function kvField(path: string, key: string): string {
  if (!existsSync(path)) return "";
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = readFileSync(path, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

async function relayRun(rest: string[]): Promise<number> {
  const [topic, roundStr, ...answerParts] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1 || answerParts.length === 0) {
    log.error("usage: duet relay <topic> <round> <answer|@file>"); return 2;
  }
  const art = duetArtDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet relay: missing instrument/provider (run duet init)"); return 1; }
  const answer = answerParts.join(" ");
  // NOTE: round-wait already bumped OFFSET past the question; relay only sends + records.
  const rc = await sendRun(["--from", "maestro", instrument, topic, answer]);
  if (rc !== 0) { log.error(`duet relay: send failed (rc=${rc})`); return 1; }
  appendFileSync(join(duetExecDir(topic), `question-${round}.txt`), `RELAYED=${answer}\n`);
  log.ok(`duet relay: round=${round} answered`);
  return 0;
}

async function detectTestRun(rest: string[]): Promise<number> {
  const cwd = rest[0] || repoRoot();
  process.stdout.write(detectTestCommand(cwd) + "\n");
  return 0;
}

async function finishRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet finish <topic>"); return 2; }
  const target = readField(join(duetExecDir(topic), "target_cwd.txt"));
  if (!target) { log.error("duet finish: target_cwd.txt missing/empty — refusing (will NOT fall back to the conductor repo)"); return 1; }
  return finishWith(topic, runnerAt(target), haveCmd("gh"));
}

export async function finishWith(topic: string, r: Runner, hasGh: boolean): Promise<number> {
  const exec = duetExecDir(topic);
  const mode = readField(join(exec, "mode.txt")) || "branch";
  if (mode === "in-place") {
    atomicWrite(join(exec, "finish-result.txt"), "none\tin-place (commits on the current branch)\n");
    log.ok("duet finish: in-place — commits left on the current branch");
    return 0;
  }
  const branch = readField(join(exec, "branch.txt"));
  const startBranch = readField(join(exec, "start-branch.txt")) || "main";
  const base = readField(join(exec, "branch-base.sha"));
  if (base) {
    const ds = r.run("git", ["diff", "--shortstat", `${base}..HEAD`]).stdout.trim();
    atomicWrite(join(exec, "diff-stats.txt"), (ds || "(no changes)") + "\n");
  }
  const task = readIfExists(join(duetArtDir(topic), "topic-text.txt"));
  const verify = readField(join(exec, "verify-result.txt"));
  const res = finishBranchPrMerge(r, {
    branch, base: startBranch, hasGh,
    title: `duet: ${branch}`,
    body: `${task}\n\nVerify: ${verify}\n\n(Automated duet branch — merged into ${startBranch}.)`,
  });
  atomicWrite(join(exec, "finish-result.txt"), `${res.action}\t${res.outcome}\n`);
  log.ok(`duet finish: ${res.action} → ${res.outcome}`);
  return 0;
}

async function summaryRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet summary <topic> [--aborted <phase> <gate> <reason...>]"); return 2; }
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const started = kvField(join(art, "timing.txt"), "started") || "unknown";
  let ended: string | undefined, duration: number | undefined;
  const i = rest.indexOf("--aborted");
  const aborted = i >= 0;
  if (!aborted) {
    ended = isoUtc();
    const s = Date.parse(started), e = Date.parse(ended);
    duration = Number.isFinite(s) && Number.isFinite(e) ? Math.round((e - s) / 1000) : 0;
    atomicWrite(join(art, "timing.txt"), `started=${started}\nended=${ended}\nduration=${duration}\n`);
  }
  // count rounds = highest round-<n>.txt present (files are contiguous 1..K: round-send refuses to
  // overwrite an existing round-<n>.txt and the directive only ever advances the round by +1)
  let rounds = 0; while (existsSync(join(exec, `round-${rounds + 1}.txt`))) rounds++;

  const facts: DuetSummaryFacts = {
    topic, status: aborted ? "aborted" : "ok", started, ended, duration,
    provider: readField(join(art, "selected-provider.txt")) || "unknown",
    instrument: readField(join(art, "instrument.txt")) || "unknown",
    repo: readField(join(exec, "target_cwd.txt")) || "<repo>",
    mode: readField(join(exec, "mode.txt")) || "branch",
    branch: readField(join(exec, "branch.txt")) || "(none)",
    rounds,
    verify: readField(join(exec, "verify-result.txt")) || "unknown",
    diffStats: readField(join(exec, "diff-stats.txt")) || "unknown",
    archived: readField(join(art, "archived-path.txt")) || "(not archived)",
    finishResult: readField(join(exec, "finish-result.txt")) || "(not finished)",
    abortedPhase: aborted ? rest[i + 1] : undefined,
    abortedGate: aborted ? rest[i + 2] : undefined,
    abortedReason: aborted ? rest.slice(i + 3).join(" ") || "unknown" : undefined,
  };
  atomicWrite(join(art, "SUMMARY.md"), renderDuetSummary(facts));
  if (aborted) {
    atomicWrite(join(art, "RESUME.md"), renderDuetResume({
      topic, repo: facts.repo, branch: facts.branch, mode: facts.mode, lastRound: rounds,
      task: readIfExists(join(art, "topic-text.txt")),
      phase: facts.abortedPhase ?? "unknown", gate: facts.abortedGate ?? "unknown",
    }));
  }
  log.ok(`duet summary: wrote ${join(art, "SUMMARY.md")}`);
  return 0;
}
