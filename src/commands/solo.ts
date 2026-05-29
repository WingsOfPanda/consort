// src/commands/solo.ts
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { repoRoot } from "../core/paths.js";
import { soloArtDir, soloExecDir, deriveSlug, parseSoloArgs } from "../core/solo.js";
import { instrumentBinary } from "../core/contracts.js";
import { haveCmd } from "../core/deps.js";
import { pickRandomInstrument } from "../core/instruments.js";

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
async function branchRun(_a: string[]): Promise<number> { log.error("solo branch: not implemented"); return 2; }
async function turnSendRun(_a: string[]): Promise<number> { log.error("solo turn-send: not implemented"); return 2; }
async function turnWaitRun(_a: string[]): Promise<number> { log.error("solo turn-wait: not implemented"); return 2; }
async function detectTestRun(_a: string[]): Promise<number> { log.error("solo detect-test: not implemented"); return 2; }
async function finishRun(_a: string[]): Promise<number> { log.error("solo finish: not implemented"); return 2; }
async function summaryRun(_a: string[]): Promise<number> { log.error("solo summary: not implemented"); return 2; }
