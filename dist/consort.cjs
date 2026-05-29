#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/commands/spawn.ts
var spawn_exports = {};
__export(spawn_exports, {
  run: () => run
});
async function run(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_spawn = __esm({
  "src/commands/spawn.ts"() {
    "use strict";
  }
});

// src/commands/send.ts
var send_exports = {};
__export(send_exports, {
  run: () => run2
});
async function run2(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_send = __esm({
  "src/commands/send.ts"() {
    "use strict";
  }
});

// src/commands/collect.ts
var collect_exports = {};
__export(collect_exports, {
  run: () => run3
});
async function run3(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_collect = __esm({
  "src/commands/collect.ts"() {
    "use strict";
  }
});

// src/commands/roster.ts
var roster_exports = {};
__export(roster_exports, {
  run: () => run4
});
async function run4(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_roster = __esm({
  "src/commands/roster.ts"() {
    "use strict";
  }
});

// src/commands/coda.ts
var coda_exports = {};
__export(coda_exports, {
  run: () => run5
});
async function run5(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_coda = __esm({
  "src/commands/coda.ts"() {
    "use strict";
  }
});

// src/commands/soundcheck.ts
var soundcheck_exports = {};
__export(soundcheck_exports, {
  run: () => run6
});
async function run6(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_soundcheck = __esm({
  "src/commands/soundcheck.ts"() {
    "use strict";
  }
});

// src/commands/preflight.ts
var preflight_exports = {};
__export(preflight_exports, {
  run: () => run7
});
async function run7(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_preflight = __esm({
  "src/commands/preflight.ts"() {
    "use strict";
  }
});

// src/commands/hook.ts
var hook_exports = {};
__export(hook_exports, {
  run: () => run8
});
async function run8(_args) {
  process.stderr.write("not implemented\n");
  return 2;
}
var init_hook = __esm({
  "src/commands/hook.ts"() {
    "use strict";
  }
});

// src/args.ts
var import_node_fs = require("node:fs");
var ArgsFileError = class extends Error {
  code = 2;
};
function tokenizeArgsLine(line) {
  const out = [];
  let cur = "", inS = false, inD = false, started = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (inS) {
      if (ch === "'") inS = false;
      else cur += ch;
      continue;
    }
    if (inD) {
      if (ch === '"') inD = false;
      else cur += ch;
      continue;
    }
    if (ch === "'") {
      inS = true;
      started = true;
      continue;
    }
    if (ch === '"') {
      inD = true;
      started = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}
function loadArgsFile(path) {
  if (!(0, import_node_fs.existsSync)(path)) return [];
  const first = (0, import_node_fs.readFileSync)(path, "utf8").split("\n")[0] ?? "";
  return tokenizeArgsLine(first);
}
function consumeArgsFile(path) {
  if (!path) return;
  try {
    (0, import_node_fs.rmSync)(path, { force: true });
  } catch {
  }
}
function applyArgsFile(argv) {
  if (argv[0] !== "--args-file") return [...argv];
  const path = argv[1];
  if (!path) throw new ArgsFileError("--args-file requires a path");
  const tokens = loadArgsFile(path);
  consumeArgsFile(path);
  return [...tokens, ...argv.slice(2)];
}

// src/core/paths.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");
function stateRoot(opts) {
  if (opts?.home) return opts.home;
  if (process.env.CONSORT_HOME) return process.env.CONSORT_HOME;
  return (0, import_node_path.join)(opts?.cwd ?? process.cwd(), ".consort");
}
function ensureGitignore(dir) {
  const gi = (0, import_node_path.join)(dir, ".gitignore");
  if (!(0, import_node_fs2.existsSync)(gi)) (0, import_node_fs2.writeFileSync)(gi, "*\n");
}
function stateEnsure() {
  const root = stateRoot();
  (0, import_node_fs2.mkdirSync)((0, import_node_path.join)(root, "state"), { recursive: true });
  (0, import_node_fs2.mkdirSync)((0, import_node_path.join)(root, "archive"), { recursive: true });
  ensureGitignore(root);
  return root;
}
function runDir(command, opts) {
  if (!command) throw new Error("runDir: missing <command> arg");
  const root = stateEnsure();
  const runRoot = (0, import_node_path.join)(root, "_run");
  (0, import_node_fs2.mkdirSync)(runRoot, { recursive: true });
  ensureGitignore(runRoot);
  const sweepMs = (opts?.sweepSecs ?? 86400) * 1e3;
  for (const name of (0, import_node_fs2.readdirSync)(runRoot)) {
    const child = (0, import_node_path.join)(runRoot, name);
    try {
      const st = (0, import_node_fs2.statSync)(child);
      if (st.isDirectory() && Date.now() - st.mtimeMs > sweepMs) (0, import_node_fs2.rmSync)(child, { recursive: true, force: true });
    } catch {
    }
  }
  const dir = (0, import_node_fs2.mkdtempSync)((0, import_node_path.join)(runRoot, `${command}.`));
  (0, import_node_fs2.writeFileSync)((0, import_node_path.join)(runRoot, ".last"), dir);
  return dir;
}
function runArgsFile(command, prefix) {
  const dir = runDir(command);
  const argsDir = (0, import_node_path.join)(stateRoot(), "_args");
  (0, import_node_fs2.mkdirSync)(argsDir, { recursive: true });
  const f = (0, import_node_fs2.mkdtempSync)((0, import_node_path.join)(argsDir, `${prefix ?? command}.`)) + "/args";
  (0, import_node_fs2.writeFileSync)(f, "");
  (0, import_node_fs2.writeFileSync)((0, import_node_path.join)(dir, "args-path.txt"), f);
  return f;
}

// src/core/colors.ts
function ansiFromColor(color) {
  const m = /^colour([0-9]+)$/.exec(color);
  if (m) return `\x1B[38;5;${m[1]}m`;
  if (/^[0-9]+$/.test(color)) return `\x1B[38;5;${color}m`;
  return "";
}
var RULE = "\u2501".repeat(43);
function renderBannerHead(label, color) {
  const c = ansiFromColor(color), r = "\x1B[0m", b = "\x1B[1m";
  return [
    "",
    `  ${c}${RULE}${r}`,
    `  ${b}${c}${label || "part"}${r}`,
    `  ${c}FINE \u2014 pane closing${r}`,
    `  ${c}${RULE}${r}`,
    ""
  ].join("\n");
}

// src/consort.ts
async function loadHandlers() {
  const [spawn, send, collect, roster, coda, soundcheck, preflight, hook] = await Promise.all([
    Promise.resolve().then(() => (init_spawn(), spawn_exports)),
    Promise.resolve().then(() => (init_send(), send_exports)),
    Promise.resolve().then(() => (init_collect(), collect_exports)),
    Promise.resolve().then(() => (init_roster(), roster_exports)),
    Promise.resolve().then(() => (init_coda(), coda_exports)),
    Promise.resolve().then(() => (init_soundcheck(), soundcheck_exports)),
    Promise.resolve().then(() => (init_preflight(), preflight_exports)),
    Promise.resolve().then(() => (init_hook(), hook_exports))
  ]);
  return {
    spawn: spawn.run,
    send: send.run,
    collect: collect.run,
    roster: roster.run,
    coda: coda.run,
    soundcheck: soundcheck.run,
    preflight: preflight.run,
    hook: hook.run
  };
}
async function banner(label, color) {
  process.stdout.write(renderBannerHead(label, color) + "\n");
  const c = /^colour(\d+)$/.test(color) ? `\x1B[38;5;${color.replace("colour", "")}m` : "";
  const r = "\x1B[0m";
  const fast = Boolean(process.env.CONSORT_BANNER_FAST);
  for (let i = 8; i >= 1; i--) {
    process.stdout.write(`  ${c}Closing in ${i} second${i === 1 ? "" : "s"}...${r}\r`);
    if (!fast) await new Promise((res) => setTimeout(res, 1e3));
  }
  process.stdout.write(`  ${c}Closed.                          ${r}
`);
  return 0;
}
async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);
  if (!sub) {
    process.stderr.write("consort: missing subcommand\n");
    return 2;
  }
  if (sub === "_banner") return banner(rest[0] ?? "part", rest[1] ?? "");
  if (rest.includes("--mint-args-file")) {
    process.stdout.write(runArgsFile(sub) + "\n");
    return 0;
  }
  let resolved;
  try {
    resolved = applyArgsFile(rest);
  } catch (e) {
    process.stderr.write(`${e.message ?? e}
`);
    return e.code ?? 2;
  }
  const handlers = await loadHandlers();
  const fn = handlers[sub];
  if (!fn) {
    process.stderr.write(`consort: unknown subcommand '${sub}'
`);
    return 2;
  }
  return fn(resolved);
}
main().then((code) => process.exit(code)).catch((e) => {
  process.stderr.write(`${e?.stack ?? e}
`);
  process.exit(1);
});
