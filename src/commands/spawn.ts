import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { inTmuxSession, tmuxVersionOk, haveCmd } from "../core/deps.js";
import { topicDir, partDir, repoRoot } from "../core/paths.js";
import { stateInit, stateArchive } from "../core/archive.js";
import { identityWrite, identityPath, inboxWrite, inboxPath, paneMetaWrite, outboxWait, outboxDump } from "../core/ipc.js";
import { paneListedFor } from "../core/score.js";
import { pickRandomInstrument, instrumentInUse, formatCollisionError } from "../core/instruments.js";
import { instrumentBinary, instrumentDefaultMode, instrumentModeArgs, instrumentReadyTimeout, instrumentBootstrapSleep } from "../core/contracts.js";
import { wrapLaunch, splitRight, splitDown, respawn, paneAlive, paneLabelSet, paneSend, killNow, capturePane, ensurePaneBorders } from "../core/tmux.js";
import { labelFor } from "../core/colors.js";
import { captureFailure, captureSpawnFailure, bootstrapFailureArgs } from "../core/forensics.js";

const SLUG = /^[a-z0-9-]+$/;
export function validateSlug(s: string): boolean { return SLUG.test(s) && s.length >= 1 && s.length <= 32; }
export function resolveMode(explicit: string | undefined, dflt: string | undefined): string { return explicit || dflt || "full"; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(args: string[]): Promise<number> {
  if (args.length < 3) { log.error("usage: spawn <instrument|random> <model> <topic> [--mode m] [--cwd abs] [--target-pane id] [initial-prompt]"); return 2; }
  let instrument = args[0];
  const [, model, topic] = args;
  let i = 3, mode = "", cwd = "", targetPane = "", preflightArtDir = "", initial = "";
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" || a.startsWith("--mode=")) { const r = kvParse(a, args[i + 1]); mode = r.value; i += r.shift - 1; }
    else if (a === "--cwd" || a.startsWith("--cwd=")) { const r = kvParse(a, args[i + 1]); cwd = r.value; i += r.shift - 1; }
    else if (a === "--target-pane" || a.startsWith("--target-pane=")) { const r = kvParse(a, args[i + 1]); targetPane = r.value; i += r.shift - 1; }
    else if (a === "--preflight-art-dir" || a.startsWith("--preflight-art-dir=")) { const r = kvParse(a, args[i + 1]); preflightArtDir = r.value; i += r.shift - 1; }
    else { initial = args.slice(i).join(" "); break; }
  }

  if (!validateSlug(topic)) { log.error(`topic must match [a-z0-9-]+ and be <= 32 chars; got: '${topic}'`); return 2; }
  if (instrument !== "random" && !validateSlug(instrument)) { log.error(`instrument must match [a-z0-9-]+ and be <= 32 chars (or 'random'); got: '${instrument}'`); return 2; }
  if (cwd && (!cwd.startsWith("/") || !existsSync(cwd))) { log.error(`spawn --cwd must be an existing absolute path: ${cwd}`); return 1; }

  if (!inTmuxSession()) { log.error("must run inside a tmux session"); return 1; }
  if (!haveCmd("tmux")) { log.error("tmux not on PATH"); return 1; }
  if (!tmuxVersionOk()) { log.error("tmux >= 3.0 required"); return 1; }
  await ensurePaneBorders(); // render @cs_ part labels on pane borders (not the raw TUI title)

  if (instrument === "random") {
    const pick = pickRandomInstrument(topic);
    if (!pick) { log.error(`no available instrument in pool for topic '${topic}'`); return 1; }
    instrument = pick; log.info(`random pick: ${instrument}`);
  }
  if (instrumentInUse(instrument, topic)) { for (const l of formatCollisionError(instrument, model, topic).split("\n")) log.error(l); return 1; }

  const binary = instrumentBinary(model);
  if (!binary) { captureSpawnFailure({ instrument, model, topic, reason: "config_error", detail: `model '${model}' has no entry in contracts.yaml` }); log.error(`model '${model}' has no entry in contracts.yaml`); return 1; }
  if (!haveCmd(binary)) { captureSpawnFailure({ instrument, model, topic, reason: "binary_not_found", detail: `${model}'s binary '${binary}' is not on PATH` }); log.error(`${model}'s binary '${binary}' is not on PATH`); return 1; }
  const useMode = resolveMode(mode, instrumentDefaultMode(model));
  const modeArgs = instrumentModeArgs(model, useMode);
  if (!modeArgs) { captureSpawnFailure({ instrument, model, topic, reason: "config_error", detail: `mode '${useMode}' not defined for ${model} in contracts.yaml` }); log.error(`mode '${useMode}' not defined for ${model} in contracts.yaml`); return 1; }
  const readyTimeout = instrumentReadyTimeout(model);

  log.info(`preparing state for ${instrument}-${model} on ${topic}`);
  try {
    stateInit(instrument, model, topic);
    identityWrite(instrument, model, topic);

    const launch = wrapLaunch([binary, ...modeArgs].join(" "));
    const startDir = cwd || repoRoot();
    let pane: string;
    if (targetPane) {
      if (preflightArtDir) {
        const pf = join(preflightArtDir, "preflight-panes.txt");
        const ok = existsSync(pf) && paneListedFor(readFileSync(pf, "utf8"), instrument, targetPane);
        if (!ok) {
          captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} not listed for ${instrument} in ${pf}` });
          log.error(`--target-pane ${targetPane} is not a preflight pane for ${instrument} (checked ${pf})`); return 1;
        }
      }
      if (!(await paneAlive(targetPane))) {
        captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} is not alive` });
        log.error(`--target-pane ${targetPane} is not alive`); return 1;
      }
      pane = await respawn(targetPane, launch, startDir);
      await paneLabelSet(pane, instrument, model, topic);
    } else {
      const lastFile = join(topicDir(topic), ".last_pane");
      const prior = existsSync(lastFile) ? readFileSync(lastFile, "utf8").trim() : "";
      if (prior && await paneAlive(prior)) pane = await splitDown(launch, prior, startDir);
      else pane = await splitRight(launch, undefined, startDir);
      await paneLabelSet(pane, instrument, model, topic);
      mkdirSync(topicDir(topic), { recursive: true });
      writeFileSync(lastFile, pane + "\n");
    }
    paneMetaWrite(instrument, model, topic, pane);
    log.ok(`spawned ${labelFor(instrument, model, topic)} in pane ${pane} (mode=${useMode})`);

    const boot = instrumentBootstrapSleep(model);
    log.info(`sleeping ${boot}s for ${model} bootstrap`);
    await sleep(boot * 1000);

    log.info(`asking ${instrument} to read identity`);
    await paneSend(pane, `Read ${identityPath(instrument, model, topic)} and follow its instructions exactly.`);

    log.info(`waiting for {ready,error} in outbox (timeout ${readyTimeout}s)`);
    const ev = await outboxWait(instrument, model, topic, ["ready", "error"], readyTimeout);
    if (!ev || ev.event === "error") {
      const reason = ev ? "error_event" : "timeout";
      const tail = await capturePane(pane, 25);
      process.stderr.write(tail + "\n");
      if (!ev) {
        const ob = outboxDump(instrument, model, topic).trim();
        if (ob) process.stderr.write(`outbox:\n${ob}\n`);
      }
      const fr = await captureFailure(
        { instrument, model, topic, paneId: pane, reason: reason as "timeout" | "error_event", eventLine: ev ? JSON.stringify(ev) : undefined, readyTimeout },
        { partDir, capturePane: (p, n) => capturePane(p, n), atomicWriteSync: (d, c) => writeFileSync(d, c), isWritableDir: (d) => existsSync(d), now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
      );
      captureSpawnFailure({ instrument, model, topic, ...bootstrapFailureArgs(ev ?? null, fr.ok ? fr.path : undefined) });
      await killNow(pane);
      const arch = stateArchive(instrument, model, topic, "FAILED");
      log.error(`${instrument} failed bootstrap (${reason}); state archived to: ${arch}`);
      return 1;
    }
    log.ok(`${instrument} is ready`);

    if (initial) {
      initial = initial.replace(/^"|"$/g, "");
      inboxWrite(instrument, model, topic, initial);
      await paneSend(pane, `Read ${inboxPath(instrument, model, topic)} and execute the task. Reply when done.`);
      log.info(`use: consort collect ${instrument} ${topic}  (to wait for {done})`);
    }

    process.stdout.write(`\n  part:    ${labelFor(instrument, model, topic)}\n  pane:    ${pane}\n  state:   ${partDir(instrument, model, topic)}\n  ready:   yes\n`);
    return 0;
  } catch (e) {
    captureSpawnFailure({ instrument, model, topic, reason: "spawn_error", detail: String((e as Error)?.message ?? e) });
    throw e;
  }
}
