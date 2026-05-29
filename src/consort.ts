#!/usr/bin/env node
import { applyArgsFile } from "./args.js";
import { runArgsFile } from "./core/paths.js";
import { renderBannerHead } from "./core/colors.js";

type Handler = (args: string[]) => Promise<number>;

async function loadHandlers(): Promise<Record<string, Handler>> {
  const [spawn, send, collect, roster, coda, soundcheck, preflight, hook, solo, score] = await Promise.all([
    import("./commands/spawn.js"), import("./commands/send.js"), import("./commands/collect.js"),
    import("./commands/roster.js"), import("./commands/coda.js"), import("./commands/soundcheck.js"),
    import("./commands/preflight.js"), import("./commands/hook.js"), import("./commands/solo.js"),
    import("./commands/score.js"),
  ]);
  return {
    spawn: spawn.run, send: send.run, collect: collect.run, roster: roster.run,
    coda: coda.run, soundcheck: soundcheck.run, preflight: preflight.run, hook: hook.run,
    solo: solo.run, score: score.run,
  };
}

async function banner(label: string, color: string): Promise<number> {
  process.stdout.write(renderBannerHead(label, color) + "\n");
  const c = /^colour(\d+)$/.test(color) ? `\x1b[38;5;${color.replace("colour", "")}m` : "";
  const r = "\x1b[0m";
  const fast = Boolean(process.env.CONSORT_BANNER_FAST);
  for (let i = 8; i >= 1; i--) {
    process.stdout.write(`  ${c}Closing in ${i} second${i === 1 ? "" : "s"}...${r}\r`);
    if (!fast) await new Promise((res) => setTimeout(res, 1000));
  }
  process.stdout.write(`  ${c}Closed.                          ${r}\n`);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub) { process.stderr.write("consort: missing subcommand\n"); return 2; }
  if (sub === "_banner") return banner(rest[0] ?? "part", rest[1] ?? "");

  // --mint-args-file: the command directives' step 1
  if (rest.includes("--mint-args-file")) { process.stdout.write(runArgsFile(sub) + "\n"); return 0; }

  let resolved: string[];
  try { resolved = applyArgsFile(rest); }
  catch (e: any) { process.stderr.write(`${e.message ?? e}\n`); return e.code ?? 2; }

  const handlers = await loadHandlers();
  const fn = handlers[sub];
  if (!fn) { process.stderr.write(`consort: unknown subcommand '${sub}'\n`); return 2; }
  return fn(resolved);
}

main().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
