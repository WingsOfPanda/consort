import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { topicDir } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import { preflightLayout, PreflightEntry } from "../core/tmux.js";

const SLUG = /^[a-z0-9-]+$/;

export async function run(args: string[]): Promise<number> {
  if (args.length < 2) { log.error("usage: preflight <topic> <N> [--roster i1:m1,i2:m2,...] [--art-dir abs]"); return 2; }
  const topic = args[0];
  const n = Number(args[1]);
  let rosterArg = "", artDir = "";
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--roster" || a.startsWith("--roster=")) { const r = kvParse(a, args[i + 1]); rosterArg = r.value; i += r.shift - 1; }
    else if (a === "--art-dir" || a.startsWith("--art-dir=")) { const r = kvParse(a, args[i + 1]); artDir = r.value; i += r.shift - 1; }
  }
  if (!SLUG.test(topic) || topic.length > 64) { log.error(`topic must match [a-z0-9-]+ and be <= 64 chars; got: '${topic}'`); return 2; }
  if (!Number.isInteger(n) || n < 2 || n > 4) { log.error(`N must be 2..4; got: '${args[1]}'`); return 2; }

  const roster: PreflightEntry[] = rosterArg.split(",").filter(Boolean).map((pair) => {
    const [instrument, model] = pair.split(":");
    return { instrument, model };
  });
  if (roster.length !== n) { log.error(`roster has ${roster.length} entries, expected ${n}`); return 1; }

  const art = artDir || join(topicDir(topic), "_consult");
  mkdirSync(art, { recursive: true });
  const panesFile = join(art, "preflight-panes.txt");
  try {
    const out = await preflightLayout(topic, roster, { writePanes: (tsv) => atomicWrite(panesFile, tsv) });
    log.ok(`preflight: ${out.length} panes allocated for topic ${topic}`);
    for (const o of out) process.stdout.write(`  ${o.instrument}\t${o.pane}\n`);
    return 0;
  } catch (e: any) {
    log.error(`preflight failed: ${e?.message ?? e}`);
    return 1;
  }
}
