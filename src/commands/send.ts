import { existsSync, readdirSync, readFileSync } from "node:fs";
import { log } from "../core/log.js";
import { topicDir } from "../core/paths.js";
import { paneMetaModel, paneMetaRead, inboxWrite, inboxPath } from "../core/ipc.js";
import { paneAlive, paneSend } from "../core/tmux.js";

export async function run(args: string[]): Promise<number> {
  let from: string | undefined;
  let a = [...args];
  if (a[0] === "--from") { if (!a[1]) { log.error("--from requires a sender name"); return 2; } from = a[1]; a = a.slice(2); }
  if (a.length < 3) { log.error("usage: send [--from s] <instrument> <topic> <message|@file>"); return 2; }
  const [instrument, topic] = a;
  let msg = a.slice(2).join(" ");

  const td = topicDir(topic);
  const dir = existsSync(td) ? readdirSync(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`)) : undefined;
  if (!dir) { log.error(`no part '${instrument}' on topic '${topic}' (state dir absent)`); log.error(`  spawn first: consort spawn ${instrument} <model> ${topic}`); return 1; }
  const model = paneMetaModel(instrument, dir.name.slice(instrument.length + 1), topic);
  const pane = paneMetaRead(instrument, model, topic);
  if (!pane) { log.error(`pane.json missing for ${instrument}-${model} on ${topic}`); return 1; }
  if (!(await paneAlive(pane))) { log.error(`${instrument}'s pane ${pane} is gone (orphan); run consort coda ${instrument} ${topic}`); return 1; }

  if (msg.startsWith("@")) {
    const f = msg.slice(1);
    if (!existsSync(f)) { log.error(`file not found: ${f}`); return 1; }
    msg = readFileSync(f, "utf8");
  }
  inboxWrite(instrument, model, topic, msg, from ? { from } : undefined);
  const inbox = inboxPath(instrument, model, topic);
  log.info(`wrote inbox at ${inbox}; nudging pane ${pane}`);
  await paneSend(pane, `Read ${inbox} and execute the task. Reply when done.`);
  process.stdout.write(`\n  part:    ${instrument}-${model} on ${topic}\n  pane:    ${pane}\n  inbox:   ${inbox}\n  status:  queued — use: consort collect ${instrument} ${topic}  (to wait for {done})\n`);
  return 0;
}
