// /consort:rehearsal CLI verbs (Phase B front half). Ports deep-research-init.sh
// (slug/codex-gate/flags/scaffolding) + the deep-research.md Phase 0-3 surface.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import { deriveSlug } from "../core/solo.js";
import { extractMetric, formatMetricBlock, formatSotaBlock } from "../core/rehearsalMetric.js";
import { rehearsalArtDir } from "../core/rehearsal.js";
import { instrumentBinary } from "../core/contracts.js";
import { haveCmd } from "../core/deps.js";

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

export async function run(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  switch (verb) {
    case "init": return initWith(rest, liveInitDeps);
    case "metric": return metricWith(rest);
    case "sota": return sotaWith(rest);
    default: log.error(`rehearsal: unknown verb: ${verb ?? "(none)"}`); return 2;
  }
}
