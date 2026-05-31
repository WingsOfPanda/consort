import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { resolveModel, outboxWait, outboxDump } from "../core/ipc.js";

export async function run(args: string[]): Promise<number> {
  if (args.length < 2) { log.error("usage: collect <instrument> <topic> [--timeout n]"); return 2; }
  const [instrument, topic] = args;
  let timeout = 600;
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--timeout" || a.startsWith("--timeout=")) { const r = kvParse(a, args[i + 1]); timeout = Number(r.value); i += r.shift - 1; }
    else { log.error(`unknown arg: ${a}`); return 2; }
  }
  const model = resolveModel(instrument, topic);
  if (!model) { log.error(`no part '${instrument}' on topic '${topic}'`); return 1; }
  log.info(`tailing outbox for ${instrument}-${model} (timeout ${timeout}s)`);
  const ev = await outboxWait(instrument, model, topic, ["done", "error"], timeout);
  if (ev?.event === "done") { log.ok("{done} received"); process.stdout.write(JSON.stringify(ev) + "\n"); return 0; }
  if (ev?.event === "error") { log.error(`{error} received from ${instrument}`); process.stdout.write(JSON.stringify(ev) + "\n"); return 1; }
  log.error(`timeout after ${timeout}s; outbox tail:`);
  process.stderr.write(outboxDump(instrument, model, topic).split("\n").slice(-5).join("\n") + "\n");
  return 1;
}
