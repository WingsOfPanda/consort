#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/args.ts
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
function loadArgsFile(path6) {
  if (!(0, import_node_fs.existsSync)(path6)) return [];
  const first = (0, import_node_fs.readFileSync)(path6, "utf8").split("\n")[0] ?? "";
  return tokenizeArgsLine(first);
}
function consumeArgsFile(path6) {
  if (!path6) return;
  try {
    (0, import_node_fs.rmSync)(path6, { force: true });
  } catch {
  }
}
function applyArgsFile(argv) {
  if (argv[0] !== "--args-file") return [...argv];
  const path6 = argv[1];
  if (!path6) throw new ArgsFileError("--args-file requires a path");
  const tokens = loadArgsFile(path6);
  consumeArgsFile(path6);
  return [...tokens, ...argv.slice(2)];
}
function kvParse(flag, next) {
  if (flag.includes("=")) return { value: flag.slice(flag.indexOf("=") + 1), shift: 1 };
  if (next === void 0) throw new KvError(flag);
  return { value: next, shift: 2 };
}
var import_node_fs, ArgsFileError, KvError;
var init_args = __esm({
  "src/args.ts"() {
    "use strict";
    import_node_fs = require("node:fs");
    ArgsFileError = class extends Error {
      code = 2;
    };
    KvError = class extends Error {
      constructor(flag) {
        super(`${flag} requires a value`);
        this.flag = flag;
      }
      code = 2;
    };
  }
});

// src/core/paths.ts
function globalRoot(home) {
  return home ?? process.env.CONSORT_HOME ?? (0, import_node_path.join)((0, import_node_os.homedir)(), ".consort");
}
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
function repoHash(cwd = process.cwd()) {
  let real;
  try {
    real = (0, import_node_fs2.realpathSync)(cwd);
  } catch {
    real = cwd;
  }
  return (0, import_node_crypto.createHash)("sha256").update(real, "utf8").digest("hex");
}
function repoStateDir(opts) {
  return (0, import_node_path.join)(stateRoot(opts), "state", repoHash(opts?.cwd));
}
function topicDir(topic, opts) {
  return (0, import_node_path.join)(repoStateDir(opts), topic);
}
function partDir(instrument, model, topic, opts) {
  return (0, import_node_path.join)(topicDir(topic, opts), `${instrument}-${model}`);
}
function repoRoot(cwd = process.cwd()) {
  try {
    return (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return cwd;
  }
}
function isArtifactDir(p) {
  return (0, import_node_path.basename)(p.replace(/\/+$/, "")).startsWith("_");
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
var import_node_crypto, import_node_fs2, import_node_os, import_node_path, import_node_child_process;
var init_paths = __esm({
  "src/core/paths.ts"() {
    "use strict";
    import_node_crypto = require("node:crypto");
    import_node_fs2 = require("node:fs");
    import_node_os = require("node:os");
    import_node_path = require("node:path");
    import_node_child_process = require("node:child_process");
  }
});

// src/core/colors.ts
function entry(instrument) {
  return PALETTE[instrument.toLowerCase()] ?? FALLBACK;
}
function sectionFor(instrument) {
  return entry(instrument).section;
}
function colorFor(instrument) {
  return entry(instrument).primary;
}
function labelFor(instrument, model, topic) {
  return `${sectionFor(instrument)}-${instrument}:${model}:${topic}`;
}
function labelFmt(instrument, model, topic) {
  const e = entry(instrument);
  return `#[fg=${e.primary},bold]${e.section}-${instrument}#[default]:#[fg=${e.secondary},bold]${model}#[default]:${topic}`;
}
function ansiFromColor(color) {
  const m = /^colour([0-9]+)$/.exec(color);
  if (m) return `\x1B[38;5;${m[1]}m`;
  if (/^[0-9]+$/.test(color)) return `\x1B[38;5;${color}m`;
  return "";
}
function renderBannerHead(label, color) {
  const c3 = ansiFromColor(color), r = "\x1B[0m", b = "\x1B[1m";
  return [
    "",
    `  ${c3}${RULE}${r}`,
    `  ${b}${c3}${label || "part"}${r}`,
    `  ${c3}FINE \u2014 pane closing${r}`,
    `  ${c3}${RULE}${r}`,
    ""
  ].join("\n");
}
var PALETTE, FALLBACK, RULE;
var init_colors = __esm({
  "src/core/colors.ts"() {
    "use strict";
    PALETTE = {
      // strings — cool dusty blues/slate
      violin: { section: "strings", primary: "colour110", secondary: "colour187" },
      viola: { section: "strings", primary: "colour109", secondary: "colour187" },
      cello: { section: "strings", primary: "colour67", secondary: "colour187" },
      contrabass: { section: "strings", primary: "colour60", secondary: "colour250" },
      harp: { section: "strings", primary: "colour103", secondary: "colour187" },
      // woodwinds — sage/olive earth tones
      flute: { section: "woodwinds", primary: "colour108", secondary: "colour144" },
      piccolo: { section: "woodwinds", primary: "colour144", secondary: "colour247" },
      oboe: { section: "woodwinds", primary: "colour100", secondary: "colour137" },
      clarinet: { section: "woodwinds", primary: "colour101", secondary: "colour241" },
      bassoon: { section: "woodwinds", primary: "colour95", secondary: "colour241" },
      recorder: { section: "woodwinds", primary: "colour152", secondary: "colour187" },
      // brass — terracotta/warm
      horn: { section: "brass", primary: "colour137", secondary: "colour187" },
      trumpet: { section: "brass", primary: "colour173", secondary: "colour144" },
      trombone: { section: "brass", primary: "colour180", secondary: "colour247" },
      tuba: { section: "brass", primary: "colour131", secondary: "colour110" },
      cornet: { section: "brass", primary: "colour223", secondary: "colour174" },
      // percussion — neutral greys
      timpani: { section: "percussion", primary: "colour102", secondary: "colour247" },
      celesta: { section: "percussion", primary: "colour245", secondary: "colour187" },
      vibraphone: { section: "percussion", primary: "colour243", secondary: "colour250" },
      marimba: { section: "percussion", primary: "colour96", secondary: "colour250" },
      xylophone: { section: "percussion", primary: "colour250", secondary: "colour241" },
      glockenspiel: { section: "percussion", primary: "colour247", secondary: "colour250" },
      // keys — cream/beige
      piano: { section: "keys", primary: "colour187", secondary: "colour250" },
      organ: { section: "keys", primary: "colour181", secondary: "colour250" },
      harpsichord: { section: "keys", primary: "colour146", secondary: "colour250" },
      // early — mauve/plum
      lute: { section: "early", primary: "colour139", secondary: "colour241" },
      theorbo: { section: "early", primary: "colour97", secondary: "colour187" },
      viol: { section: "early", primary: "colour132", secondary: "colour137" },
      sackbut: { section: "early", primary: "colour138", secondary: "colour241" },
      shawm: { section: "early", primary: "colour174", secondary: "colour250" },
      crumhorn: { section: "early", primary: "colour182", secondary: "colour250" },
      cittern: { section: "early", primary: "colour218", secondary: "colour250" }
    };
    FALLBACK = { section: "tutti", primary: "white", secondary: "default" };
    RULE = "\u2501".repeat(43);
  }
});

// src/core/log.ts
function createLogger(opts) {
  const stream = opts?.stream ?? process.stderr;
  const color = opts?.color ?? Boolean(stream.isTTY);
  const emit = (col, label, a2) => {
    const tag = color ? `${col}${label}${C.rst}` : label;
    stream.write(`${tag}  ${a2.join(" ")}
`);
  };
  return {
    info: (...a2) => emit(C.blu, "[INFO]", a2),
    warn: (...a2) => emit(C.yel, "[WARN]", a2),
    error: (...a2) => emit(C.red, "[FAIL]", a2),
    ok: (...a2) => emit(C.grn, "[ OK ]", a2)
  };
}
var C, log;
var init_log = __esm({
  "src/core/log.ts"() {
    "use strict";
    C = { red: "\x1B[31m", grn: "\x1B[32m", yel: "\x1B[33m", blu: "\x1B[34m", rst: "\x1B[0m" };
    log = createLogger();
  }
});

// src/core/deps.ts
function haveCmd(name) {
  try {
    (0, import_node_child_process2.execFileSync)("/bin/sh", ["-c", 'command -v "$1"', "sh", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function tmuxVersionString(run9) {
  if (run9) return run9();
  if (!haveCmd("tmux")) return null;
  try {
    return (0, import_node_child_process2.execFileSync)("tmux", ["-V"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
function tmuxVersionOk(versionString) {
  const v = versionString ?? tmuxVersionString();
  if (!v) return false;
  const stripped = v.replace(/^tmux /, "");
  const majorRaw = stripped.split(".")[0] ?? "";
  const major = parseInt(majorRaw.replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(major) && major >= 3;
}
function inTmuxSession(env = process.env) {
  return Boolean(env.TMUX);
}
var import_node_child_process2;
var init_deps = __esm({
  "src/core/deps.ts"() {
    "use strict";
    import_node_child_process2 = require("node:child_process");
  }
});

// src/core/atomic.ts
function atomicWrite(dest, content) {
  if (!dest) throw new Error("atomicWrite: missing dest path");
  const tmp = `${dest}.tmp.${process.pid}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}`;
  try {
    (0, import_node_fs3.writeFileSync)(tmp, content);
    (0, import_node_fs3.renameSync)(tmp, dest);
  } catch (e) {
    try {
      (0, import_node_fs3.rmSync)(tmp, { force: true });
    } catch {
    }
    throw e;
  }
}
var import_node_fs3, import_node_crypto2;
var init_atomic = __esm({
  "src/core/atomic.ts"() {
    "use strict";
    import_node_fs3 = require("node:fs");
    import_node_crypto2 = require("node:crypto");
  }
});

// src/core/archive.ts
function archiveTs(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace(/Z$/, "Z");
}
function stateInit(instrument, model, topic) {
  const dir = partDir(instrument, model, topic);
  (0, import_node_fs4.mkdirSync)(dir, { recursive: true });
  for (const f of STALE) (0, import_node_fs4.rmSync)((0, import_node_path2.join)(dir, f), { force: true });
  (0, import_node_fs4.closeSync)((0, import_node_fs4.openSync)((0, import_node_path2.join)(dir, "outbox.jsonl"), "w"));
  (0, import_node_fs4.writeFileSync)((0, import_node_path2.join)(dir, ".session_id"), `${process.env.CLAUDE_CODE_SESSION_ID ?? "unknown"}
`);
}
function uniqueDest(base) {
  if (!(0, import_node_fs4.existsSync)(base)) return base;
  for (let n2 = 2; n2 <= 999; n2++) {
    const c3 = `${base}-${n2}`;
    if (!(0, import_node_fs4.existsSync)(c3)) return c3;
  }
  throw new Error("too many same-second archive collisions; aborting");
}
function stateArchive(instrument, model, topic, suffix, opts) {
  const src = partDir(instrument, model, topic);
  if (!(0, import_node_fs4.existsSync)(src)) return null;
  const ts = archiveTs(opts?.now);
  let base = (0, import_node_path2.join)(globalRoot(), "archive", repoHash(), topic, `${instrument}-${model}-${ts}`);
  if (suffix) base += `-${suffix}`;
  const dest = uniqueDest(base);
  (0, import_node_fs4.mkdirSync)((0, import_node_path2.dirname)(dest), { recursive: true });
  (0, import_node_fs4.renameSync)(src, dest);
  return dest;
}
var import_node_fs4, import_node_path2, STALE;
var init_archive = __esm({
  "src/core/archive.ts"() {
    "use strict";
    import_node_fs4 = require("node:fs");
    import_node_path2 = require("node:path");
    init_paths();
    init_atomic();
    STALE = ["identity.md", "inbox.md", "outbox.jsonl", "status.json", "pane.json", ".session_id"];
  }
});

// src/core/ipc.ts
function inboxPath(i2, m, t) {
  return (0, import_node_path3.join)(partDir(i2, m, t), "inbox.md");
}
function outboxPath(i2, m, t) {
  return (0, import_node_path3.join)(partDir(i2, m, t), "outbox.jsonl");
}
function identityPath(i2, m, t) {
  return (0, import_node_path3.join)(partDir(i2, m, t), "identity.md");
}
function paneMetaPath(i2, m, t) {
  return (0, import_node_path3.join)(partDir(i2, m, t), "pane.json");
}
function inboxWrite(i2, m, t, task, opts) {
  const from = opts?.from ?? "maestro";
  if (!SENDER_RE.test(from)) throw new Error(`inboxWrite: invalid sender name '${from}' (allowed: [a-zA-Z0-9_-])`);
  const outbox = outboxPath(i2, m, t);
  const body = `From: ${from}

${task}

When done, append a single JSONL line to ${outbox}:

\`{"event":"done","summary":"<one-line summary>","ts":"<iso-timestamp>"}\`

END_OF_INSTRUCTION
`;
  atomicWrite(inboxPath(i2, m, t), body);
}
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}
function identityWrite(i2, m, t) {
  const tplPath = (0, import_node_path3.join)(pluginRoot(), "config", "prompt-templates", "identity.md");
  const stateDir = partDir(i2, m, t);
  const outbox = outboxPath(i2, m, t);
  let body = (0, import_node_fs5.readFileSync)(tplPath, "utf8").replaceAll("{{instrument}}", i2).replaceAll("{{model}}", m).replaceAll("{{topic}}", t).replaceAll("{{state_dir}}", stateDir);
  body += `

---

**First action (do this immediately, then wait):**

Append exactly ONE JSONL line to ${outbox}. The line MUST be:

\`{"event":"ready","ts":"<ISO-8601 UTC>","instrument":"` + i2 + '","model":"' + m + `"}\`

Generate the timestamp at the moment you emit. Use this shell command verbatim:

\`echo "{\\"event\\":\\"ready\\",\\"ts\\":\\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\\",\\"instrument\\":\\"` + i2 + '\\",\\"model\\":\\"' + m + '\\"}" >> ' + outbox + `\`

Then stop and wait. I will send another instruction asking you to read your inbox.
`;
  atomicWrite(identityPath(i2, m, t), body);
}
function outboxOffset(path6) {
  try {
    return (0, import_node_fs5.statSync)(path6).size;
  } catch {
    return 0;
  }
}
function readFrom(path6, offset) {
  const size = outboxOffset(path6);
  const start = size < offset ? 0 : offset;
  if (size <= start) return "";
  const fd = (0, import_node_fs5.openSync)(path6, "r");
  try {
    const buf = Buffer.alloc(size - start);
    (0, import_node_fs5.readSync)(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    (0, import_node_fs5.closeSync)(fd);
  }
}
function lastMatch(text, events) {
  const lines = text.split("\n").filter(Boolean);
  for (const name of events) {
    for (let k = lines.length - 1; k >= 0; k--) {
      try {
        const obj = JSON.parse(lines[k]);
        if (obj.event === name) return obj;
      } catch {
      }
    }
  }
  return null;
}
async function outboxWaitSince(i2, m, t, offset, events, timeoutSec) {
  const path6 = outboxPath(i2, m, t);
  for (let n2 = 0; n2 < timeoutSec; n2++) {
    const hit = lastMatch(readFrom(path6, offset), events);
    if (hit) return hit;
    await sleep(1e3);
  }
  return null;
}
async function outboxWait(i2, m, t, events, timeoutSec) {
  return outboxWaitSince(i2, m, t, 0, events, timeoutSec);
}
function outboxDump(i2, m, t) {
  const p = outboxPath(i2, m, t);
  return (0, import_node_fs5.existsSync)(p) ? (0, import_node_fs5.readFileSync)(p, "utf8") : "";
}
function paneMetaWrite(i2, m, t, paneId, opts) {
  const spawned = (opts?.now ?? /* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  atomicWrite(paneMetaPath(i2, m, t), JSON.stringify({ pane_id: paneId, instrument: i2, model: m, spawned_at: spawned }) + "\n");
}
function paneMetaReadForDir(dir) {
  const p = (0, import_node_path3.join)(dir, "pane.json");
  if ((0, import_node_fs5.existsSync)(p)) {
    try {
      const o2 = JSON.parse((0, import_node_fs5.readFileSync)(p, "utf8"));
      if (o2.instrument && o2.model) return { instrument: o2.instrument, model: o2.model, paneId: o2.pane_id ?? "" };
    } catch {
    }
  }
  const name = dir.replace(/\/+$/, "").split("/").pop() ?? "";
  return { instrument: name.replace(/-[^-]*$/, ""), model: name.replace(/^.*-/, ""), paneId: "" };
}
function paneMetaRead(i2, m, t) {
  const p = paneMetaPath(i2, m, t);
  if (!(0, import_node_fs5.existsSync)(p)) return null;
  try {
    return JSON.parse((0, import_node_fs5.readFileSync)(p, "utf8")).pane_id ?? null;
  } catch {
    return null;
  }
}
function paneMetaModel(i2, modelHint, t) {
  const p = paneMetaPath(i2, modelHint, t);
  if ((0, import_node_fs5.existsSync)(p)) {
    try {
      return JSON.parse((0, import_node_fs5.readFileSync)(p, "utf8")).model ?? modelHint;
    } catch {
    }
  }
  return modelHint;
}
var import_node_fs5, import_node_path3, SENDER_RE, sleep;
var init_ipc = __esm({
  "src/core/ipc.ts"() {
    "use strict";
    import_node_fs5 = require("node:fs");
    import_node_path3 = require("node:path");
    init_paths();
    init_atomic();
    SENDER_RE = /^[a-zA-Z0-9_-]+$/;
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  }
});

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports2) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports2.ALIAS = ALIAS;
    exports2.DOC = DOC;
    exports2.MAP = MAP;
    exports2.NODE_TYPE = NODE_TYPE;
    exports2.PAIR = PAIR;
    exports2.SCALAR = SCALAR;
    exports2.SEQ = SEQ;
    exports2.hasAnchor = hasAnchor;
    exports2.isAlias = isAlias;
    exports2.isCollection = isCollection;
    exports2.isDocument = isDocument;
    exports2.isMap = isMap;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar;
    exports2.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity3.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path6) {
      const ctrl = callVisitor(key, node, visitor, path6);
      if (identity3.isNode(ctrl) || identity3.isPair(ctrl)) {
        replaceNode(key, path6, ctrl);
        return visit_(key, ctrl, visitor, path6);
      }
      if (typeof ctrl !== "symbol") {
        if (identity3.isCollection(node)) {
          path6 = Object.freeze(path6.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = visit_(i2, node.items[i2], visitor, path6);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity3.isPair(node)) {
          path6 = Object.freeze(path6.concat(node));
          const ck = visit_("key", node.key, visitor, path6);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path6);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity3.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path6) {
      const ctrl = await callVisitor(key, node, visitor, path6);
      if (identity3.isNode(ctrl) || identity3.isPair(ctrl)) {
        replaceNode(key, path6, ctrl);
        return visitAsync_(key, ctrl, visitor, path6);
      }
      if (typeof ctrl !== "symbol") {
        if (identity3.isCollection(node)) {
          path6 = Object.freeze(path6.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = await visitAsync_(i2, node.items[i2], visitor, path6);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity3.isPair(node)) {
          path6 = Object.freeze(path6.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path6);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path6);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path6) {
      if (typeof visitor === "function")
        return visitor(key, node, path6);
      if (identity3.isMap(node))
        return visitor.Map?.(key, node, path6);
      if (identity3.isSeq(node))
        return visitor.Seq?.(key, node, path6);
      if (identity3.isPair(node))
        return visitor.Pair?.(key, node, path6);
      if (identity3.isScalar(node))
        return visitor.Scalar?.(key, node, path6);
      if (identity3.isAlias(node))
        return visitor.Alias?.(key, node, path6);
      return void 0;
    }
    function replaceNode(key, path6, node) {
      const parent = path6[path6.length - 1];
      if (identity3.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity3.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity3.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity3.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports2.visit = visit;
    exports2.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity3.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity3.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports2.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i2 = 1; true; ++i2) {
        const name = `${prefix}${i2}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity3.isScalar(ref.node) || identity3.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports2.anchorIsValid = anchorIsValid;
    exports2.anchorNames = anchorNames;
    exports2.createNodeAnchors = createNodeAnchors;
    exports2.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports2) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i2 = 0, len = val.length; i2 < len; ++i2) {
            const v0 = val[i2];
            const v1 = applyReviver(reviver, val, String(i2), v0);
            if (v1 === void 0)
              delete val[i2];
            else if (v1 !== v0)
              val[i2] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports2.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i2) => toJS(v, String(i2), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity3.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports2.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports2) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity3 = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity3.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity3.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports2.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity3 = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity3.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity3.isAlias(node) || identity3.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity3.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity3.isCollection(node)) {
        let count2 = 0;
        for (const item of node.items) {
          const c3 = getAliasCount(doc, item, anchors2);
          if (c3 > count2)
            count2 = c3;
        }
        return count2;
      } else if (identity3.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports2.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity3.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports2.Scalar = Scalar;
    exports2.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity3.isDocument(value))
        value = value.contents;
      if (identity3.isNode(value))
        return value;
      if (identity3.isPair(value)) {
        const map = ctx.schema[identity3.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity3.MAP] : Symbol.iterator in Object(value) ? schema[identity3.SEQ] : schema[identity3.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports2.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var identity3 = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path6, value) {
      let v = value;
      for (let i2 = path6.length - 1; i2 >= 0; --i2) {
        const k = path6[i2];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a2 = [];
          a2[k] = v;
          v = a2;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path6) => path6 == null || typeof path6 === "object" && !!path6[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity3.isNode(it) || identity3.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path6, value) {
        if (isEmptyPath(path6))
          this.add(value);
        else {
          const [key, ...rest] = path6;
          const node = this.get(key, true);
          if (identity3.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path6) {
        const [key, ...rest] = path6;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity3.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path6, keepScalar) {
        const [key, ...rest] = path6;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity3.isScalar(node) ? node.value : node;
        else
          return identity3.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity3.isPair(node))
            return false;
          const n2 = node.value;
          return n2 == null || allowScalar && identity3.isScalar(n2) && n2.value == null && !n2.commentBefore && !n2.comment && !n2.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path6) {
        const [key, ...rest] = path6;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity3.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path6, value) {
        const [key, ...rest] = path6;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity3.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports2.Collection = Collection;
    exports2.collectionFromPath = collectionFromPath;
    exports2.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports2) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports2.indentComment = indentComment;
    exports2.lineComment = lineComment;
    exports2.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports2) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i2 = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i2 = consumeMoreIndentedLines(text, i2, indent.length);
        if (i2 !== -1)
          end = i2 + endStep;
      }
      for (let ch; ch = text[i2 += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i2;
          switch (text[i2 + 1]) {
            case "x":
              i2 += 3;
              break;
            case "u":
              i2 += 5;
              break;
            case "U":
              i2 += 9;
              break;
            default:
              i2 += 1;
          }
          escEnd = i2;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i2 = consumeMoreIndentedLines(text, i2, indent.length);
          end = i2 + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i2 + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i2;
          }
          if (i2 >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i2 += 1];
                overflow = true;
              }
              const j = i2 > escEnd + 1 ? i2 - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i3 = 0; i3 < folds.length; ++i3) {
        const fold = folds[i3];
        const end2 = folds[i3 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i2, indent) {
      let end = i2;
      let start = i2 + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i2 < start + indent) {
          ch = text[++i2];
        } else {
          do {
            ch = text[++i2];
          } while (ch && ch !== "\n");
          end = i2;
          start = i2 + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports2.FOLD_BLOCK = FOLD_BLOCK;
    exports2.FOLD_FLOW = FOLD_FLOW;
    exports2.FOLD_QUOTED = FOLD_QUOTED;
    exports2.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i2 = 0, start = 0; i2 < strLen; ++i2) {
        if (str[i2] === "\n") {
          if (i2 - start > limit)
            return true;
          start = i2 + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i2 = 0, ch = json[i2]; ch; ch = json[++i2]) {
        if (ch === " " && json[i2 + 1] === "\\" && json[i2 + 2] === "n") {
          str += json.slice(start, i2) + "\\ ";
          i2 += 1;
          start = i2;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i2 + 1]) {
            case "u":
              {
                str += json.slice(start, i2);
                const code = json.substr(i2 + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i2, 6);
                }
                i2 += 5;
                start = i2 + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i2 + 2] === '"' || json.length < minMultiLineLength) {
                i2 += 1;
              } else {
                str += json.slice(start, i2) + "\n\n";
                while (json[i2 + 2] === "\\" && json[i2 + 3] === "n" && json[i2 + 4] !== '"') {
                  str += "\n";
                  i2 += 2;
                }
                str += indent;
                if (json[i2 + 2] === " ")
                  str += "\\";
                i2 += 1;
                start = i2 + 1;
              }
              break;
            default:
              i2 += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports2.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var identity3 = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity3.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity3.isScalar(node) || identity3.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity3.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity3.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity3.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o2) => tagObj = o2 });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity3.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity3.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports2.createStringifyContext = createStringifyContext;
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity3.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity3.isCollection(key) || !identity3.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity3.isCollection(key) || (identity3.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity3.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity3.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity3.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity3.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports2.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports2) {
    "use strict";
    var node_process = require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports2.debug = debug;
    exports2.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity3.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity3.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity3.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity3.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports2.addMergeToJSMap = addMergeToJSMap;
    exports2.isMergeKey = isMergeKey;
    exports2.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log2 = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity3 = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity3.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity3.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log2.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports2.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity3 = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity3.NODE_TYPE, { value: identity3.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity3.isNode(key))
          key = key.clone(schema);
        if (identity3.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports2.Pair = Pair;
    exports2.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment2 = null;
        if (identity3.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity3.isPair(item)) {
          const ik = identity3.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i2 = 1; i2 < lines.length; ++i2) {
          const line = lines[i2];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment = null;
        if (identity3.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity3.isPair(item)) {
          const ik = identity3.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity3.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i2 < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports2.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports2) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity3 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity3.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity3.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity3.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity3.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity3.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity3.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i2 = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i2 === -1)
            this.items.push(_pair);
          else
            this.items.splice(i2, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity3.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity3.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports2.YAMLMap = YAMLMap;
    exports2.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity3.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports2.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity3.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity3.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity3.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i2 = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i2++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i2 = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i2++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity3.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports2.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity3.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports2.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports2) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports2.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports2.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports2) {
    "use strict";
    function stringifyNumber({ format: format2, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n2 = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format2 && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n2) && !n2.includes("e")) {
        let i2 = n2.indexOf(".");
        if (i2 < 0) {
          i2 = n2.length;
          n2 += ".";
        }
        let d = minFractionDigits - (n2.length - i2 - 1);
        while (d-- > 0)
          n2 += "0";
      }
      return n2;
    }
    exports2.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports2) {
    "use strict";
    var node_buffer = require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i2 = 0; i2 < str.length; ++i2)
            buffer[i2] = str.charCodeAt(i2);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i2 = 0; i2 < buf.length; ++i2)
            s += String.fromCharCode(buf[i2]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n2 = Math.ceil(str.length / lineWidth);
          const lines = new Array(n2);
          for (let i2 = 0, o2 = 0; i2 < n2; ++i2, o2 += lineWidth) {
            lines[i2] = str.substr(o2, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports2.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity3.isSeq(seq)) {
        for (let i2 = 0; i2 < seq.items.length; ++i2) {
          let item = seq.items[i2];
          if (identity3.isPair(item))
            continue;
          else if (identity3.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i2] = identity3.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i2 = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i2++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports2.createPairs = createPairs;
    exports2.pairs = pairs;
    exports2.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity3.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity3.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports2.YAMLOMap = YAMLOMap;
    exports2.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports2.falseTag = falseTag;
    exports2.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n3 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n3 : n3;
      }
      const n2 = parseInt(str, radix);
      return sign === "-" ? -1 * n2 : n2;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int;
    exports2.intBin = intBin;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity3.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity3.isPair(pair) ? identity3.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity3.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports2.YAMLSet = YAMLSet;
    exports2.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n2) => asBigInt ? BigInt(n2) : Number(n2);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n2) => n2;
      if (typeof value === "bigint")
        num = (n2) => BigInt(n2);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n2) => String(n2).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports2.floatTime = floatTime;
    exports2.intTime = intTime;
    exports2.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports2.coreKnownTags = coreKnownTags;
    exports2.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a2, b) => a2.key < b.key ? -1 : a2.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity3.MAP, { value: map.map });
        Object.defineProperty(this, identity3.SCALAR, { value: string.string });
        Object.defineProperty(this, identity3.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports2.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity3.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports2.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity3 = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity3.NODE_TYPE, { value: identity3.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity3.NODE_TYPE]: { value: identity3.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity3.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path6, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path6, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity3.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path6) {
        if (Collection.isEmptyPath(path6)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path6) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity3.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path6, keepScalar) {
        if (Collection.isEmptyPath(path6))
          return !keepScalar && identity3.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity3.isCollection(this.contents) ? this.contents.getIn(path6, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity3.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path6) {
        if (Collection.isEmptyPath(path6))
          return this.contents !== void 0;
        return identity3.isCollection(this.contents) ? this.contents.hasIn(path6) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path6, value) {
        if (Collection.isEmptyPath(path6)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path6), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path6, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity3.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports2.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports2) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count2 = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count2 = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count2);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports2.YAMLError = YAMLError;
    exports2.YAMLParseError = YAMLParseError;
    exports2.YAMLWarning = YAMLWarning;
    exports2.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports2) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports2.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports2) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports2.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports2) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports2.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a2, b) => a2 === b || identity3.isScalar(a2) && identity3.isScalar(b) && a2.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports2.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports2) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports2.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports2) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports2.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports2) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports2.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i2 = 0; i2 < fc.items.length; ++i2) {
        const collItem = fc.items[i2];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i2 === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i2 < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i2 === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity3.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports2.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity3.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports2.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i2 = lines.length - 1; i2 >= 0; --i2) {
        const content = lines[i2][1];
        if (content === "" || content === "\r")
          chompStart = i2;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i2 = 0; i2 < chompStart; ++i2) {
        const [indent, content] = lines[i2];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i2;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i2 = lines.length - 1; i2 >= chompStart; --i2) {
        if (lines[i2][0].length > trimIndent)
          chompStart = i2 + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i2 = 0; i2 < contentStart; ++i2)
        value += lines[i2][0].slice(trimIndent) + "\n";
      for (let i2 = contentStart; i2 < chompStart; ++i2) {
        let [indent, content] = lines[i2];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i2 = chompStart; i2 < lines.length; ++i2)
            value += "\n" + lines[i2][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i2 = 1; i2 < source.length; ++i2) {
        const ch = source[i2];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n2 = Number(ch);
          if (!indent && n2)
            indent = n2;
          else if (error === -1)
            error = offset + i2;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i2 = 1; i2 < props.length; ++i2) {
        const token = props[i2];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i2 = 1; i2 < split.length; i2 += 2)
        lines.push([split[i2], split[i2 + 1]]);
      return lines;
    }
    exports2.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i2 = 1; i2 < source.length - 1; ++i2) {
        const ch = source[i2];
        if (ch === "\r" && source[i2 + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i2);
          res += fold;
          i2 = offset;
        } else if (ch === "\\") {
          let next = source[++i2];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "\r" && source[i2 + 1] === "\n") {
            next = source[++i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i2 + 1, length, onError);
            i2 += length;
          } else {
            const raw = source.substr(i2 - 1, 2);
            onError(i2 - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i2;
          let next = source[i2 + 1];
          while (next === " " || next === "	")
            next = source[++i2 + 1];
          if (next !== "\n" && !(next === "\r" && source[i2 + 2] === "\n"))
            res += i2 > wsStart ? source.slice(wsStart, i2 + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports2.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports2) {
    "use strict";
    var identity3 = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity3.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity3.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity3.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity3.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity3.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity3.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity3.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports2.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports2) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i2 = pos - 1; i2 >= 0; --i2) {
          let st = before[i2];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i2];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i2];
          }
          break;
        }
      }
      return offset;
    }
    exports2.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity3 = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity3.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports2.composeEmptyNode = composeEmptyNode;
    exports2.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports2) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports2.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity3 = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i2 = 0; i2 < prelude.length; ++i2) {
        const source = prelude[i2];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i2 + 1]?.[0] !== "#")
              i2 += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity3.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity3.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i2 = 0; i2 < this.errors.length; ++i2)
            doc.errors.push(this.errors[i2]);
          for (let i2 = 0; i2 < this.warnings.length; ++i2)
            doc.warnings.push(this.warnings[i2]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports2.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports2) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports2.createScalarToken = createScalarToken;
    exports2.resolveAsScalar = resolveAsScalar;
    exports2.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports2) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports2) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path6) => {
      let item = cst;
      for (const [field, index] of path6) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path6) => {
      const parent = visit.itemAtPath(cst, path6.slice(0, -1));
      const field = path6[path6.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path6, item, visitor) {
      let ctrl = visitor(item, path6);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i2 = 0; i2 < token.items.length; ++i2) {
            const ci = _visit(Object.freeze(path6.concat([[field, i2]])), token.items[i2], visitor);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i2, 1);
              i2 -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path6);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path6) : ctrl;
    }
    exports2.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports2) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports2.createScalarToken = cstScalar.createScalarToken;
    exports2.resolveAsScalar = cstScalar.resolveAsScalar;
    exports2.setScalarValue = cstScalar.setScalarValue;
    exports2.stringify = cstStringify.stringify;
    exports2.visit = cstVisit.visit;
    exports2.BOM = BOM;
    exports2.DOCUMENT = DOCUMENT;
    exports2.FLOW_END = FLOW_END;
    exports2.SCALAR = SCALAR;
    exports2.isCollection = isCollection;
    exports2.isScalar = isScalar;
    exports2.prettyToken = prettyToken;
    exports2.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports2) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i2];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i2 + 1] === "\n";
        return false;
      }
      charAt(n2) {
        return this.buffer[this.pos + n2];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n2) {
        return this.pos + n2 <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n2) {
        return this.buffer.substr(this.pos, n2);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n2 = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n2);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n2 = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n2;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n2 = yield* this.pushIndicators();
        switch (line[n2]) {
          case "#":
            yield* this.pushCount(line.length - n2);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n2 += yield* this.parseBlockScalarHeader();
            n2 += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n2);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n2 = 0;
        while (line[n2] === ",") {
          n2 += yield* this.pushCount(1);
          n2 += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n2 += yield* this.pushIndicators();
        switch (line[n2]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n2);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n2 = 0;
            while (this.buffer[end - 1 - n2] === "\\")
              n2 += 1;
            if (n2 % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i2 = this.pos;
        while (true) {
          const ch = this.buffer[++i2];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i3 = this.pos; ch = this.buffer[i3]; ++i3) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i3;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i3 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i2 = nl + 1;
        ch = this.buffer[i2];
        while (ch === " ")
          ch = this.buffer[++i2];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i2];
          nl = i2 - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i3 = nl - 1;
            let ch2 = this.buffer[i3];
            if (ch2 === "\r")
              ch2 = this.buffer[--i3];
            const lastChar = i3;
            while (ch2 === " ")
              ch2 = this.buffer[--i3];
            if (ch2 === "\n" && i3 >= this.pos && i3 + 1 + indent > lastChar)
              nl = i3;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i2 = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i2]) {
          if (ch === ":") {
            const next = this.buffer[i2 + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i2;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i2 + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i2 += 1;
                ch = "\n";
                next = this.buffer[i2 + 1];
              } else
                end = i2;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i2 + 1);
              if (cs === -1)
                break;
              i2 = Math.max(i2, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i2;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n2) {
        if (n2 > 0) {
          yield this.buffer.substr(this.pos, n2);
          this.pos += n2;
          return n2;
        }
        return 0;
      }
      *pushToIndex(i2, allowEmpty) {
        const s = this.buffer.slice(this.pos, i2);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n2 = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n2 += yield* this.pushTag();
              n2 += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n2 += yield* this.pushUntil(isNotAnchorChar);
              n2 += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n2 += yield* this.pushCount(1);
                n2 += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n2;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i2 = this.pos + 2;
          let ch = this.buffer[i2];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i2];
          return yield* this.pushToIndex(ch === ">" ? i2 + 1 : i2, false);
        } else {
          let i2 = this.pos + 1;
          let ch = this.buffer[i2];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i2];
            else if (ch === "%" && hexDigits.has(this.buffer[i2 + 1]) && hexDigits.has(this.buffer[i2 + 2])) {
              ch = this.buffer[i2 += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i2, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i2 = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i2];
        } while (ch === " " || allowTabs && ch === "	");
        const n2 = i2 - this.pos;
        if (n2 > 0) {
          yield this.buffer.substr(this.pos, n2);
          this.pos = i2;
        }
        return n2;
      }
      *pushUntil(test) {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (!test(ch))
          ch = this.buffer[++i2];
        return yield* this.pushToIndex(i2, false);
      }
    };
    exports2.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports2) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports2.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i2 = 0; i2 < list.length; ++i2)
        if (list[i2].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i2 = 0; i2 < list.length; ++i2) {
        switch (list[i2].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i2;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i2 = prev.length;
      loop: while (--i2 >= 0) {
        switch (prev[i2].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i2]?.type === "space") {
      }
      return prev.splice(i2, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i2 = 0; i2 < source.length; ++i2)
          target.push(source[i2]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n2) {
        return this.stack[this.stack.length - n2];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i2 = 0; i2 < it.sep.length; ++i2) {
              const st = it.sep[i2];
              switch (st.type) {
                case "newline":
                  nl.push(i2);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports2.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log2 = require_log();
    var identity3 = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse3(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log2.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity3.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports2.parse = parse3;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument;
    exports2.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity3 = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports2.Composer = composer.Composer;
    exports2.Document = Document.Document;
    exports2.Schema = Schema.Schema;
    exports2.YAMLError = errors.YAMLError;
    exports2.YAMLParseError = errors.YAMLParseError;
    exports2.YAMLWarning = errors.YAMLWarning;
    exports2.Alias = Alias.Alias;
    exports2.isAlias = identity3.isAlias;
    exports2.isCollection = identity3.isCollection;
    exports2.isDocument = identity3.isDocument;
    exports2.isMap = identity3.isMap;
    exports2.isNode = identity3.isNode;
    exports2.isPair = identity3.isPair;
    exports2.isScalar = identity3.isScalar;
    exports2.isSeq = identity3.isSeq;
    exports2.Pair = Pair.Pair;
    exports2.Scalar = Scalar.Scalar;
    exports2.YAMLMap = YAMLMap.YAMLMap;
    exports2.YAMLSeq = YAMLSeq.YAMLSeq;
    exports2.CST = cst;
    exports2.Lexer = lexer.Lexer;
    exports2.LineCounter = lineCounter.LineCounter;
    exports2.Parser = parser.Parser;
    exports2.parse = publicApi.parse;
    exports2.parseAllDocuments = publicApi.parseAllDocuments;
    exports2.parseDocument = publicApi.parseDocument;
    exports2.stringify = publicApi.stringify;
    exports2.visit = visit.visit;
    exports2.visitAsync = visit.visitAsync;
  }
});

// src/core/instruments.ts
function pluginRoot2() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}
function instrumentsPath() {
  const user = (0, import_node_path4.join)(globalRoot(), "instruments.yaml");
  return (0, import_node_fs6.existsSync)(user) ? user : (0, import_node_path4.join)(pluginRoot2(), "config", "instruments.yaml");
}
function loadInstrumentPool() {
  const p = instrumentsPath();
  if (!(0, import_node_fs6.existsSync)(p)) return [];
  try {
    const doc = (0, import_yaml.parse)((0, import_node_fs6.readFileSync)(p, "utf8"));
    const list = Array.isArray(doc) ? doc : doc?.instruments;
    return Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function instrumentsInDir(dir) {
  if (!(0, import_node_fs6.existsSync)(dir)) return [];
  const out = [];
  for (const name of (0, import_node_fs6.readdirSync)(dir, { withFileTypes: true })) {
    if (!name.isDirectory() || isArtifactDir(name.name)) continue;
    const meta = paneMetaReadForDir((0, import_node_path4.join)(dir, name.name));
    if (meta.instrument) out.push(meta.instrument);
  }
  return out;
}
function instrumentsInUseInTopic(topic) {
  return [...new Set(instrumentsInDir(topicDir(topic)))].sort();
}
function instrumentInUse(instrument, topic) {
  return instrumentsInUseInTopic(topic).includes(instrument);
}
function instrumentsInUseGlobally() {
  const repo = repoStateDir();
  if (!(0, import_node_fs6.existsSync)(repo)) return [];
  const all = [];
  for (const t of (0, import_node_fs6.readdirSync)(repo, { withFileTypes: true })) {
    if (t.isDirectory()) all.push(...instrumentsInDir((0, import_node_path4.join)(repo, t.name)));
  }
  return [...new Set(all)].sort();
}
function pickRandomInstrument(topic, rng = Math.random) {
  const pool = loadInstrumentPool();
  const global3 = new Set(instrumentsInUseGlobally());
  let candidates = pool.filter((x) => !global3.has(x));
  if (candidates.length === 0) {
    const local = new Set(instrumentsInUseInTopic(topic));
    candidates = pool.filter((x) => !local.has(x));
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}
function formatCollisionError(instrument, model, topic, sessionId) {
  const lines = [`${instrument} is already deployed on ${topic}; pick another instrument`];
  const sidFile = (0, import_node_path4.join)(partDir(instrument, model, topic), ".session_id");
  let owner = "";
  if ((0, import_node_fs6.existsSync)(sidFile)) owner = (0, import_node_fs6.readFileSync)(sidFile, "utf8").split("\n")[0] ?? "";
  const me = sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? "unknown";
  if (owner && owner !== me) lines.push(`  owned by another Claude Code session (id=${owner.slice(0, 8)}\u2026, mine=${me.slice(0, 8)}\u2026)`);
  lines.push(`  or run: /consort:coda ${instrument} ${topic}`);
  return lines.join("\n");
}
var import_node_fs6, import_node_path4, import_yaml;
var init_instruments = __esm({
  "src/core/instruments.ts"() {
    "use strict";
    import_node_fs6 = require("node:fs");
    import_node_path4 = require("node:path");
    import_yaml = __toESM(require_dist(), 1);
    init_paths();
    init_ipc();
  }
});

// src/core/contracts.ts
function pluginRoot3() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}
function contractsPath() {
  const user = (0, import_node_path5.join)(globalRoot(), "contracts.yaml");
  return (0, import_node_fs7.existsSync)(user) ? user : (0, import_node_path5.join)(pluginRoot3(), "config", "contracts.yaml");
}
function load() {
  const p = contractsPath();
  if (!(0, import_node_fs7.existsSync)(p)) return {};
  try {
    return (0, import_yaml2.parse)((0, import_node_fs7.readFileSync)(p, "utf8")) ?? {};
  } catch {
    return {};
  }
}
function listInstruments() {
  return Object.keys(load()).filter((k) => k !== "consult");
}
function inst(name) {
  const d = load();
  return name !== "consult" ? d[name] : void 0;
}
function instrumentBinary(name) {
  return inst(name)?.binary || void 0;
}
function instrumentDefaultMode(name) {
  return inst(name)?.default_mode || void 0;
}
function instrumentModeArgs(name, mode) {
  const m = inst(name)?.modes?.[mode];
  return Array.isArray(m) ? m.map(String) : void 0;
}
function instrumentReadyTimeout(name) {
  const v = inst(name)?.ready_timeout_s;
  return typeof v === "number" ? v : 30;
}
function instrumentBootstrapSleep(name) {
  const v = inst(name)?.bootstrap_sleep_s;
  if (typeof v === "number") return v;
  return name === "claude" ? 12 : 8;
}
function contractsExist() {
  return (0, import_node_fs7.existsSync)(contractsPath());
}
var import_node_fs7, import_node_path5, import_yaml2;
var init_contracts = __esm({
  "src/core/contracts.ts"() {
    "use strict";
    import_node_fs7 = require("node:fs");
    import_node_path5 = require("node:path");
    import_yaml2 = __toESM(require_dist(), 1);
    init_paths();
  }
});

// node_modules/is-plain-obj/index.js
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}
var init_is_plain_obj = __esm({
  "node_modules/is-plain-obj/index.js"() {
  }
});

// node_modules/execa/lib/arguments/file-url.js
var import_node_url, safeNormalizeFileUrl, normalizeDenoExecPath, isDenoExecPath, normalizeFileUrl;
var init_file_url = __esm({
  "node_modules/execa/lib/arguments/file-url.js"() {
    import_node_url = require("node:url");
    safeNormalizeFileUrl = (file, name) => {
      const fileString = normalizeFileUrl(normalizeDenoExecPath(file));
      if (typeof fileString !== "string") {
        throw new TypeError(`${name} must be a string or a file URL: ${fileString}.`);
      }
      return fileString;
    };
    normalizeDenoExecPath = (file) => isDenoExecPath(file) ? file.toString() : file;
    isDenoExecPath = (file) => typeof file !== "string" && file && Object.getPrototypeOf(file) === String.prototype;
    normalizeFileUrl = (file) => file instanceof URL ? (0, import_node_url.fileURLToPath)(file) : file;
  }
});

// node_modules/execa/lib/methods/parameters.js
var normalizeParameters;
var init_parameters = __esm({
  "node_modules/execa/lib/methods/parameters.js"() {
    init_is_plain_obj();
    init_file_url();
    normalizeParameters = (rawFile, rawArguments = [], rawOptions = {}) => {
      const filePath = safeNormalizeFileUrl(rawFile, "First argument");
      const [commandArguments, options] = isPlainObject(rawArguments) ? [[], rawArguments] : [rawArguments, rawOptions];
      if (!Array.isArray(commandArguments)) {
        throw new TypeError(`Second argument must be either an array of arguments or an options object: ${commandArguments}`);
      }
      if (commandArguments.some((commandArgument) => typeof commandArgument === "object" && commandArgument !== null)) {
        throw new TypeError(`Second argument must be an array of strings: ${commandArguments}`);
      }
      const normalizedArguments = commandArguments.map(String);
      const nullByteArgument = normalizedArguments.find((normalizedArgument) => normalizedArgument.includes("\0"));
      if (nullByteArgument !== void 0) {
        throw new TypeError(`Arguments cannot contain null bytes ("\\0"): ${nullByteArgument}`);
      }
      if (!isPlainObject(options)) {
        throw new TypeError(`Last argument must be an options object: ${options}`);
      }
      return [filePath, normalizedArguments, options];
    };
  }
});

// node_modules/execa/lib/utils/uint-array.js
var import_node_string_decoder, objectToString, isArrayBuffer, isUint8Array, bufferToUint8Array, textEncoder, stringToUint8Array, textDecoder, uint8ArrayToString, joinToString, uint8ArraysToStrings, joinToUint8Array, stringsToUint8Arrays, concatUint8Arrays, getJoinLength;
var init_uint_array = __esm({
  "node_modules/execa/lib/utils/uint-array.js"() {
    import_node_string_decoder = require("node:string_decoder");
    ({ toString: objectToString } = Object.prototype);
    isArrayBuffer = (value) => objectToString.call(value) === "[object ArrayBuffer]";
    isUint8Array = (value) => objectToString.call(value) === "[object Uint8Array]";
    bufferToUint8Array = (buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    textEncoder = new TextEncoder();
    stringToUint8Array = (string) => textEncoder.encode(string);
    textDecoder = new TextDecoder();
    uint8ArrayToString = (uint8Array) => textDecoder.decode(uint8Array);
    joinToString = (uint8ArraysOrStrings, encoding) => {
      const strings = uint8ArraysToStrings(uint8ArraysOrStrings, encoding);
      return strings.join("");
    };
    uint8ArraysToStrings = (uint8ArraysOrStrings, encoding) => {
      if (encoding === "utf8" && uint8ArraysOrStrings.every((uint8ArrayOrString) => typeof uint8ArrayOrString === "string")) {
        return uint8ArraysOrStrings;
      }
      const decoder = new import_node_string_decoder.StringDecoder(encoding);
      const strings = uint8ArraysOrStrings.map((uint8ArrayOrString) => typeof uint8ArrayOrString === "string" ? stringToUint8Array(uint8ArrayOrString) : uint8ArrayOrString).map((uint8Array) => decoder.write(uint8Array));
      const finalString = decoder.end();
      return finalString === "" ? strings : [...strings, finalString];
    };
    joinToUint8Array = (uint8ArraysOrStrings) => {
      if (uint8ArraysOrStrings.length === 1 && isUint8Array(uint8ArraysOrStrings[0])) {
        return uint8ArraysOrStrings[0];
      }
      return concatUint8Arrays(stringsToUint8Arrays(uint8ArraysOrStrings));
    };
    stringsToUint8Arrays = (uint8ArraysOrStrings) => uint8ArraysOrStrings.map((uint8ArrayOrString) => typeof uint8ArrayOrString === "string" ? stringToUint8Array(uint8ArrayOrString) : uint8ArrayOrString);
    concatUint8Arrays = (uint8Arrays) => {
      const result = new Uint8Array(getJoinLength(uint8Arrays));
      let index = 0;
      for (const uint8Array of uint8Arrays) {
        result.set(uint8Array, index);
        index += uint8Array.length;
      }
      return result;
    };
    getJoinLength = (uint8Arrays) => {
      let joinLength = 0;
      for (const uint8Array of uint8Arrays) {
        joinLength += uint8Array.length;
      }
      return joinLength;
    };
  }
});

// node_modules/execa/lib/methods/template.js
var import_node_child_process3, isTemplateString, parseTemplates, parseTemplate, splitByWhitespaces, DELIMITERS, ESCAPE_LENGTH, concatTokens, parseExpression, getSubprocessResult;
var init_template = __esm({
  "node_modules/execa/lib/methods/template.js"() {
    import_node_child_process3 = require("node:child_process");
    init_is_plain_obj();
    init_uint_array();
    isTemplateString = (templates) => Array.isArray(templates) && Array.isArray(templates.raw);
    parseTemplates = (templates, expressions) => {
      let tokens = [];
      for (const [index, template] of templates.entries()) {
        tokens = parseTemplate({
          templates,
          expressions,
          tokens,
          index,
          template
        });
      }
      if (tokens.length === 0) {
        throw new TypeError("Template script must not be empty");
      }
      const [file, ...commandArguments] = tokens;
      return [file, commandArguments, {}];
    };
    parseTemplate = ({ templates, expressions, tokens, index, template }) => {
      if (template === void 0) {
        throw new TypeError(`Invalid backslash sequence: ${templates.raw[index]}`);
      }
      const { nextTokens, leadingWhitespaces, trailingWhitespaces } = splitByWhitespaces(template, templates.raw[index]);
      const newTokens = concatTokens(tokens, nextTokens, leadingWhitespaces);
      if (index === expressions.length) {
        return newTokens;
      }
      const expression = expressions[index];
      const expressionTokens = Array.isArray(expression) ? expression.map((expression2) => parseExpression(expression2)) : [parseExpression(expression)];
      return concatTokens(newTokens, expressionTokens, trailingWhitespaces);
    };
    splitByWhitespaces = (template, rawTemplate) => {
      if (rawTemplate.length === 0) {
        return { nextTokens: [], leadingWhitespaces: false, trailingWhitespaces: false };
      }
      const nextTokens = [];
      let templateStart = 0;
      const leadingWhitespaces = DELIMITERS.has(rawTemplate[0]);
      for (let templateIndex = 0, rawIndex = 0; templateIndex < template.length; templateIndex += 1, rawIndex += 1) {
        const rawCharacter = rawTemplate[rawIndex];
        if (DELIMITERS.has(rawCharacter)) {
          if (templateStart !== templateIndex) {
            nextTokens.push(template.slice(templateStart, templateIndex));
          }
          templateStart = templateIndex + 1;
        } else if (rawCharacter === "\\") {
          const nextRawCharacter = rawTemplate[rawIndex + 1];
          if (nextRawCharacter === "\n") {
            templateIndex -= 1;
            rawIndex += 1;
          } else if (nextRawCharacter === "u" && rawTemplate[rawIndex + 2] === "{") {
            rawIndex = rawTemplate.indexOf("}", rawIndex + 3);
          } else {
            rawIndex += ESCAPE_LENGTH[nextRawCharacter] ?? 1;
          }
        }
      }
      const trailingWhitespaces = templateStart === template.length;
      if (!trailingWhitespaces) {
        nextTokens.push(template.slice(templateStart));
      }
      return { nextTokens, leadingWhitespaces, trailingWhitespaces };
    };
    DELIMITERS = /* @__PURE__ */ new Set([" ", "	", "\r", "\n"]);
    ESCAPE_LENGTH = { x: 3, u: 5 };
    concatTokens = (tokens, nextTokens, isSeparated) => isSeparated || tokens.length === 0 || nextTokens.length === 0 ? [...tokens, ...nextTokens] : [
      ...tokens.slice(0, -1),
      `${tokens.at(-1)}${nextTokens[0]}`,
      ...nextTokens.slice(1)
    ];
    parseExpression = (expression) => {
      const typeOfExpression = typeof expression;
      if (typeOfExpression === "string") {
        return expression;
      }
      if (typeOfExpression === "number") {
        return String(expression);
      }
      if (isPlainObject(expression) && ("stdout" in expression || "isMaxBuffer" in expression)) {
        return getSubprocessResult(expression);
      }
      if (expression instanceof import_node_child_process3.ChildProcess || Object.prototype.toString.call(expression) === "[object Promise]") {
        throw new TypeError("Unexpected subprocess in template expression. Please use ${await subprocess} instead of ${subprocess}.");
      }
      throw new TypeError(`Unexpected "${typeOfExpression}" in template expression`);
    };
    getSubprocessResult = ({ stdout }) => {
      if (typeof stdout === "string") {
        return stdout;
      }
      if (isUint8Array(stdout)) {
        return uint8ArrayToString(stdout);
      }
      if (stdout === void 0) {
        throw new TypeError(`Missing result.stdout in template expression. This is probably due to the previous subprocess' "stdout" option.`);
      }
      throw new TypeError(`Unexpected "${typeof stdout}" stdout in template expression`);
    };
  }
});

// node_modules/execa/lib/utils/standard-stream.js
var import_node_process, isStandardStream, STANDARD_STREAMS, STANDARD_STREAMS_ALIASES, getStreamName;
var init_standard_stream = __esm({
  "node_modules/execa/lib/utils/standard-stream.js"() {
    import_node_process = __toESM(require("node:process"), 1);
    isStandardStream = (stream) => STANDARD_STREAMS.includes(stream);
    STANDARD_STREAMS = [import_node_process.default.stdin, import_node_process.default.stdout, import_node_process.default.stderr];
    STANDARD_STREAMS_ALIASES = ["stdin", "stdout", "stderr"];
    getStreamName = (fdNumber) => STANDARD_STREAMS_ALIASES[fdNumber] ?? `stdio[${fdNumber}]`;
  }
});

// node_modules/execa/lib/arguments/specific.js
var import_node_util, normalizeFdSpecificOptions, normalizeFdSpecificOption, getStdioLength, normalizeFdSpecificValue, normalizeOptionObject, compareFdName, getFdNameOrder, parseFdName, parseFd, FD_REGEXP, addDefaultValue, verboseDefault, DEFAULT_OPTIONS, FD_SPECIFIC_OPTIONS, getFdSpecificValue;
var init_specific = __esm({
  "node_modules/execa/lib/arguments/specific.js"() {
    import_node_util = require("node:util");
    init_is_plain_obj();
    init_standard_stream();
    normalizeFdSpecificOptions = (options) => {
      const optionsCopy = { ...options };
      for (const optionName of FD_SPECIFIC_OPTIONS) {
        optionsCopy[optionName] = normalizeFdSpecificOption(options, optionName);
      }
      return optionsCopy;
    };
    normalizeFdSpecificOption = (options, optionName) => {
      const optionBaseArray = Array.from({ length: getStdioLength(options) + 1 });
      const optionArray = normalizeFdSpecificValue(options[optionName], optionBaseArray, optionName);
      return addDefaultValue(optionArray, optionName);
    };
    getStdioLength = ({ stdio }) => Array.isArray(stdio) ? Math.max(stdio.length, STANDARD_STREAMS_ALIASES.length) : STANDARD_STREAMS_ALIASES.length;
    normalizeFdSpecificValue = (optionValue, optionArray, optionName) => isPlainObject(optionValue) ? normalizeOptionObject(optionValue, optionArray, optionName) : optionArray.fill(optionValue);
    normalizeOptionObject = (optionValue, optionArray, optionName) => {
      for (const fdName of Object.keys(optionValue).sort(compareFdName)) {
        for (const fdNumber of parseFdName(fdName, optionName, optionArray)) {
          optionArray[fdNumber] = optionValue[fdName];
        }
      }
      return optionArray;
    };
    compareFdName = (fdNameA, fdNameB) => getFdNameOrder(fdNameA) < getFdNameOrder(fdNameB) ? 1 : -1;
    getFdNameOrder = (fdName) => {
      if (fdName === "stdout" || fdName === "stderr") {
        return 0;
      }
      return fdName === "all" ? 2 : 1;
    };
    parseFdName = (fdName, optionName, optionArray) => {
      if (fdName === "ipc") {
        return [optionArray.length - 1];
      }
      const fdNumber = parseFd(fdName);
      if (fdNumber === void 0 || fdNumber === 0) {
        throw new TypeError(`"${optionName}.${fdName}" is invalid.
It must be "${optionName}.stdout", "${optionName}.stderr", "${optionName}.all", "${optionName}.ipc", or "${optionName}.fd3", "${optionName}.fd4" (and so on).`);
      }
      if (fdNumber >= optionArray.length) {
        throw new TypeError(`"${optionName}.${fdName}" is invalid: that file descriptor does not exist.
Please set the "stdio" option to ensure that file descriptor exists.`);
      }
      return fdNumber === "all" ? [1, 2] : [fdNumber];
    };
    parseFd = (fdName) => {
      if (fdName === "all") {
        return fdName;
      }
      if (STANDARD_STREAMS_ALIASES.includes(fdName)) {
        return STANDARD_STREAMS_ALIASES.indexOf(fdName);
      }
      const regexpResult = FD_REGEXP.exec(fdName);
      if (regexpResult !== null) {
        return Number(regexpResult[1]);
      }
    };
    FD_REGEXP = /^fd(\d+)$/;
    addDefaultValue = (optionArray, optionName) => optionArray.map((optionValue) => optionValue === void 0 ? DEFAULT_OPTIONS[optionName] : optionValue);
    verboseDefault = (0, import_node_util.debuglog)("execa").enabled ? "full" : "none";
    DEFAULT_OPTIONS = {
      lines: false,
      buffer: true,
      maxBuffer: 1e3 * 1e3 * 100,
      verbose: verboseDefault,
      stripFinalNewline: true
    };
    FD_SPECIFIC_OPTIONS = ["lines", "buffer", "maxBuffer", "verbose", "stripFinalNewline"];
    getFdSpecificValue = (optionArray, fdNumber) => fdNumber === "ipc" ? optionArray.at(-1) : optionArray[fdNumber];
  }
});

// node_modules/execa/lib/verbose/values.js
var isVerbose, isFullVerbose, getVerboseFunction, getFdVerbose, getFdGenericVerbose, isVerboseFunction, VERBOSE_VALUES;
var init_values = __esm({
  "node_modules/execa/lib/verbose/values.js"() {
    init_specific();
    isVerbose = ({ verbose }, fdNumber) => getFdVerbose(verbose, fdNumber) !== "none";
    isFullVerbose = ({ verbose }, fdNumber) => !["none", "short"].includes(getFdVerbose(verbose, fdNumber));
    getVerboseFunction = ({ verbose }, fdNumber) => {
      const fdVerbose = getFdVerbose(verbose, fdNumber);
      return isVerboseFunction(fdVerbose) ? fdVerbose : void 0;
    };
    getFdVerbose = (verbose, fdNumber) => fdNumber === void 0 ? getFdGenericVerbose(verbose) : getFdSpecificValue(verbose, fdNumber);
    getFdGenericVerbose = (verbose) => verbose.find((fdVerbose) => isVerboseFunction(fdVerbose)) ?? VERBOSE_VALUES.findLast((fdVerbose) => verbose.includes(fdVerbose));
    isVerboseFunction = (fdVerbose) => typeof fdVerbose === "function";
    VERBOSE_VALUES = ["none", "short", "full"];
  }
});

// node_modules/execa/lib/arguments/escape.js
var import_node_process2, import_node_util2, joinCommand, escapeLines, escapeControlCharacters, escapeControlCharacter, getSpecialCharRegExp, SPECIAL_CHAR_REGEXP, COMMON_ESCAPES, ASTRAL_START, quoteString, NO_ESCAPE_REGEXP;
var init_escape = __esm({
  "node_modules/execa/lib/arguments/escape.js"() {
    import_node_process2 = require("node:process");
    import_node_util2 = require("node:util");
    joinCommand = (filePath, rawArguments) => {
      const fileAndArguments = [filePath, ...rawArguments];
      const command = fileAndArguments.join(" ");
      const escapedCommand = fileAndArguments.map((fileAndArgument) => quoteString(escapeControlCharacters(fileAndArgument))).join(" ");
      return { command, escapedCommand };
    };
    escapeLines = (lines) => (0, import_node_util2.stripVTControlCharacters)(lines).split("\n").map((line) => escapeControlCharacters(line)).join("\n");
    escapeControlCharacters = (line) => line.replaceAll(SPECIAL_CHAR_REGEXP, (character) => escapeControlCharacter(character));
    escapeControlCharacter = (character) => {
      const commonEscape = COMMON_ESCAPES[character];
      if (commonEscape !== void 0) {
        return commonEscape;
      }
      const codepoint = character.codePointAt(0);
      const codepointHex = codepoint.toString(16);
      return codepoint <= ASTRAL_START ? `\\u${codepointHex.padStart(4, "0")}` : `\\U${codepointHex}`;
    };
    getSpecialCharRegExp = () => {
      try {
        return new RegExp("\\p{Separator}|\\p{Other}", "gu");
      } catch {
        return /[\s\u0000-\u001F\u007F-\u009F\u00AD]/g;
      }
    };
    SPECIAL_CHAR_REGEXP = getSpecialCharRegExp();
    COMMON_ESCAPES = {
      " ": " ",
      "\b": "\\b",
      "\f": "\\f",
      "\n": "\\n",
      "\r": "\\r",
      "	": "\\t"
    };
    ASTRAL_START = 65535;
    quoteString = (escapedArgument) => {
      if (NO_ESCAPE_REGEXP.test(escapedArgument)) {
        return escapedArgument;
      }
      return import_node_process2.platform === "win32" ? `"${escapedArgument.replaceAll('"', '""')}"` : `'${escapedArgument.replaceAll("'", "'\\''")}'`;
    };
    NO_ESCAPE_REGEXP = /^[\w./-]+$/;
  }
});

// node_modules/is-unicode-supported/index.js
function isUnicodeSupported() {
  const { env } = import_node_process3.default;
  const { TERM, TERM_PROGRAM } = env;
  if (import_node_process3.default.platform !== "win32") {
    return TERM !== "linux";
  }
  return Boolean(env.WT_SESSION) || Boolean(env.TERMINUS_SUBLIME) || env.ConEmuTask === "{cmd::Cmder}" || TERM_PROGRAM === "Terminus-Sublime" || TERM_PROGRAM === "vscode" || TERM === "xterm-256color" || TERM === "alacritty" || TERM === "rxvt-unicode" || TERM === "rxvt-unicode-256color" || env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var import_node_process3;
var init_is_unicode_supported = __esm({
  "node_modules/is-unicode-supported/index.js"() {
    import_node_process3 = __toESM(require("node:process"), 1);
  }
});

// node_modules/figures/index.js
var common, specialMainSymbols, specialFallbackSymbols, mainSymbols, fallbackSymbols, shouldUseMain, figures, figures_default, replacements;
var init_figures = __esm({
  "node_modules/figures/index.js"() {
    init_is_unicode_supported();
    common = {
      circleQuestionMark: "(?)",
      questionMarkPrefix: "(?)",
      square: "\u2588",
      squareDarkShade: "\u2593",
      squareMediumShade: "\u2592",
      squareLightShade: "\u2591",
      squareTop: "\u2580",
      squareBottom: "\u2584",
      squareLeft: "\u258C",
      squareRight: "\u2590",
      squareCenter: "\u25A0",
      bullet: "\u25CF",
      dot: "\u2024",
      ellipsis: "\u2026",
      pointerSmall: "\u203A",
      triangleUp: "\u25B2",
      triangleUpSmall: "\u25B4",
      triangleDown: "\u25BC",
      triangleDownSmall: "\u25BE",
      triangleLeftSmall: "\u25C2",
      triangleRightSmall: "\u25B8",
      home: "\u2302",
      heart: "\u2665",
      musicNote: "\u266A",
      musicNoteBeamed: "\u266B",
      arrowUp: "\u2191",
      arrowDown: "\u2193",
      arrowLeft: "\u2190",
      arrowRight: "\u2192",
      arrowLeftRight: "\u2194",
      arrowUpDown: "\u2195",
      almostEqual: "\u2248",
      notEqual: "\u2260",
      lessOrEqual: "\u2264",
      greaterOrEqual: "\u2265",
      identical: "\u2261",
      infinity: "\u221E",
      subscriptZero: "\u2080",
      subscriptOne: "\u2081",
      subscriptTwo: "\u2082",
      subscriptThree: "\u2083",
      subscriptFour: "\u2084",
      subscriptFive: "\u2085",
      subscriptSix: "\u2086",
      subscriptSeven: "\u2087",
      subscriptEight: "\u2088",
      subscriptNine: "\u2089",
      oneHalf: "\xBD",
      oneThird: "\u2153",
      oneQuarter: "\xBC",
      oneFifth: "\u2155",
      oneSixth: "\u2159",
      oneEighth: "\u215B",
      twoThirds: "\u2154",
      twoFifths: "\u2156",
      threeQuarters: "\xBE",
      threeFifths: "\u2157",
      threeEighths: "\u215C",
      fourFifths: "\u2158",
      fiveSixths: "\u215A",
      fiveEighths: "\u215D",
      sevenEighths: "\u215E",
      line: "\u2500",
      lineBold: "\u2501",
      lineDouble: "\u2550",
      lineDashed0: "\u2504",
      lineDashed1: "\u2505",
      lineDashed2: "\u2508",
      lineDashed3: "\u2509",
      lineDashed4: "\u254C",
      lineDashed5: "\u254D",
      lineDashed6: "\u2574",
      lineDashed7: "\u2576",
      lineDashed8: "\u2578",
      lineDashed9: "\u257A",
      lineDashed10: "\u257C",
      lineDashed11: "\u257E",
      lineDashed12: "\u2212",
      lineDashed13: "\u2013",
      lineDashed14: "\u2010",
      lineDashed15: "\u2043",
      lineVertical: "\u2502",
      lineVerticalBold: "\u2503",
      lineVerticalDouble: "\u2551",
      lineVerticalDashed0: "\u2506",
      lineVerticalDashed1: "\u2507",
      lineVerticalDashed2: "\u250A",
      lineVerticalDashed3: "\u250B",
      lineVerticalDashed4: "\u254E",
      lineVerticalDashed5: "\u254F",
      lineVerticalDashed6: "\u2575",
      lineVerticalDashed7: "\u2577",
      lineVerticalDashed8: "\u2579",
      lineVerticalDashed9: "\u257B",
      lineVerticalDashed10: "\u257D",
      lineVerticalDashed11: "\u257F",
      lineDownLeft: "\u2510",
      lineDownLeftArc: "\u256E",
      lineDownBoldLeftBold: "\u2513",
      lineDownBoldLeft: "\u2512",
      lineDownLeftBold: "\u2511",
      lineDownDoubleLeftDouble: "\u2557",
      lineDownDoubleLeft: "\u2556",
      lineDownLeftDouble: "\u2555",
      lineDownRight: "\u250C",
      lineDownRightArc: "\u256D",
      lineDownBoldRightBold: "\u250F",
      lineDownBoldRight: "\u250E",
      lineDownRightBold: "\u250D",
      lineDownDoubleRightDouble: "\u2554",
      lineDownDoubleRight: "\u2553",
      lineDownRightDouble: "\u2552",
      lineUpLeft: "\u2518",
      lineUpLeftArc: "\u256F",
      lineUpBoldLeftBold: "\u251B",
      lineUpBoldLeft: "\u251A",
      lineUpLeftBold: "\u2519",
      lineUpDoubleLeftDouble: "\u255D",
      lineUpDoubleLeft: "\u255C",
      lineUpLeftDouble: "\u255B",
      lineUpRight: "\u2514",
      lineUpRightArc: "\u2570",
      lineUpBoldRightBold: "\u2517",
      lineUpBoldRight: "\u2516",
      lineUpRightBold: "\u2515",
      lineUpDoubleRightDouble: "\u255A",
      lineUpDoubleRight: "\u2559",
      lineUpRightDouble: "\u2558",
      lineUpDownLeft: "\u2524",
      lineUpBoldDownBoldLeftBold: "\u252B",
      lineUpBoldDownBoldLeft: "\u2528",
      lineUpDownLeftBold: "\u2525",
      lineUpBoldDownLeftBold: "\u2529",
      lineUpDownBoldLeftBold: "\u252A",
      lineUpDownBoldLeft: "\u2527",
      lineUpBoldDownLeft: "\u2526",
      lineUpDoubleDownDoubleLeftDouble: "\u2563",
      lineUpDoubleDownDoubleLeft: "\u2562",
      lineUpDownLeftDouble: "\u2561",
      lineUpDownRight: "\u251C",
      lineUpBoldDownBoldRightBold: "\u2523",
      lineUpBoldDownBoldRight: "\u2520",
      lineUpDownRightBold: "\u251D",
      lineUpBoldDownRightBold: "\u2521",
      lineUpDownBoldRightBold: "\u2522",
      lineUpDownBoldRight: "\u251F",
      lineUpBoldDownRight: "\u251E",
      lineUpDoubleDownDoubleRightDouble: "\u2560",
      lineUpDoubleDownDoubleRight: "\u255F",
      lineUpDownRightDouble: "\u255E",
      lineDownLeftRight: "\u252C",
      lineDownBoldLeftBoldRightBold: "\u2533",
      lineDownLeftBoldRightBold: "\u252F",
      lineDownBoldLeftRight: "\u2530",
      lineDownBoldLeftBoldRight: "\u2531",
      lineDownBoldLeftRightBold: "\u2532",
      lineDownLeftRightBold: "\u252E",
      lineDownLeftBoldRight: "\u252D",
      lineDownDoubleLeftDoubleRightDouble: "\u2566",
      lineDownDoubleLeftRight: "\u2565",
      lineDownLeftDoubleRightDouble: "\u2564",
      lineUpLeftRight: "\u2534",
      lineUpBoldLeftBoldRightBold: "\u253B",
      lineUpLeftBoldRightBold: "\u2537",
      lineUpBoldLeftRight: "\u2538",
      lineUpBoldLeftBoldRight: "\u2539",
      lineUpBoldLeftRightBold: "\u253A",
      lineUpLeftRightBold: "\u2536",
      lineUpLeftBoldRight: "\u2535",
      lineUpDoubleLeftDoubleRightDouble: "\u2569",
      lineUpDoubleLeftRight: "\u2568",
      lineUpLeftDoubleRightDouble: "\u2567",
      lineUpDownLeftRight: "\u253C",
      lineUpBoldDownBoldLeftBoldRightBold: "\u254B",
      lineUpDownBoldLeftBoldRightBold: "\u2548",
      lineUpBoldDownLeftBoldRightBold: "\u2547",
      lineUpBoldDownBoldLeftRightBold: "\u254A",
      lineUpBoldDownBoldLeftBoldRight: "\u2549",
      lineUpBoldDownLeftRight: "\u2540",
      lineUpDownBoldLeftRight: "\u2541",
      lineUpDownLeftBoldRight: "\u253D",
      lineUpDownLeftRightBold: "\u253E",
      lineUpBoldDownBoldLeftRight: "\u2542",
      lineUpDownLeftBoldRightBold: "\u253F",
      lineUpBoldDownLeftBoldRight: "\u2543",
      lineUpBoldDownLeftRightBold: "\u2544",
      lineUpDownBoldLeftBoldRight: "\u2545",
      lineUpDownBoldLeftRightBold: "\u2546",
      lineUpDoubleDownDoubleLeftDoubleRightDouble: "\u256C",
      lineUpDoubleDownDoubleLeftRight: "\u256B",
      lineUpDownLeftDoubleRightDouble: "\u256A",
      lineCross: "\u2573",
      lineBackslash: "\u2572",
      lineSlash: "\u2571"
    };
    specialMainSymbols = {
      tick: "\u2714",
      info: "\u2139",
      warning: "\u26A0",
      cross: "\u2718",
      squareSmall: "\u25FB",
      squareSmallFilled: "\u25FC",
      circle: "\u25EF",
      circleFilled: "\u25C9",
      circleDotted: "\u25CC",
      circleDouble: "\u25CE",
      circleCircle: "\u24DE",
      circleCross: "\u24E7",
      circlePipe: "\u24BE",
      radioOn: "\u25C9",
      radioOff: "\u25EF",
      checkboxOn: "\u2612",
      checkboxOff: "\u2610",
      checkboxCircleOn: "\u24E7",
      checkboxCircleOff: "\u24BE",
      pointer: "\u276F",
      triangleUpOutline: "\u25B3",
      triangleLeft: "\u25C0",
      triangleRight: "\u25B6",
      lozenge: "\u25C6",
      lozengeOutline: "\u25C7",
      hamburger: "\u2630",
      smiley: "\u32E1",
      mustache: "\u0DF4",
      star: "\u2605",
      play: "\u25B6",
      nodejs: "\u2B22",
      oneSeventh: "\u2150",
      oneNinth: "\u2151",
      oneTenth: "\u2152"
    };
    specialFallbackSymbols = {
      tick: "\u221A",
      info: "i",
      warning: "\u203C",
      cross: "\xD7",
      squareSmall: "\u25A1",
      squareSmallFilled: "\u25A0",
      circle: "( )",
      circleFilled: "(*)",
      circleDotted: "( )",
      circleDouble: "( )",
      circleCircle: "(\u25CB)",
      circleCross: "(\xD7)",
      circlePipe: "(\u2502)",
      radioOn: "(*)",
      radioOff: "( )",
      checkboxOn: "[\xD7]",
      checkboxOff: "[ ]",
      checkboxCircleOn: "(\xD7)",
      checkboxCircleOff: "( )",
      pointer: ">",
      triangleUpOutline: "\u2206",
      triangleLeft: "\u25C4",
      triangleRight: "\u25BA",
      lozenge: "\u2666",
      lozengeOutline: "\u25CA",
      hamburger: "\u2261",
      smiley: "\u263A",
      mustache: "\u250C\u2500\u2510",
      star: "\u2736",
      play: "\u25BA",
      nodejs: "\u2666",
      oneSeventh: "1/7",
      oneNinth: "1/9",
      oneTenth: "1/10"
    };
    mainSymbols = { ...common, ...specialMainSymbols };
    fallbackSymbols = { ...common, ...specialFallbackSymbols };
    shouldUseMain = isUnicodeSupported();
    figures = shouldUseMain ? mainSymbols : fallbackSymbols;
    figures_default = figures;
    replacements = Object.entries(specialMainSymbols);
  }
});

// node_modules/yoctocolors/base.js
var import_node_tty, hasColors, format, reset, bold, dim, italic, underline, overline, inverse, hidden, strikethrough, black, red, green, yellow, blue, magenta, cyan, white, gray, bgBlack, bgRed, bgGreen, bgYellow, bgBlue, bgMagenta, bgCyan, bgWhite, bgGray, redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright, whiteBright, bgRedBright, bgGreenBright, bgYellowBright, bgBlueBright, bgMagentaBright, bgCyanBright, bgWhiteBright;
var init_base = __esm({
  "node_modules/yoctocolors/base.js"() {
    import_node_tty = __toESM(require("node:tty"), 1);
    hasColors = import_node_tty.default?.WriteStream?.prototype?.hasColors?.() ?? false;
    format = (open, close) => {
      if (!hasColors) {
        return (input) => input;
      }
      const openCode = `\x1B[${open}m`;
      const closeCode = `\x1B[${close}m`;
      return (input) => {
        const string = input + "";
        let index = string.indexOf(closeCode);
        if (index === -1) {
          return openCode + string + closeCode;
        }
        let result = openCode;
        let lastIndex = 0;
        const reopenOnNestedClose = close === 22;
        const replaceCode = (reopenOnNestedClose ? closeCode : "") + openCode;
        while (index !== -1) {
          result += string.slice(lastIndex, index) + replaceCode;
          lastIndex = index + closeCode.length;
          index = string.indexOf(closeCode, lastIndex);
        }
        result += string.slice(lastIndex) + closeCode;
        return result;
      };
    };
    reset = format(0, 0);
    bold = format(1, 22);
    dim = format(2, 22);
    italic = format(3, 23);
    underline = format(4, 24);
    overline = format(53, 55);
    inverse = format(7, 27);
    hidden = format(8, 28);
    strikethrough = format(9, 29);
    black = format(30, 39);
    red = format(31, 39);
    green = format(32, 39);
    yellow = format(33, 39);
    blue = format(34, 39);
    magenta = format(35, 39);
    cyan = format(36, 39);
    white = format(37, 39);
    gray = format(90, 39);
    bgBlack = format(40, 49);
    bgRed = format(41, 49);
    bgGreen = format(42, 49);
    bgYellow = format(43, 49);
    bgBlue = format(44, 49);
    bgMagenta = format(45, 49);
    bgCyan = format(46, 49);
    bgWhite = format(47, 49);
    bgGray = format(100, 49);
    redBright = format(91, 39);
    greenBright = format(92, 39);
    yellowBright = format(93, 39);
    blueBright = format(94, 39);
    magentaBright = format(95, 39);
    cyanBright = format(96, 39);
    whiteBright = format(97, 39);
    bgRedBright = format(101, 49);
    bgGreenBright = format(102, 49);
    bgYellowBright = format(103, 49);
    bgBlueBright = format(104, 49);
    bgMagentaBright = format(105, 49);
    bgCyanBright = format(106, 49);
    bgWhiteBright = format(107, 49);
  }
});

// node_modules/yoctocolors/index.js
var init_yoctocolors = __esm({
  "node_modules/yoctocolors/index.js"() {
    init_base();
    init_base();
  }
});

// node_modules/execa/lib/verbose/default.js
var defaultVerboseFunction, serializeTimestamp, padField, getFinalIcon, ICONS, identity, COLORS;
var init_default = __esm({
  "node_modules/execa/lib/verbose/default.js"() {
    init_figures();
    init_yoctocolors();
    defaultVerboseFunction = ({
      type,
      message,
      timestamp,
      piped,
      commandId,
      result: { failed = false } = {},
      options: { reject = true }
    }) => {
      const timestampString = serializeTimestamp(timestamp);
      const icon = ICONS[type]({ failed, reject, piped });
      const color = COLORS[type]({ reject });
      return `${gray(`[${timestampString}]`)} ${gray(`[${commandId}]`)} ${color(icon)} ${color(message)}`;
    };
    serializeTimestamp = (timestamp) => `${padField(timestamp.getHours(), 2)}:${padField(timestamp.getMinutes(), 2)}:${padField(timestamp.getSeconds(), 2)}.${padField(timestamp.getMilliseconds(), 3)}`;
    padField = (field, padding) => String(field).padStart(padding, "0");
    getFinalIcon = ({ failed, reject }) => {
      if (!failed) {
        return figures_default.tick;
      }
      return reject ? figures_default.cross : figures_default.warning;
    };
    ICONS = {
      command: ({ piped }) => piped ? "|" : "$",
      output: () => " ",
      ipc: () => "*",
      error: getFinalIcon,
      duration: getFinalIcon
    };
    identity = (string) => string;
    COLORS = {
      command: () => bold,
      output: () => identity,
      ipc: () => identity,
      error: ({ reject }) => reject ? redBright : yellowBright,
      duration: () => gray
    };
  }
});

// node_modules/execa/lib/verbose/custom.js
var applyVerboseOnLines, applyVerboseFunction, appendNewline;
var init_custom = __esm({
  "node_modules/execa/lib/verbose/custom.js"() {
    init_values();
    applyVerboseOnLines = (printedLines, verboseInfo, fdNumber) => {
      const verboseFunction = getVerboseFunction(verboseInfo, fdNumber);
      return printedLines.map(({ verboseLine, verboseObject }) => applyVerboseFunction(verboseLine, verboseObject, verboseFunction)).filter((printedLine) => printedLine !== void 0).map((printedLine) => appendNewline(printedLine)).join("");
    };
    applyVerboseFunction = (verboseLine, verboseObject, verboseFunction) => {
      if (verboseFunction === void 0) {
        return verboseLine;
      }
      const printedLine = verboseFunction(verboseLine, verboseObject);
      if (typeof printedLine === "string") {
        return printedLine;
      }
    };
    appendNewline = (printedLine) => printedLine.endsWith("\n") ? printedLine : `${printedLine}
`;
  }
});

// node_modules/execa/lib/verbose/log.js
var import_node_util3, verboseLog, getVerboseObject, getPrintedLines, getPrintedLine, serializeVerboseMessage, TAB_SIZE;
var init_log2 = __esm({
  "node_modules/execa/lib/verbose/log.js"() {
    import_node_util3 = require("node:util");
    init_escape();
    init_default();
    init_custom();
    verboseLog = ({ type, verboseMessage, fdNumber, verboseInfo, result }) => {
      const verboseObject = getVerboseObject({ type, result, verboseInfo });
      const printedLines = getPrintedLines(verboseMessage, verboseObject);
      const finalLines = applyVerboseOnLines(printedLines, verboseInfo, fdNumber);
      if (finalLines !== "") {
        console.warn(finalLines.slice(0, -1));
      }
    };
    getVerboseObject = ({
      type,
      result,
      verboseInfo: { escapedCommand, commandId, rawOptions: { piped = false, ...options } }
    }) => ({
      type,
      escapedCommand,
      commandId: `${commandId}`,
      timestamp: /* @__PURE__ */ new Date(),
      piped,
      result,
      options
    });
    getPrintedLines = (verboseMessage, verboseObject) => verboseMessage.split("\n").map((message) => getPrintedLine({ ...verboseObject, message }));
    getPrintedLine = (verboseObject) => {
      const verboseLine = defaultVerboseFunction(verboseObject);
      return { verboseLine, verboseObject };
    };
    serializeVerboseMessage = (message) => {
      const messageString = typeof message === "string" ? message : (0, import_node_util3.inspect)(message);
      const escapedMessage = escapeLines(messageString);
      return escapedMessage.replaceAll("	", " ".repeat(TAB_SIZE));
    };
    TAB_SIZE = 2;
  }
});

// node_modules/execa/lib/verbose/start.js
var logCommand;
var init_start = __esm({
  "node_modules/execa/lib/verbose/start.js"() {
    init_values();
    init_log2();
    logCommand = (escapedCommand, verboseInfo) => {
      if (!isVerbose(verboseInfo)) {
        return;
      }
      verboseLog({
        type: "command",
        verboseMessage: escapedCommand,
        verboseInfo
      });
    };
  }
});

// node_modules/execa/lib/verbose/info.js
var getVerboseInfo, getCommandId, COMMAND_ID, validateVerbose;
var init_info = __esm({
  "node_modules/execa/lib/verbose/info.js"() {
    init_values();
    getVerboseInfo = (verbose, escapedCommand, rawOptions) => {
      validateVerbose(verbose);
      const commandId = getCommandId(verbose);
      return {
        verbose,
        escapedCommand,
        commandId,
        rawOptions
      };
    };
    getCommandId = (verbose) => isVerbose({ verbose }) ? COMMAND_ID++ : void 0;
    COMMAND_ID = 0n;
    validateVerbose = (verbose) => {
      for (const fdVerbose of verbose) {
        if (fdVerbose === false) {
          throw new TypeError(`The "verbose: false" option was renamed to "verbose: 'none'".`);
        }
        if (fdVerbose === true) {
          throw new TypeError(`The "verbose: true" option was renamed to "verbose: 'short'".`);
        }
        if (!VERBOSE_VALUES.includes(fdVerbose) && !isVerboseFunction(fdVerbose)) {
          const allowedValues = VERBOSE_VALUES.map((allowedValue) => `'${allowedValue}'`).join(", ");
          throw new TypeError(`The "verbose" option must not be ${fdVerbose}. Allowed values are: ${allowedValues} or a function.`);
        }
      }
    };
  }
});

// node_modules/execa/lib/return/duration.js
var import_node_process4, getStartTime, getDurationMs;
var init_duration = __esm({
  "node_modules/execa/lib/return/duration.js"() {
    import_node_process4 = require("node:process");
    getStartTime = () => import_node_process4.hrtime.bigint();
    getDurationMs = (startTime) => Number(import_node_process4.hrtime.bigint() - startTime) / 1e6;
  }
});

// node_modules/execa/lib/arguments/command.js
var handleCommand;
var init_command = __esm({
  "node_modules/execa/lib/arguments/command.js"() {
    init_start();
    init_info();
    init_duration();
    init_escape();
    init_specific();
    handleCommand = (filePath, rawArguments, rawOptions) => {
      const startTime = getStartTime();
      const { command, escapedCommand } = joinCommand(filePath, rawArguments);
      const verbose = normalizeFdSpecificOption(rawOptions, "verbose");
      const verboseInfo = getVerboseInfo(verbose, escapedCommand, { ...rawOptions });
      logCommand(escapedCommand, verboseInfo);
      return {
        command,
        escapedCommand,
        startTime,
        verboseInfo
      };
    };
  }
});

// node_modules/isexe/windows.js
var require_windows = __commonJS({
  "node_modules/isexe/windows.js"(exports2, module2) {
    module2.exports = isexe;
    isexe.sync = sync;
    var fs = require("fs");
    function checkPathExt(path6, options) {
      var pathext = options.pathExt !== void 0 ? options.pathExt : process.env.PATHEXT;
      if (!pathext) {
        return true;
      }
      pathext = pathext.split(";");
      if (pathext.indexOf("") !== -1) {
        return true;
      }
      for (var i2 = 0; i2 < pathext.length; i2++) {
        var p = pathext[i2].toLowerCase();
        if (p && path6.substr(-p.length).toLowerCase() === p) {
          return true;
        }
      }
      return false;
    }
    function checkStat(stat, path6, options) {
      if (!stat.isSymbolicLink() && !stat.isFile()) {
        return false;
      }
      return checkPathExt(path6, options);
    }
    function isexe(path6, options, cb) {
      fs.stat(path6, function(er, stat) {
        cb(er, er ? false : checkStat(stat, path6, options));
      });
    }
    function sync(path6, options) {
      return checkStat(fs.statSync(path6), path6, options);
    }
  }
});

// node_modules/isexe/mode.js
var require_mode = __commonJS({
  "node_modules/isexe/mode.js"(exports2, module2) {
    module2.exports = isexe;
    isexe.sync = sync;
    var fs = require("fs");
    function isexe(path6, options, cb) {
      fs.stat(path6, function(er, stat) {
        cb(er, er ? false : checkStat(stat, options));
      });
    }
    function sync(path6, options) {
      return checkStat(fs.statSync(path6), options);
    }
    function checkStat(stat, options) {
      return stat.isFile() && checkMode(stat, options);
    }
    function checkMode(stat, options) {
      var mod = stat.mode;
      var uid = stat.uid;
      var gid = stat.gid;
      var myUid = options.uid !== void 0 ? options.uid : process.getuid && process.getuid();
      var myGid = options.gid !== void 0 ? options.gid : process.getgid && process.getgid();
      var u2 = parseInt("100", 8);
      var g = parseInt("010", 8);
      var o2 = parseInt("001", 8);
      var ug = u2 | g;
      var ret = mod & o2 || mod & g && gid === myGid || mod & u2 && uid === myUid || mod & ug && myUid === 0;
      return ret;
    }
  }
});

// node_modules/isexe/index.js
var require_isexe = __commonJS({
  "node_modules/isexe/index.js"(exports2, module2) {
    var fs = require("fs");
    var core;
    if (process.platform === "win32" || global.TESTING_WINDOWS) {
      core = require_windows();
    } else {
      core = require_mode();
    }
    module2.exports = isexe;
    isexe.sync = sync;
    function isexe(path6, options, cb) {
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      if (!cb) {
        if (typeof Promise !== "function") {
          throw new TypeError("callback not provided");
        }
        return new Promise(function(resolve, reject) {
          isexe(path6, options || {}, function(er, is) {
            if (er) {
              reject(er);
            } else {
              resolve(is);
            }
          });
        });
      }
      core(path6, options || {}, function(er, is) {
        if (er) {
          if (er.code === "EACCES" || options && options.ignoreErrors) {
            er = null;
            is = false;
          }
        }
        cb(er, is);
      });
    }
    function sync(path6, options) {
      try {
        return core.sync(path6, options || {});
      } catch (er) {
        if (options && options.ignoreErrors || er.code === "EACCES") {
          return false;
        } else {
          throw er;
        }
      }
    }
  }
});

// node_modules/which/which.js
var require_which = __commonJS({
  "node_modules/which/which.js"(exports2, module2) {
    var isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
    var path6 = require("path");
    var COLON = isWindows ? ";" : ":";
    var isexe = require_isexe();
    var getNotFoundError = (cmd) => Object.assign(new Error(`not found: ${cmd}`), { code: "ENOENT" });
    var getPathInfo = (cmd, opt) => {
      const colon = opt.colon || COLON;
      const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [
        // windows always checks the cwd first
        ...isWindows ? [process.cwd()] : [],
        ...(opt.path || process.env.PATH || /* istanbul ignore next: very unusual */
        "").split(colon)
      ];
      const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
      const pathExt = isWindows ? pathExtExe.split(colon) : [""];
      if (isWindows) {
        if (cmd.indexOf(".") !== -1 && pathExt[0] !== "")
          pathExt.unshift("");
      }
      return {
        pathEnv,
        pathExt,
        pathExtExe
      };
    };
    var which = (cmd, opt, cb) => {
      if (typeof opt === "function") {
        cb = opt;
        opt = {};
      }
      if (!opt)
        opt = {};
      const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
      const found = [];
      const step = (i2) => new Promise((resolve, reject) => {
        if (i2 === pathEnv.length)
          return opt.all && found.length ? resolve(found) : reject(getNotFoundError(cmd));
        const ppRaw = pathEnv[i2];
        const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
        const pCmd = path6.join(pathPart, cmd);
        const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
        resolve(subStep(p, i2, 0));
      });
      const subStep = (p, i2, ii) => new Promise((resolve, reject) => {
        if (ii === pathExt.length)
          return resolve(step(i2 + 1));
        const ext = pathExt[ii];
        isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
          if (!er && is) {
            if (opt.all)
              found.push(p + ext);
            else
              return resolve(p + ext);
          }
          return resolve(subStep(p, i2, ii + 1));
        });
      });
      return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
    };
    var whichSync = (cmd, opt) => {
      opt = opt || {};
      const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
      const found = [];
      for (let i2 = 0; i2 < pathEnv.length; i2++) {
        const ppRaw = pathEnv[i2];
        const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
        const pCmd = path6.join(pathPart, cmd);
        const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
        for (let j = 0; j < pathExt.length; j++) {
          const cur = p + pathExt[j];
          try {
            const is = isexe.sync(cur, { pathExt: pathExtExe });
            if (is) {
              if (opt.all)
                found.push(cur);
              else
                return cur;
            }
          } catch (ex) {
          }
        }
      }
      if (opt.all && found.length)
        return found;
      if (opt.nothrow)
        return null;
      throw getNotFoundError(cmd);
    };
    module2.exports = which;
    which.sync = whichSync;
  }
});

// node_modules/path-key/index.js
var require_path_key = __commonJS({
  "node_modules/path-key/index.js"(exports2, module2) {
    "use strict";
    var pathKey2 = (options = {}) => {
      const environment = options.env || process.env;
      const platform2 = options.platform || process.platform;
      if (platform2 !== "win32") {
        return "PATH";
      }
      return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
    };
    module2.exports = pathKey2;
    module2.exports.default = pathKey2;
  }
});

// node_modules/cross-spawn/lib/util/resolveCommand.js
var require_resolveCommand = __commonJS({
  "node_modules/cross-spawn/lib/util/resolveCommand.js"(exports2, module2) {
    "use strict";
    var path6 = require("path");
    var which = require_which();
    var getPathKey = require_path_key();
    function resolveCommandAttempt(parsed, withoutPathExt) {
      const env = parsed.options.env || process.env;
      const cwd = process.cwd();
      const hasCustomCwd = parsed.options.cwd != null;
      const shouldSwitchCwd = hasCustomCwd && process.chdir !== void 0 && !process.chdir.disabled;
      if (shouldSwitchCwd) {
        try {
          process.chdir(parsed.options.cwd);
        } catch (err) {
        }
      }
      let resolved;
      try {
        resolved = which.sync(parsed.command, {
          path: env[getPathKey({ env })],
          pathExt: withoutPathExt ? path6.delimiter : void 0
        });
      } catch (e) {
      } finally {
        if (shouldSwitchCwd) {
          process.chdir(cwd);
        }
      }
      if (resolved) {
        resolved = path6.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
      }
      return resolved;
    }
    function resolveCommand(parsed) {
      return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
    }
    module2.exports = resolveCommand;
  }
});

// node_modules/cross-spawn/lib/util/escape.js
var require_escape = __commonJS({
  "node_modules/cross-spawn/lib/util/escape.js"(exports2, module2) {
    "use strict";
    var metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
    function escapeCommand(arg) {
      arg = arg.replace(metaCharsRegExp, "^$1");
      return arg;
    }
    function escapeArgument(arg, doubleEscapeMetaChars) {
      arg = `${arg}`;
      arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
      arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
      arg = `"${arg}"`;
      arg = arg.replace(metaCharsRegExp, "^$1");
      if (doubleEscapeMetaChars) {
        arg = arg.replace(metaCharsRegExp, "^$1");
      }
      return arg;
    }
    module2.exports.command = escapeCommand;
    module2.exports.argument = escapeArgument;
  }
});

// node_modules/shebang-regex/index.js
var require_shebang_regex = __commonJS({
  "node_modules/shebang-regex/index.js"(exports2, module2) {
    "use strict";
    module2.exports = /^#!(.*)/;
  }
});

// node_modules/shebang-command/index.js
var require_shebang_command = __commonJS({
  "node_modules/shebang-command/index.js"(exports2, module2) {
    "use strict";
    var shebangRegex = require_shebang_regex();
    module2.exports = (string = "") => {
      const match = string.match(shebangRegex);
      if (!match) {
        return null;
      }
      const [path6, argument] = match[0].replace(/#! ?/, "").split(" ");
      const binary = path6.split("/").pop();
      if (binary === "env") {
        return argument;
      }
      return argument ? `${binary} ${argument}` : binary;
    };
  }
});

// node_modules/cross-spawn/lib/util/readShebang.js
var require_readShebang = __commonJS({
  "node_modules/cross-spawn/lib/util/readShebang.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var shebangCommand = require_shebang_command();
    function readShebang(command) {
      const size = 150;
      const buffer = Buffer.alloc(size);
      let fd;
      try {
        fd = fs.openSync(command, "r");
        fs.readSync(fd, buffer, 0, size, 0);
        fs.closeSync(fd);
      } catch (e) {
      }
      return shebangCommand(buffer.toString());
    }
    module2.exports = readShebang;
  }
});

// node_modules/cross-spawn/lib/parse.js
var require_parse = __commonJS({
  "node_modules/cross-spawn/lib/parse.js"(exports2, module2) {
    "use strict";
    var path6 = require("path");
    var resolveCommand = require_resolveCommand();
    var escape = require_escape();
    var readShebang = require_readShebang();
    var isWin = process.platform === "win32";
    var isExecutableRegExp = /\.(?:com|exe)$/i;
    var isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
    function detectShebang(parsed) {
      parsed.file = resolveCommand(parsed);
      const shebang = parsed.file && readShebang(parsed.file);
      if (shebang) {
        parsed.args.unshift(parsed.file);
        parsed.command = shebang;
        return resolveCommand(parsed);
      }
      return parsed.file;
    }
    function parseNonShell(parsed) {
      if (!isWin) {
        return parsed;
      }
      const commandFile = detectShebang(parsed);
      const needsShell = !isExecutableRegExp.test(commandFile);
      if (parsed.options.forceShell || needsShell) {
        const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
        parsed.command = path6.normalize(parsed.command);
        parsed.command = escape.command(parsed.command);
        parsed.args = parsed.args.map((arg) => escape.argument(arg, needsDoubleEscapeMetaChars));
        const shellCommand = [parsed.command].concat(parsed.args).join(" ");
        parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
        parsed.command = process.env.comspec || "cmd.exe";
        parsed.options.windowsVerbatimArguments = true;
      }
      return parsed;
    }
    function parse3(command, args, options) {
      if (args && !Array.isArray(args)) {
        options = args;
        args = null;
      }
      args = args ? args.slice(0) : [];
      options = Object.assign({}, options);
      const parsed = {
        command,
        args,
        options,
        file: void 0,
        original: {
          command,
          args
        }
      };
      return options.shell ? parsed : parseNonShell(parsed);
    }
    module2.exports = parse3;
  }
});

// node_modules/cross-spawn/lib/enoent.js
var require_enoent = __commonJS({
  "node_modules/cross-spawn/lib/enoent.js"(exports2, module2) {
    "use strict";
    var isWin = process.platform === "win32";
    function notFoundError(original, syscall) {
      return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
        code: "ENOENT",
        errno: "ENOENT",
        syscall: `${syscall} ${original.command}`,
        path: original.command,
        spawnargs: original.args
      });
    }
    function hookChildProcess(cp, parsed) {
      if (!isWin) {
        return;
      }
      const originalEmit = cp.emit;
      cp.emit = function(name, arg1) {
        if (name === "exit") {
          const err = verifyENOENT(arg1, parsed);
          if (err) {
            return originalEmit.call(cp, "error", err);
          }
        }
        return originalEmit.apply(cp, arguments);
      };
    }
    function verifyENOENT(status, parsed) {
      if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, "spawn");
      }
      return null;
    }
    function verifyENOENTSync(status, parsed) {
      if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, "spawnSync");
      }
      return null;
    }
    module2.exports = {
      hookChildProcess,
      verifyENOENT,
      verifyENOENTSync,
      notFoundError
    };
  }
});

// node_modules/cross-spawn/index.js
var require_cross_spawn = __commonJS({
  "node_modules/cross-spawn/index.js"(exports2, module2) {
    "use strict";
    var cp = require("child_process");
    var parse3 = require_parse();
    var enoent = require_enoent();
    function spawn2(command, args, options) {
      const parsed = parse3(command, args, options);
      const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
      enoent.hookChildProcess(spawned, parsed);
      return spawned;
    }
    function spawnSync2(command, args, options) {
      const parsed = parse3(command, args, options);
      const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
      result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
      return result;
    }
    module2.exports = spawn2;
    module2.exports.spawn = spawn2;
    module2.exports.sync = spawnSync2;
    module2.exports._parse = parse3;
    module2.exports._enoent = enoent;
  }
});

// node_modules/npm-run-path/node_modules/path-key/index.js
function pathKey(options = {}) {
  const {
    env = process.env,
    platform: platform2 = process.platform
  } = options;
  if (platform2 !== "win32") {
    return "PATH";
  }
  return Object.keys(env).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
}
var init_path_key = __esm({
  "node_modules/npm-run-path/node_modules/path-key/index.js"() {
  }
});

// node_modules/unicorn-magic/default.js
var init_default2 = __esm({
  "node_modules/unicorn-magic/default.js"() {
  }
});

// node_modules/unicorn-magic/node.js
function toPath(urlOrPath) {
  return urlOrPath instanceof URL ? (0, import_node_url2.fileURLToPath)(urlOrPath) : urlOrPath;
}
function traversePathUp(startPath) {
  return {
    *[Symbol.iterator]() {
      let currentPath = import_node_path6.default.resolve(toPath(startPath));
      let previousPath;
      while (previousPath !== currentPath) {
        yield currentPath;
        previousPath = currentPath;
        currentPath = import_node_path6.default.resolve(currentPath, "..");
      }
    }
  };
}
var import_node_util4, import_node_child_process4, import_node_path6, import_node_url2, execFileOriginal, TEN_MEGABYTES_IN_BYTES;
var init_node = __esm({
  "node_modules/unicorn-magic/node.js"() {
    import_node_util4 = require("node:util");
    import_node_child_process4 = require("node:child_process");
    import_node_path6 = __toESM(require("node:path"), 1);
    import_node_url2 = require("node:url");
    init_default2();
    execFileOriginal = (0, import_node_util4.promisify)(import_node_child_process4.execFile);
    TEN_MEGABYTES_IN_BYTES = 10 * 1024 * 1024;
  }
});

// node_modules/npm-run-path/index.js
var import_node_process5, import_node_path7, npmRunPath, applyPreferLocal, applyExecPath, npmRunPathEnv;
var init_npm_run_path = __esm({
  "node_modules/npm-run-path/index.js"() {
    import_node_process5 = __toESM(require("node:process"), 1);
    import_node_path7 = __toESM(require("node:path"), 1);
    init_path_key();
    init_node();
    npmRunPath = ({
      cwd = import_node_process5.default.cwd(),
      path: pathOption = import_node_process5.default.env[pathKey()],
      preferLocal = true,
      execPath: execPath2 = import_node_process5.default.execPath,
      addExecPath = true
    } = {}) => {
      const cwdPath = import_node_path7.default.resolve(toPath(cwd));
      const result = [];
      const pathParts = pathOption.split(import_node_path7.default.delimiter);
      if (preferLocal) {
        applyPreferLocal(result, pathParts, cwdPath);
      }
      if (addExecPath) {
        applyExecPath(result, pathParts, execPath2, cwdPath);
      }
      return pathOption === "" || pathOption === import_node_path7.default.delimiter ? `${result.join(import_node_path7.default.delimiter)}${pathOption}` : [...result, pathOption].join(import_node_path7.default.delimiter);
    };
    applyPreferLocal = (result, pathParts, cwdPath) => {
      for (const directory of traversePathUp(cwdPath)) {
        const pathPart = import_node_path7.default.join(directory, "node_modules/.bin");
        if (!pathParts.includes(pathPart)) {
          result.push(pathPart);
        }
      }
    };
    applyExecPath = (result, pathParts, execPath2, cwdPath) => {
      const pathPart = import_node_path7.default.resolve(cwdPath, toPath(execPath2), "..");
      if (!pathParts.includes(pathPart)) {
        result.push(pathPart);
      }
    };
    npmRunPathEnv = ({ env = import_node_process5.default.env, ...options } = {}) => {
      env = { ...env };
      const pathName = pathKey({ env });
      options.path = env[pathName];
      env[pathName] = npmRunPath(options);
      return env;
    };
  }
});

// node_modules/execa/lib/return/final-error.js
var getFinalError, DiscardedError, setErrorName, isExecaError, execaErrorSymbol, isErrorInstance, ExecaError, ExecaSyncError;
var init_final_error = __esm({
  "node_modules/execa/lib/return/final-error.js"() {
    getFinalError = (originalError, message, isSync) => {
      const ErrorClass = isSync ? ExecaSyncError : ExecaError;
      const options = originalError instanceof DiscardedError ? {} : { cause: originalError };
      return new ErrorClass(message, options);
    };
    DiscardedError = class extends Error {
    };
    setErrorName = (ErrorClass, value) => {
      Object.defineProperty(ErrorClass.prototype, "name", {
        value,
        writable: true,
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(ErrorClass.prototype, execaErrorSymbol, {
        value: true,
        writable: false,
        enumerable: false,
        configurable: false
      });
    };
    isExecaError = (error) => isErrorInstance(error) && execaErrorSymbol in error;
    execaErrorSymbol = Symbol("isExecaError");
    isErrorInstance = (value) => Object.prototype.toString.call(value) === "[object Error]";
    ExecaError = class extends Error {
    };
    setErrorName(ExecaError, ExecaError.name);
    ExecaSyncError = class extends Error {
    };
    setErrorName(ExecaSyncError, ExecaSyncError.name);
  }
});

// node_modules/human-signals/build/src/realtime.js
var getRealtimeSignals, getRealtimeSignal, SIGRTMIN, SIGRTMAX;
var init_realtime = __esm({
  "node_modules/human-signals/build/src/realtime.js"() {
    getRealtimeSignals = () => {
      const length = SIGRTMAX - SIGRTMIN + 1;
      return Array.from({ length }, getRealtimeSignal);
    };
    getRealtimeSignal = (value, index) => ({
      name: `SIGRT${index + 1}`,
      number: SIGRTMIN + index,
      action: "terminate",
      description: "Application-specific signal (realtime)",
      standard: "posix"
    });
    SIGRTMIN = 34;
    SIGRTMAX = 64;
  }
});

// node_modules/human-signals/build/src/core.js
var SIGNALS;
var init_core = __esm({
  "node_modules/human-signals/build/src/core.js"() {
    SIGNALS = [
      {
        name: "SIGHUP",
        number: 1,
        action: "terminate",
        description: "Terminal closed",
        standard: "posix"
      },
      {
        name: "SIGINT",
        number: 2,
        action: "terminate",
        description: "User interruption with CTRL-C",
        standard: "ansi"
      },
      {
        name: "SIGQUIT",
        number: 3,
        action: "core",
        description: "User interruption with CTRL-\\",
        standard: "posix"
      },
      {
        name: "SIGILL",
        number: 4,
        action: "core",
        description: "Invalid machine instruction",
        standard: "ansi"
      },
      {
        name: "SIGTRAP",
        number: 5,
        action: "core",
        description: "Debugger breakpoint",
        standard: "posix"
      },
      {
        name: "SIGABRT",
        number: 6,
        action: "core",
        description: "Aborted",
        standard: "ansi"
      },
      {
        name: "SIGIOT",
        number: 6,
        action: "core",
        description: "Aborted",
        standard: "bsd"
      },
      {
        name: "SIGBUS",
        number: 7,
        action: "core",
        description: "Bus error due to misaligned, non-existing address or paging error",
        standard: "bsd"
      },
      {
        name: "SIGEMT",
        number: 7,
        action: "terminate",
        description: "Command should be emulated but is not implemented",
        standard: "other"
      },
      {
        name: "SIGFPE",
        number: 8,
        action: "core",
        description: "Floating point arithmetic error",
        standard: "ansi"
      },
      {
        name: "SIGKILL",
        number: 9,
        action: "terminate",
        description: "Forced termination",
        standard: "posix",
        forced: true
      },
      {
        name: "SIGUSR1",
        number: 10,
        action: "terminate",
        description: "Application-specific signal",
        standard: "posix"
      },
      {
        name: "SIGSEGV",
        number: 11,
        action: "core",
        description: "Segmentation fault",
        standard: "ansi"
      },
      {
        name: "SIGUSR2",
        number: 12,
        action: "terminate",
        description: "Application-specific signal",
        standard: "posix"
      },
      {
        name: "SIGPIPE",
        number: 13,
        action: "terminate",
        description: "Broken pipe or socket",
        standard: "posix"
      },
      {
        name: "SIGALRM",
        number: 14,
        action: "terminate",
        description: "Timeout or timer",
        standard: "posix"
      },
      {
        name: "SIGTERM",
        number: 15,
        action: "terminate",
        description: "Termination",
        standard: "ansi"
      },
      {
        name: "SIGSTKFLT",
        number: 16,
        action: "terminate",
        description: "Stack is empty or overflowed",
        standard: "other"
      },
      {
        name: "SIGCHLD",
        number: 17,
        action: "ignore",
        description: "Child process terminated, paused or unpaused",
        standard: "posix"
      },
      {
        name: "SIGCLD",
        number: 17,
        action: "ignore",
        description: "Child process terminated, paused or unpaused",
        standard: "other"
      },
      {
        name: "SIGCONT",
        number: 18,
        action: "unpause",
        description: "Unpaused",
        standard: "posix",
        forced: true
      },
      {
        name: "SIGSTOP",
        number: 19,
        action: "pause",
        description: "Paused",
        standard: "posix",
        forced: true
      },
      {
        name: "SIGTSTP",
        number: 20,
        action: "pause",
        description: 'Paused using CTRL-Z or "suspend"',
        standard: "posix"
      },
      {
        name: "SIGTTIN",
        number: 21,
        action: "pause",
        description: "Background process cannot read terminal input",
        standard: "posix"
      },
      {
        name: "SIGBREAK",
        number: 21,
        action: "terminate",
        description: "User interruption with CTRL-BREAK",
        standard: "other"
      },
      {
        name: "SIGTTOU",
        number: 22,
        action: "pause",
        description: "Background process cannot write to terminal output",
        standard: "posix"
      },
      {
        name: "SIGURG",
        number: 23,
        action: "ignore",
        description: "Socket received out-of-band data",
        standard: "bsd"
      },
      {
        name: "SIGXCPU",
        number: 24,
        action: "core",
        description: "Process timed out",
        standard: "bsd"
      },
      {
        name: "SIGXFSZ",
        number: 25,
        action: "core",
        description: "File too big",
        standard: "bsd"
      },
      {
        name: "SIGVTALRM",
        number: 26,
        action: "terminate",
        description: "Timeout or timer",
        standard: "bsd"
      },
      {
        name: "SIGPROF",
        number: 27,
        action: "terminate",
        description: "Timeout or timer",
        standard: "bsd"
      },
      {
        name: "SIGWINCH",
        number: 28,
        action: "ignore",
        description: "Terminal window size changed",
        standard: "bsd"
      },
      {
        name: "SIGIO",
        number: 29,
        action: "terminate",
        description: "I/O is available",
        standard: "other"
      },
      {
        name: "SIGPOLL",
        number: 29,
        action: "terminate",
        description: "Watched event",
        standard: "other"
      },
      {
        name: "SIGINFO",
        number: 29,
        action: "ignore",
        description: "Request for process information",
        standard: "other"
      },
      {
        name: "SIGPWR",
        number: 30,
        action: "terminate",
        description: "Device running out of power",
        standard: "systemv"
      },
      {
        name: "SIGSYS",
        number: 31,
        action: "core",
        description: "Invalid system call",
        standard: "other"
      },
      {
        name: "SIGUNUSED",
        number: 31,
        action: "terminate",
        description: "Invalid system call",
        standard: "other"
      }
    ];
  }
});

// node_modules/human-signals/build/src/signals.js
var import_node_os2, getSignals, normalizeSignal;
var init_signals = __esm({
  "node_modules/human-signals/build/src/signals.js"() {
    import_node_os2 = require("node:os");
    init_core();
    init_realtime();
    getSignals = () => {
      const realtimeSignals = getRealtimeSignals();
      const signals2 = [...SIGNALS, ...realtimeSignals].map(normalizeSignal);
      return signals2;
    };
    normalizeSignal = ({
      name,
      number: defaultNumber,
      description,
      action,
      forced = false,
      standard
    }) => {
      const {
        signals: { [name]: constantSignal }
      } = import_node_os2.constants;
      const supported = constantSignal !== void 0;
      const number = supported ? constantSignal : defaultNumber;
      return { name, number, description, supported, action, forced, standard };
    };
  }
});

// node_modules/human-signals/build/src/main.js
var import_node_os3, getSignalsByName, getSignalByName, signalsByName, getSignalsByNumber, getSignalByNumber, findSignalByNumber, signalsByNumber;
var init_main = __esm({
  "node_modules/human-signals/build/src/main.js"() {
    import_node_os3 = require("node:os");
    init_realtime();
    init_signals();
    getSignalsByName = () => {
      const signals2 = getSignals();
      return Object.fromEntries(signals2.map(getSignalByName));
    };
    getSignalByName = ({
      name,
      number,
      description,
      supported,
      action,
      forced,
      standard
    }) => [name, { name, number, description, supported, action, forced, standard }];
    signalsByName = getSignalsByName();
    getSignalsByNumber = () => {
      const signals2 = getSignals();
      const length = SIGRTMAX + 1;
      const signalsA = Array.from(
        { length },
        (value, number) => getSignalByNumber(number, signals2)
      );
      return Object.assign({}, ...signalsA);
    };
    getSignalByNumber = (number, signals2) => {
      const signal = findSignalByNumber(number, signals2);
      if (signal === void 0) {
        return {};
      }
      const { name, description, supported, action, forced, standard } = signal;
      return {
        [number]: {
          name,
          number,
          description,
          supported,
          action,
          forced,
          standard
        }
      };
    };
    findSignalByNumber = (number, signals2) => {
      const signal = signals2.find(({ name }) => import_node_os3.constants.signals[name] === number);
      if (signal !== void 0) {
        return signal;
      }
      return signals2.find((signalA) => signalA.number === number);
    };
    signalsByNumber = getSignalsByNumber();
  }
});

// node_modules/execa/lib/terminate/signal.js
var import_node_os4, normalizeKillSignal, normalizeSignalArgument, normalizeSignal2, normalizeSignalInteger, getSignalsIntegerToName, signalsIntegerToName, normalizeSignalName, getAvailableSignals, getAvailableSignalNames, getAvailableSignalIntegers, getSignalDescription;
var init_signal = __esm({
  "node_modules/execa/lib/terminate/signal.js"() {
    import_node_os4 = require("node:os");
    init_main();
    normalizeKillSignal = (killSignal) => {
      const optionName = "option `killSignal`";
      if (killSignal === 0) {
        throw new TypeError(`Invalid ${optionName}: 0 cannot be used.`);
      }
      return normalizeSignal2(killSignal, optionName);
    };
    normalizeSignalArgument = (signal) => signal === 0 ? signal : normalizeSignal2(signal, "`subprocess.kill()`'s argument");
    normalizeSignal2 = (signalNameOrInteger, optionName) => {
      if (Number.isInteger(signalNameOrInteger)) {
        return normalizeSignalInteger(signalNameOrInteger, optionName);
      }
      if (typeof signalNameOrInteger === "string") {
        return normalizeSignalName(signalNameOrInteger, optionName);
      }
      throw new TypeError(`Invalid ${optionName} ${String(signalNameOrInteger)}: it must be a string or an integer.
${getAvailableSignals()}`);
    };
    normalizeSignalInteger = (signalInteger, optionName) => {
      if (signalsIntegerToName.has(signalInteger)) {
        return signalsIntegerToName.get(signalInteger);
      }
      throw new TypeError(`Invalid ${optionName} ${signalInteger}: this signal integer does not exist.
${getAvailableSignals()}`);
    };
    getSignalsIntegerToName = () => new Map(Object.entries(import_node_os4.constants.signals).reverse().map(([signalName, signalInteger]) => [signalInteger, signalName]));
    signalsIntegerToName = getSignalsIntegerToName();
    normalizeSignalName = (signalName, optionName) => {
      if (signalName in import_node_os4.constants.signals) {
        return signalName;
      }
      if (signalName.toUpperCase() in import_node_os4.constants.signals) {
        throw new TypeError(`Invalid ${optionName} '${signalName}': please rename it to '${signalName.toUpperCase()}'.`);
      }
      throw new TypeError(`Invalid ${optionName} '${signalName}': this signal name does not exist.
${getAvailableSignals()}`);
    };
    getAvailableSignals = () => `Available signal names: ${getAvailableSignalNames()}.
Available signal numbers: ${getAvailableSignalIntegers()}.`;
    getAvailableSignalNames = () => Object.keys(import_node_os4.constants.signals).sort().map((signalName) => `'${signalName}'`).join(", ");
    getAvailableSignalIntegers = () => [...new Set(Object.values(import_node_os4.constants.signals).sort((signalInteger, signalIntegerTwo) => signalInteger - signalIntegerTwo))].join(", ");
    getSignalDescription = (signal) => signalsByName[signal].description;
  }
});

// node_modules/execa/lib/terminate/kill.js
var import_promises, normalizeForceKillAfterDelay, DEFAULT_FORCE_KILL_TIMEOUT, subprocessKill, parseKillArguments, emitKillError, setKillTimeout, killOnTimeout;
var init_kill = __esm({
  "node_modules/execa/lib/terminate/kill.js"() {
    import_promises = require("node:timers/promises");
    init_final_error();
    init_signal();
    normalizeForceKillAfterDelay = (forceKillAfterDelay) => {
      if (forceKillAfterDelay === false) {
        return forceKillAfterDelay;
      }
      if (forceKillAfterDelay === true) {
        return DEFAULT_FORCE_KILL_TIMEOUT;
      }
      if (!Number.isFinite(forceKillAfterDelay) || forceKillAfterDelay < 0) {
        throw new TypeError(`Expected the \`forceKillAfterDelay\` option to be a non-negative integer, got \`${forceKillAfterDelay}\` (${typeof forceKillAfterDelay})`);
      }
      return forceKillAfterDelay;
    };
    DEFAULT_FORCE_KILL_TIMEOUT = 1e3 * 5;
    subprocessKill = ({ kill, options: { forceKillAfterDelay, killSignal }, onInternalError, context, controller }, signalOrError, errorArgument) => {
      const { signal, error } = parseKillArguments(signalOrError, errorArgument, killSignal);
      emitKillError(error, onInternalError);
      const killResult = kill(signal);
      setKillTimeout({
        kill,
        signal,
        forceKillAfterDelay,
        killSignal,
        killResult,
        context,
        controller
      });
      return killResult;
    };
    parseKillArguments = (signalOrError, errorArgument, killSignal) => {
      const [signal = killSignal, error] = isErrorInstance(signalOrError) ? [void 0, signalOrError] : [signalOrError, errorArgument];
      if (typeof signal !== "string" && !Number.isInteger(signal)) {
        throw new TypeError(`The first argument must be an error instance or a signal name string/integer: ${String(signal)}`);
      }
      if (error !== void 0 && !isErrorInstance(error)) {
        throw new TypeError(`The second argument is optional. If specified, it must be an error instance: ${error}`);
      }
      return { signal: normalizeSignalArgument(signal), error };
    };
    emitKillError = (error, onInternalError) => {
      if (error !== void 0) {
        onInternalError.reject(error);
      }
    };
    setKillTimeout = async ({ kill, signal, forceKillAfterDelay, killSignal, killResult, context, controller }) => {
      if (signal === killSignal && killResult) {
        killOnTimeout({
          kill,
          forceKillAfterDelay,
          context,
          controllerSignal: controller.signal
        });
      }
    };
    killOnTimeout = async ({ kill, forceKillAfterDelay, context, controllerSignal }) => {
      if (forceKillAfterDelay === false) {
        return;
      }
      try {
        await (0, import_promises.setTimeout)(forceKillAfterDelay, void 0, { signal: controllerSignal });
        if (kill("SIGKILL")) {
          context.isForcefullyTerminated ??= true;
        }
      } catch {
      }
    };
  }
});

// node_modules/execa/lib/utils/abort-signal.js
var import_node_events, onAbortedSignal;
var init_abort_signal = __esm({
  "node_modules/execa/lib/utils/abort-signal.js"() {
    import_node_events = require("node:events");
    onAbortedSignal = async (mainSignal, stopSignal) => {
      if (!mainSignal.aborted) {
        await (0, import_node_events.once)(mainSignal, "abort", { signal: stopSignal });
      }
    };
  }
});

// node_modules/execa/lib/terminate/cancel.js
var validateCancelSignal, throwOnCancel, terminateOnCancel;
var init_cancel = __esm({
  "node_modules/execa/lib/terminate/cancel.js"() {
    init_abort_signal();
    validateCancelSignal = ({ cancelSignal }) => {
      if (cancelSignal !== void 0 && Object.prototype.toString.call(cancelSignal) !== "[object AbortSignal]") {
        throw new Error(`The \`cancelSignal\` option must be an AbortSignal: ${String(cancelSignal)}`);
      }
    };
    throwOnCancel = ({ subprocess, cancelSignal, gracefulCancel, context, controller }) => cancelSignal === void 0 || gracefulCancel ? [] : [terminateOnCancel(subprocess, cancelSignal, context, controller)];
    terminateOnCancel = async (subprocess, cancelSignal, context, { signal }) => {
      await onAbortedSignal(cancelSignal, signal);
      context.terminationReason ??= "cancel";
      subprocess.kill();
      throw cancelSignal.reason;
    };
  }
});

// node_modules/execa/lib/ipc/validation.js
var validateIpcMethod, validateIpcOption, validateConnection, throwOnEarlyDisconnect, throwOnStrictDeadlockError, getStrictResponseError, throwOnMissingStrict, throwOnStrictDisconnect, getAbortDisconnectError, throwOnMissingParent, handleEpipeError, handleSerializationError, isSerializationError, SERIALIZATION_ERROR_CODES, SERIALIZATION_ERROR_MESSAGES, getMethodName, getNamespaceName, getOtherProcessName, disconnect;
var init_validation = __esm({
  "node_modules/execa/lib/ipc/validation.js"() {
    validateIpcMethod = ({ methodName, isSubprocess, ipc, isConnected: isConnected2 }) => {
      validateIpcOption(methodName, isSubprocess, ipc);
      validateConnection(methodName, isSubprocess, isConnected2);
    };
    validateIpcOption = (methodName, isSubprocess, ipc) => {
      if (!ipc) {
        throw new Error(`${getMethodName(methodName, isSubprocess)} can only be used if the \`ipc\` option is \`true\`.`);
      }
    };
    validateConnection = (methodName, isSubprocess, isConnected2) => {
      if (!isConnected2) {
        throw new Error(`${getMethodName(methodName, isSubprocess)} cannot be used: the ${getOtherProcessName(isSubprocess)} has already exited or disconnected.`);
      }
    };
    throwOnEarlyDisconnect = (isSubprocess) => {
      throw new Error(`${getMethodName("getOneMessage", isSubprocess)} could not complete: the ${getOtherProcessName(isSubprocess)} exited or disconnected.`);
    };
    throwOnStrictDeadlockError = (isSubprocess) => {
      throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} is sending a message too, instead of listening to incoming messages.
This can be fixed by both sending a message and listening to incoming messages at the same time:

const [receivedMessage] = await Promise.all([
	${getMethodName("getOneMessage", isSubprocess)},
	${getMethodName("sendMessage", isSubprocess, "message, {strict: true}")},
]);`);
    };
    getStrictResponseError = (error, isSubprocess) => new Error(`${getMethodName("sendMessage", isSubprocess)} failed when sending an acknowledgment response to the ${getOtherProcessName(isSubprocess)}.`, { cause: error });
    throwOnMissingStrict = (isSubprocess) => {
      throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} is not listening to incoming messages.`);
    };
    throwOnStrictDisconnect = (isSubprocess) => {
      throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} exited without listening to incoming messages.`);
    };
    getAbortDisconnectError = () => new Error(`\`cancelSignal\` aborted: the ${getOtherProcessName(true)} disconnected.`);
    throwOnMissingParent = () => {
      throw new Error("`getCancelSignal()` cannot be used without setting the `cancelSignal` subprocess option.");
    };
    handleEpipeError = ({ error, methodName, isSubprocess }) => {
      if (error.code === "EPIPE") {
        throw new Error(`${getMethodName(methodName, isSubprocess)} cannot be used: the ${getOtherProcessName(isSubprocess)} is disconnecting.`, { cause: error });
      }
    };
    handleSerializationError = ({ error, methodName, isSubprocess, message }) => {
      if (isSerializationError(error)) {
        throw new Error(`${getMethodName(methodName, isSubprocess)}'s argument type is invalid: the message cannot be serialized: ${String(message)}.`, { cause: error });
      }
    };
    isSerializationError = ({ code, message }) => SERIALIZATION_ERROR_CODES.has(code) || SERIALIZATION_ERROR_MESSAGES.some((serializationErrorMessage) => message.includes(serializationErrorMessage));
    SERIALIZATION_ERROR_CODES = /* @__PURE__ */ new Set([
      // Message is `undefined`
      "ERR_MISSING_ARGS",
      // Message is a function, a bigint, a symbol
      "ERR_INVALID_ARG_TYPE"
    ]);
    SERIALIZATION_ERROR_MESSAGES = [
      // Message is a promise or a proxy, with `serialization: 'advanced'`
      "could not be cloned",
      // Message has cycles, with `serialization: 'json'`
      "circular structure",
      // Message has cycles inside toJSON(), with `serialization: 'json'`
      "call stack size exceeded"
    ];
    getMethodName = (methodName, isSubprocess, parameters = "") => methodName === "cancelSignal" ? "`cancelSignal`'s `controller.abort()`" : `${getNamespaceName(isSubprocess)}${methodName}(${parameters})`;
    getNamespaceName = (isSubprocess) => isSubprocess ? "" : "subprocess.";
    getOtherProcessName = (isSubprocess) => isSubprocess ? "parent process" : "subprocess";
    disconnect = (anyProcess) => {
      if (anyProcess.connected) {
        anyProcess.disconnect();
      }
    };
  }
});

// node_modules/execa/lib/utils/deferred.js
var createDeferred;
var init_deferred = __esm({
  "node_modules/execa/lib/utils/deferred.js"() {
    createDeferred = () => {
      const methods = {};
      const promise = new Promise((resolve, reject) => {
        Object.assign(methods, { resolve, reject });
      });
      return Object.assign(promise, methods);
    };
  }
});

// node_modules/execa/lib/arguments/fd-options.js
var getToStream, getFromStream, SUBPROCESS_OPTIONS, getFdNumber, parseFdNumber, validateFdNumber, getInvalidStdioOptionMessage, getInvalidStdioOption, getUsedDescriptor, getOptionName, serializeOptionValue;
var init_fd_options = __esm({
  "node_modules/execa/lib/arguments/fd-options.js"() {
    init_specific();
    getToStream = (destination, to = "stdin") => {
      const isWritable = true;
      const { options, fileDescriptors } = SUBPROCESS_OPTIONS.get(destination);
      const fdNumber = getFdNumber(fileDescriptors, to, isWritable);
      const destinationStream = destination.stdio[fdNumber];
      if (destinationStream === null) {
        throw new TypeError(getInvalidStdioOptionMessage(fdNumber, to, options, isWritable));
      }
      return destinationStream;
    };
    getFromStream = (source, from = "stdout") => {
      const isWritable = false;
      const { options, fileDescriptors } = SUBPROCESS_OPTIONS.get(source);
      const fdNumber = getFdNumber(fileDescriptors, from, isWritable);
      const sourceStream = fdNumber === "all" ? source.all : source.stdio[fdNumber];
      if (sourceStream === null || sourceStream === void 0) {
        throw new TypeError(getInvalidStdioOptionMessage(fdNumber, from, options, isWritable));
      }
      return sourceStream;
    };
    SUBPROCESS_OPTIONS = /* @__PURE__ */ new WeakMap();
    getFdNumber = (fileDescriptors, fdName, isWritable) => {
      const fdNumber = parseFdNumber(fdName, isWritable);
      validateFdNumber(fdNumber, fdName, isWritable, fileDescriptors);
      return fdNumber;
    };
    parseFdNumber = (fdName, isWritable) => {
      const fdNumber = parseFd(fdName);
      if (fdNumber !== void 0) {
        return fdNumber;
      }
      const { validOptions, defaultValue } = isWritable ? { validOptions: '"stdin"', defaultValue: "stdin" } : { validOptions: '"stdout", "stderr", "all"', defaultValue: "stdout" };
      throw new TypeError(`"${getOptionName(isWritable)}" must not be "${fdName}".
It must be ${validOptions} or "fd3", "fd4" (and so on).
It is optional and defaults to "${defaultValue}".`);
    };
    validateFdNumber = (fdNumber, fdName, isWritable, fileDescriptors) => {
      const fileDescriptor = fileDescriptors[getUsedDescriptor(fdNumber)];
      if (fileDescriptor === void 0) {
        throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. That file descriptor does not exist.
Please set the "stdio" option to ensure that file descriptor exists.`);
      }
      if (fileDescriptor.direction === "input" && !isWritable) {
        throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. It must be a readable stream, not writable.`);
      }
      if (fileDescriptor.direction !== "input" && isWritable) {
        throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. It must be a writable stream, not readable.`);
      }
    };
    getInvalidStdioOptionMessage = (fdNumber, fdName, options, isWritable) => {
      if (fdNumber === "all" && !options.all) {
        return `The "all" option must be true to use "from: 'all'".`;
      }
      const { optionName, optionValue } = getInvalidStdioOption(fdNumber, options);
      return `The "${optionName}: ${serializeOptionValue(optionValue)}" option is incompatible with using "${getOptionName(isWritable)}: ${serializeOptionValue(fdName)}".
Please set this option with "pipe" instead.`;
    };
    getInvalidStdioOption = (fdNumber, { stdin, stdout, stderr, stdio }) => {
      const usedDescriptor = getUsedDescriptor(fdNumber);
      if (usedDescriptor === 0 && stdin !== void 0) {
        return { optionName: "stdin", optionValue: stdin };
      }
      if (usedDescriptor === 1 && stdout !== void 0) {
        return { optionName: "stdout", optionValue: stdout };
      }
      if (usedDescriptor === 2 && stderr !== void 0) {
        return { optionName: "stderr", optionValue: stderr };
      }
      return { optionName: `stdio[${usedDescriptor}]`, optionValue: stdio[usedDescriptor] };
    };
    getUsedDescriptor = (fdNumber) => fdNumber === "all" ? 1 : fdNumber;
    getOptionName = (isWritable) => isWritable ? "to" : "from";
    serializeOptionValue = (value) => {
      if (typeof value === "string") {
        return `'${value}'`;
      }
      return typeof value === "number" ? `${value}` : "Stream";
    };
  }
});

// node_modules/execa/lib/utils/max-listeners.js
var import_node_events2, incrementMaxListeners;
var init_max_listeners = __esm({
  "node_modules/execa/lib/utils/max-listeners.js"() {
    import_node_events2 = require("node:events");
    incrementMaxListeners = (eventEmitter, maxListenersIncrement, signal) => {
      const maxListeners = eventEmitter.getMaxListeners();
      if (maxListeners === 0 || maxListeners === Number.POSITIVE_INFINITY) {
        return;
      }
      eventEmitter.setMaxListeners(maxListeners + maxListenersIncrement);
      (0, import_node_events2.addAbortListener)(signal, () => {
        eventEmitter.setMaxListeners(eventEmitter.getMaxListeners() - maxListenersIncrement);
      });
    };
  }
});

// node_modules/execa/lib/ipc/reference.js
var addReference, addReferenceCount, removeReference, removeReferenceCount, undoAddedReferences, redoAddedReferences;
var init_reference = __esm({
  "node_modules/execa/lib/ipc/reference.js"() {
    addReference = (channel, reference) => {
      if (reference) {
        addReferenceCount(channel);
      }
    };
    addReferenceCount = (channel) => {
      channel.refCounted();
    };
    removeReference = (channel, reference) => {
      if (reference) {
        removeReferenceCount(channel);
      }
    };
    removeReferenceCount = (channel) => {
      channel.unrefCounted();
    };
    undoAddedReferences = (channel, isSubprocess) => {
      if (isSubprocess) {
        removeReferenceCount(channel);
        removeReferenceCount(channel);
      }
    };
    redoAddedReferences = (channel, isSubprocess) => {
      if (isSubprocess) {
        addReferenceCount(channel);
        addReferenceCount(channel);
      }
    };
  }
});

// node_modules/execa/lib/ipc/incoming.js
var import_node_events3, import_promises2, onMessage, onDisconnect, INCOMING_MESSAGES;
var init_incoming = __esm({
  "node_modules/execa/lib/ipc/incoming.js"() {
    import_node_events3 = require("node:events");
    import_promises2 = require("node:timers/promises");
    init_outgoing();
    init_reference();
    init_strict();
    init_graceful();
    onMessage = async ({ anyProcess, channel, isSubprocess, ipcEmitter }, wrappedMessage) => {
      if (handleStrictResponse(wrappedMessage) || handleAbort(wrappedMessage)) {
        return;
      }
      if (!INCOMING_MESSAGES.has(anyProcess)) {
        INCOMING_MESSAGES.set(anyProcess, []);
      }
      const incomingMessages = INCOMING_MESSAGES.get(anyProcess);
      incomingMessages.push(wrappedMessage);
      if (incomingMessages.length > 1) {
        return;
      }
      while (incomingMessages.length > 0) {
        await waitForOutgoingMessages(anyProcess, ipcEmitter, wrappedMessage);
        await import_promises2.scheduler.yield();
        const message = await handleStrictRequest({
          wrappedMessage: incomingMessages[0],
          anyProcess,
          channel,
          isSubprocess,
          ipcEmitter
        });
        incomingMessages.shift();
        ipcEmitter.emit("message", message);
        ipcEmitter.emit("message:done");
      }
    };
    onDisconnect = async ({ anyProcess, channel, isSubprocess, ipcEmitter, boundOnMessage }) => {
      abortOnDisconnect();
      const incomingMessages = INCOMING_MESSAGES.get(anyProcess);
      while (incomingMessages?.length > 0) {
        await (0, import_node_events3.once)(ipcEmitter, "message:done");
      }
      anyProcess.removeListener("message", boundOnMessage);
      redoAddedReferences(channel, isSubprocess);
      ipcEmitter.connected = false;
      ipcEmitter.emit("disconnect");
    };
    INCOMING_MESSAGES = /* @__PURE__ */ new WeakMap();
  }
});

// node_modules/execa/lib/ipc/forward.js
var import_node_events4, getIpcEmitter, IPC_EMITTERS, forwardEvents, isConnected;
var init_forward = __esm({
  "node_modules/execa/lib/ipc/forward.js"() {
    import_node_events4 = require("node:events");
    init_incoming();
    init_reference();
    getIpcEmitter = (anyProcess, channel, isSubprocess) => {
      if (IPC_EMITTERS.has(anyProcess)) {
        return IPC_EMITTERS.get(anyProcess);
      }
      const ipcEmitter = new import_node_events4.EventEmitter();
      ipcEmitter.connected = true;
      IPC_EMITTERS.set(anyProcess, ipcEmitter);
      forwardEvents({
        ipcEmitter,
        anyProcess,
        channel,
        isSubprocess
      });
      return ipcEmitter;
    };
    IPC_EMITTERS = /* @__PURE__ */ new WeakMap();
    forwardEvents = ({ ipcEmitter, anyProcess, channel, isSubprocess }) => {
      const boundOnMessage = onMessage.bind(void 0, {
        anyProcess,
        channel,
        isSubprocess,
        ipcEmitter
      });
      anyProcess.on("message", boundOnMessage);
      anyProcess.once("disconnect", onDisconnect.bind(void 0, {
        anyProcess,
        channel,
        isSubprocess,
        ipcEmitter,
        boundOnMessage
      }));
      undoAddedReferences(channel, isSubprocess);
    };
    isConnected = (anyProcess) => {
      const ipcEmitter = IPC_EMITTERS.get(anyProcess);
      return ipcEmitter === void 0 ? anyProcess.channel !== null : ipcEmitter.connected;
    };
  }
});

// node_modules/execa/lib/ipc/strict.js
var import_node_events5, handleSendStrict, count, validateStrictDeadlock, handleStrictRequest, handleStrictResponse, waitForStrictResponse, STRICT_RESPONSES, throwOnDisconnect, REQUEST_TYPE, RESPONSE_TYPE;
var init_strict = __esm({
  "node_modules/execa/lib/ipc/strict.js"() {
    import_node_events5 = require("node:events");
    init_deferred();
    init_max_listeners();
    init_send();
    init_validation();
    init_forward();
    init_outgoing();
    handleSendStrict = ({ anyProcess, channel, isSubprocess, message, strict }) => {
      if (!strict) {
        return message;
      }
      const ipcEmitter = getIpcEmitter(anyProcess, channel, isSubprocess);
      const hasListeners = hasMessageListeners(anyProcess, ipcEmitter);
      return {
        id: count++,
        type: REQUEST_TYPE,
        message,
        hasListeners
      };
    };
    count = 0n;
    validateStrictDeadlock = (outgoingMessages, wrappedMessage) => {
      if (wrappedMessage?.type !== REQUEST_TYPE || wrappedMessage.hasListeners) {
        return;
      }
      for (const { id } of outgoingMessages) {
        if (id !== void 0) {
          STRICT_RESPONSES[id].resolve({ isDeadlock: true, hasListeners: false });
        }
      }
    };
    handleStrictRequest = async ({ wrappedMessage, anyProcess, channel, isSubprocess, ipcEmitter }) => {
      if (wrappedMessage?.type !== REQUEST_TYPE || !anyProcess.connected) {
        return wrappedMessage;
      }
      const { id, message } = wrappedMessage;
      const response = { id, type: RESPONSE_TYPE, message: hasMessageListeners(anyProcess, ipcEmitter) };
      try {
        await sendMessage({
          anyProcess,
          channel,
          isSubprocess,
          ipc: true
        }, response);
      } catch (error) {
        ipcEmitter.emit("strict:error", error);
      }
      return message;
    };
    handleStrictResponse = (wrappedMessage) => {
      if (wrappedMessage?.type !== RESPONSE_TYPE) {
        return false;
      }
      const { id, message: hasListeners } = wrappedMessage;
      STRICT_RESPONSES[id]?.resolve({ isDeadlock: false, hasListeners });
      return true;
    };
    waitForStrictResponse = async (wrappedMessage, anyProcess, isSubprocess) => {
      if (wrappedMessage?.type !== REQUEST_TYPE) {
        return;
      }
      const deferred = createDeferred();
      STRICT_RESPONSES[wrappedMessage.id] = deferred;
      const controller = new AbortController();
      try {
        const { isDeadlock, hasListeners } = await Promise.race([
          deferred,
          throwOnDisconnect(anyProcess, isSubprocess, controller)
        ]);
        if (isDeadlock) {
          throwOnStrictDeadlockError(isSubprocess);
        }
        if (!hasListeners) {
          throwOnMissingStrict(isSubprocess);
        }
      } finally {
        controller.abort();
        delete STRICT_RESPONSES[wrappedMessage.id];
      }
    };
    STRICT_RESPONSES = {};
    throwOnDisconnect = async (anyProcess, isSubprocess, { signal }) => {
      incrementMaxListeners(anyProcess, 1, signal);
      await (0, import_node_events5.once)(anyProcess, "disconnect", { signal });
      throwOnStrictDisconnect(isSubprocess);
    };
    REQUEST_TYPE = "execa:ipc:request";
    RESPONSE_TYPE = "execa:ipc:response";
  }
});

// node_modules/execa/lib/ipc/outgoing.js
var startSendMessage, endSendMessage, waitForOutgoingMessages, OUTGOING_MESSAGES, hasMessageListeners, getMinListenerCount;
var init_outgoing = __esm({
  "node_modules/execa/lib/ipc/outgoing.js"() {
    init_deferred();
    init_specific();
    init_fd_options();
    init_strict();
    startSendMessage = (anyProcess, wrappedMessage, strict) => {
      if (!OUTGOING_MESSAGES.has(anyProcess)) {
        OUTGOING_MESSAGES.set(anyProcess, /* @__PURE__ */ new Set());
      }
      const outgoingMessages = OUTGOING_MESSAGES.get(anyProcess);
      const onMessageSent = createDeferred();
      const id = strict ? wrappedMessage.id : void 0;
      const outgoingMessage = { onMessageSent, id };
      outgoingMessages.add(outgoingMessage);
      return { outgoingMessages, outgoingMessage };
    };
    endSendMessage = ({ outgoingMessages, outgoingMessage }) => {
      outgoingMessages.delete(outgoingMessage);
      outgoingMessage.onMessageSent.resolve();
    };
    waitForOutgoingMessages = async (anyProcess, ipcEmitter, wrappedMessage) => {
      while (!hasMessageListeners(anyProcess, ipcEmitter) && OUTGOING_MESSAGES.get(anyProcess)?.size > 0) {
        const outgoingMessages = [...OUTGOING_MESSAGES.get(anyProcess)];
        validateStrictDeadlock(outgoingMessages, wrappedMessage);
        await Promise.all(outgoingMessages.map(({ onMessageSent }) => onMessageSent));
      }
    };
    OUTGOING_MESSAGES = /* @__PURE__ */ new WeakMap();
    hasMessageListeners = (anyProcess, ipcEmitter) => ipcEmitter.listenerCount("message") > getMinListenerCount(anyProcess);
    getMinListenerCount = (anyProcess) => SUBPROCESS_OPTIONS.has(anyProcess) && !getFdSpecificValue(SUBPROCESS_OPTIONS.get(anyProcess).options.buffer, "ipc") ? 1 : 0;
  }
});

// node_modules/execa/lib/ipc/send.js
var import_node_util5, sendMessage, sendMessageAsync, sendOneMessage, getSendMethod, PROCESS_SEND_METHODS;
var init_send = __esm({
  "node_modules/execa/lib/ipc/send.js"() {
    import_node_util5 = require("node:util");
    init_validation();
    init_outgoing();
    init_strict();
    sendMessage = ({ anyProcess, channel, isSubprocess, ipc }, message, { strict = false } = {}) => {
      const methodName = "sendMessage";
      validateIpcMethod({
        methodName,
        isSubprocess,
        ipc,
        isConnected: anyProcess.connected
      });
      return sendMessageAsync({
        anyProcess,
        channel,
        methodName,
        isSubprocess,
        message,
        strict
      });
    };
    sendMessageAsync = async ({ anyProcess, channel, methodName, isSubprocess, message, strict }) => {
      const wrappedMessage = handleSendStrict({
        anyProcess,
        channel,
        isSubprocess,
        message,
        strict
      });
      const outgoingMessagesState = startSendMessage(anyProcess, wrappedMessage, strict);
      try {
        await sendOneMessage({
          anyProcess,
          methodName,
          isSubprocess,
          wrappedMessage,
          message
        });
      } catch (error) {
        disconnect(anyProcess);
        throw error;
      } finally {
        endSendMessage(outgoingMessagesState);
      }
    };
    sendOneMessage = async ({ anyProcess, methodName, isSubprocess, wrappedMessage, message }) => {
      const sendMethod = getSendMethod(anyProcess);
      try {
        await Promise.all([
          waitForStrictResponse(wrappedMessage, anyProcess, isSubprocess),
          sendMethod(wrappedMessage)
        ]);
      } catch (error) {
        handleEpipeError({ error, methodName, isSubprocess });
        handleSerializationError({
          error,
          methodName,
          isSubprocess,
          message
        });
        throw error;
      }
    };
    getSendMethod = (anyProcess) => {
      if (PROCESS_SEND_METHODS.has(anyProcess)) {
        return PROCESS_SEND_METHODS.get(anyProcess);
      }
      const sendMethod = (0, import_node_util5.promisify)(anyProcess.send.bind(anyProcess));
      PROCESS_SEND_METHODS.set(anyProcess, sendMethod);
      return sendMethod;
    };
    PROCESS_SEND_METHODS = /* @__PURE__ */ new WeakMap();
  }
});

// node_modules/execa/lib/ipc/graceful.js
var import_promises3, sendAbort, getCancelSignal, startIpc, cancelListening, handleAbort, GRACEFUL_CANCEL_TYPE, abortOnDisconnect, cancelController;
var init_graceful = __esm({
  "node_modules/execa/lib/ipc/graceful.js"() {
    import_promises3 = require("node:timers/promises");
    init_send();
    init_forward();
    init_validation();
    sendAbort = (subprocess, message) => {
      const methodName = "cancelSignal";
      validateConnection(methodName, false, subprocess.connected);
      return sendOneMessage({
        anyProcess: subprocess,
        methodName,
        isSubprocess: false,
        wrappedMessage: { type: GRACEFUL_CANCEL_TYPE, message },
        message
      });
    };
    getCancelSignal = async ({ anyProcess, channel, isSubprocess, ipc }) => {
      await startIpc({
        anyProcess,
        channel,
        isSubprocess,
        ipc
      });
      return cancelController.signal;
    };
    startIpc = async ({ anyProcess, channel, isSubprocess, ipc }) => {
      if (cancelListening) {
        return;
      }
      cancelListening = true;
      if (!ipc) {
        throwOnMissingParent();
        return;
      }
      if (channel === null) {
        abortOnDisconnect();
        return;
      }
      getIpcEmitter(anyProcess, channel, isSubprocess);
      await import_promises3.scheduler.yield();
    };
    cancelListening = false;
    handleAbort = (wrappedMessage) => {
      if (wrappedMessage?.type !== GRACEFUL_CANCEL_TYPE) {
        return false;
      }
      cancelController.abort(wrappedMessage.message);
      return true;
    };
    GRACEFUL_CANCEL_TYPE = "execa:ipc:cancel";
    abortOnDisconnect = () => {
      cancelController.abort(getAbortDisconnectError());
    };
    cancelController = new AbortController();
  }
});

// node_modules/execa/lib/terminate/graceful.js
var validateGracefulCancel, throwOnGracefulCancel, sendOnAbort, getReason;
var init_graceful2 = __esm({
  "node_modules/execa/lib/terminate/graceful.js"() {
    init_abort_signal();
    init_graceful();
    init_kill();
    validateGracefulCancel = ({ gracefulCancel, cancelSignal, ipc, serialization }) => {
      if (!gracefulCancel) {
        return;
      }
      if (cancelSignal === void 0) {
        throw new Error("The `cancelSignal` option must be defined when setting the `gracefulCancel` option.");
      }
      if (!ipc) {
        throw new Error("The `ipc` option cannot be false when setting the `gracefulCancel` option.");
      }
      if (serialization === "json") {
        throw new Error("The `serialization` option cannot be 'json' when setting the `gracefulCancel` option.");
      }
    };
    throwOnGracefulCancel = ({
      subprocess,
      cancelSignal,
      gracefulCancel,
      forceKillAfterDelay,
      context,
      controller
    }) => gracefulCancel ? [sendOnAbort({
      subprocess,
      cancelSignal,
      forceKillAfterDelay,
      context,
      controller
    })] : [];
    sendOnAbort = async ({ subprocess, cancelSignal, forceKillAfterDelay, context, controller: { signal } }) => {
      await onAbortedSignal(cancelSignal, signal);
      const reason = getReason(cancelSignal);
      await sendAbort(subprocess, reason);
      killOnTimeout({
        kill: subprocess.kill,
        forceKillAfterDelay,
        context,
        controllerSignal: signal
      });
      context.terminationReason ??= "gracefulCancel";
      throw cancelSignal.reason;
    };
    getReason = ({ reason }) => {
      if (!(reason instanceof DOMException)) {
        return reason;
      }
      const error = new Error(reason.message);
      Object.defineProperty(error, "stack", {
        value: reason.stack,
        enumerable: false,
        configurable: true,
        writable: true
      });
      return error;
    };
  }
});

// node_modules/execa/lib/terminate/timeout.js
var import_promises4, validateTimeout, throwOnTimeout, killAfterTimeout;
var init_timeout = __esm({
  "node_modules/execa/lib/terminate/timeout.js"() {
    import_promises4 = require("node:timers/promises");
    init_final_error();
    validateTimeout = ({ timeout }) => {
      if (timeout !== void 0 && (!Number.isFinite(timeout) || timeout < 0)) {
        throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${timeout}\` (${typeof timeout})`);
      }
    };
    throwOnTimeout = (subprocess, timeout, context, controller) => timeout === 0 || timeout === void 0 ? [] : [killAfterTimeout(subprocess, timeout, context, controller)];
    killAfterTimeout = async (subprocess, timeout, context, { signal }) => {
      await (0, import_promises4.setTimeout)(timeout, void 0, { signal });
      context.terminationReason ??= "timeout";
      subprocess.kill();
      throw new DiscardedError();
    };
  }
});

// node_modules/execa/lib/methods/node.js
var import_node_process6, import_node_path8, mapNode, handleNodeOption;
var init_node2 = __esm({
  "node_modules/execa/lib/methods/node.js"() {
    import_node_process6 = require("node:process");
    import_node_path8 = __toESM(require("node:path"), 1);
    init_file_url();
    mapNode = ({ options }) => {
      if (options.node === false) {
        throw new TypeError('The "node" option cannot be false with `execaNode()`.');
      }
      return { options: { ...options, node: true } };
    };
    handleNodeOption = (file, commandArguments, {
      node: shouldHandleNode = false,
      nodePath = import_node_process6.execPath,
      nodeOptions = import_node_process6.execArgv.filter((nodeOption) => !nodeOption.startsWith("--inspect")),
      cwd,
      execPath: formerNodePath,
      ...options
    }) => {
      if (formerNodePath !== void 0) {
        throw new TypeError('The "execPath" option has been removed. Please use the "nodePath" option instead.');
      }
      const normalizedNodePath = safeNormalizeFileUrl(nodePath, 'The "nodePath" option');
      const resolvedNodePath = import_node_path8.default.resolve(cwd, normalizedNodePath);
      const newOptions = {
        ...options,
        nodePath: resolvedNodePath,
        node: shouldHandleNode,
        cwd
      };
      if (!shouldHandleNode) {
        return [file, commandArguments, newOptions];
      }
      if (import_node_path8.default.basename(file, ".exe") === "node") {
        throw new TypeError('When the "node" option is true, the first argument does not need to be "node".');
      }
      return [
        resolvedNodePath,
        [...nodeOptions, file, ...commandArguments],
        { ipc: true, ...newOptions, shell: false }
      ];
    };
  }
});

// node_modules/execa/lib/ipc/ipc-input.js
var import_node_v8, validateIpcInputOption, validateAdvancedInput, validateJsonInput, validateIpcInput, sendIpcInput;
var init_ipc_input = __esm({
  "node_modules/execa/lib/ipc/ipc-input.js"() {
    import_node_v8 = require("node:v8");
    validateIpcInputOption = ({ ipcInput, ipc, serialization }) => {
      if (ipcInput === void 0) {
        return;
      }
      if (!ipc) {
        throw new Error("The `ipcInput` option cannot be set unless the `ipc` option is `true`.");
      }
      validateIpcInput[serialization](ipcInput);
    };
    validateAdvancedInput = (ipcInput) => {
      try {
        (0, import_node_v8.serialize)(ipcInput);
      } catch (error) {
        throw new Error("The `ipcInput` option is not serializable with a structured clone.", { cause: error });
      }
    };
    validateJsonInput = (ipcInput) => {
      try {
        JSON.stringify(ipcInput);
      } catch (error) {
        throw new Error("The `ipcInput` option is not serializable with JSON.", { cause: error });
      }
    };
    validateIpcInput = {
      advanced: validateAdvancedInput,
      json: validateJsonInput
    };
    sendIpcInput = async (subprocess, ipcInput) => {
      if (ipcInput === void 0) {
        return;
      }
      await subprocess.sendMessage(ipcInput);
    };
  }
});

// node_modules/execa/lib/arguments/encoding-option.js
var validateEncoding, TEXT_ENCODINGS, BINARY_ENCODINGS, ENCODINGS, getCorrectEncoding, ENCODING_ALIASES, serializeEncoding;
var init_encoding_option = __esm({
  "node_modules/execa/lib/arguments/encoding-option.js"() {
    validateEncoding = ({ encoding }) => {
      if (ENCODINGS.has(encoding)) {
        return;
      }
      const correctEncoding = getCorrectEncoding(encoding);
      if (correctEncoding !== void 0) {
        throw new TypeError(`Invalid option \`encoding: ${serializeEncoding(encoding)}\`.
Please rename it to ${serializeEncoding(correctEncoding)}.`);
      }
      const correctEncodings = [...ENCODINGS].map((correctEncoding2) => serializeEncoding(correctEncoding2)).join(", ");
      throw new TypeError(`Invalid option \`encoding: ${serializeEncoding(encoding)}\`.
Please rename it to one of: ${correctEncodings}.`);
    };
    TEXT_ENCODINGS = /* @__PURE__ */ new Set(["utf8", "utf16le"]);
    BINARY_ENCODINGS = /* @__PURE__ */ new Set(["buffer", "hex", "base64", "base64url", "latin1", "ascii"]);
    ENCODINGS = /* @__PURE__ */ new Set([...TEXT_ENCODINGS, ...BINARY_ENCODINGS]);
    getCorrectEncoding = (encoding) => {
      if (encoding === null) {
        return "buffer";
      }
      if (typeof encoding !== "string") {
        return;
      }
      const lowerEncoding = encoding.toLowerCase();
      if (lowerEncoding in ENCODING_ALIASES) {
        return ENCODING_ALIASES[lowerEncoding];
      }
      if (ENCODINGS.has(lowerEncoding)) {
        return lowerEncoding;
      }
    };
    ENCODING_ALIASES = {
      // eslint-disable-next-line unicorn/text-encoding-identifier-case
      "utf-8": "utf8",
      "utf-16le": "utf16le",
      "ucs-2": "utf16le",
      ucs2: "utf16le",
      binary: "latin1"
    };
    serializeEncoding = (encoding) => typeof encoding === "string" ? `"${encoding}"` : String(encoding);
  }
});

// node_modules/execa/lib/arguments/cwd.js
var import_node_fs8, import_node_path9, import_node_process7, normalizeCwd, getDefaultCwd, fixCwdError;
var init_cwd = __esm({
  "node_modules/execa/lib/arguments/cwd.js"() {
    import_node_fs8 = require("node:fs");
    import_node_path9 = __toESM(require("node:path"), 1);
    import_node_process7 = __toESM(require("node:process"), 1);
    init_file_url();
    normalizeCwd = (cwd = getDefaultCwd()) => {
      const cwdString = safeNormalizeFileUrl(cwd, 'The "cwd" option');
      return import_node_path9.default.resolve(cwdString);
    };
    getDefaultCwd = () => {
      try {
        return import_node_process7.default.cwd();
      } catch (error) {
        error.message = `The current directory does not exist.
${error.message}`;
        throw error;
      }
    };
    fixCwdError = (originalMessage, cwd) => {
      if (cwd === getDefaultCwd()) {
        return originalMessage;
      }
      let cwdStat;
      try {
        cwdStat = (0, import_node_fs8.statSync)(cwd);
      } catch (error) {
        return `The "cwd" option is invalid: ${cwd}.
${error.message}
${originalMessage}`;
      }
      if (!cwdStat.isDirectory()) {
        return `The "cwd" option is not a directory: ${cwd}.
${originalMessage}`;
      }
      return originalMessage;
    };
  }
});

// node_modules/execa/lib/arguments/options.js
var import_node_path10, import_node_process8, import_cross_spawn, normalizeOptions, addDefaultOptions, getEnv;
var init_options = __esm({
  "node_modules/execa/lib/arguments/options.js"() {
    import_node_path10 = __toESM(require("node:path"), 1);
    import_node_process8 = __toESM(require("node:process"), 1);
    import_cross_spawn = __toESM(require_cross_spawn(), 1);
    init_npm_run_path();
    init_kill();
    init_signal();
    init_cancel();
    init_graceful2();
    init_timeout();
    init_node2();
    init_ipc_input();
    init_encoding_option();
    init_cwd();
    init_file_url();
    init_specific();
    normalizeOptions = (filePath, rawArguments, rawOptions) => {
      rawOptions.cwd = normalizeCwd(rawOptions.cwd);
      const [processedFile, processedArguments, processedOptions] = handleNodeOption(filePath, rawArguments, rawOptions);
      const { command: file, args: commandArguments, options: initialOptions } = import_cross_spawn.default._parse(processedFile, processedArguments, processedOptions);
      const fdOptions = normalizeFdSpecificOptions(initialOptions);
      const options = addDefaultOptions(fdOptions);
      validateTimeout(options);
      validateEncoding(options);
      validateIpcInputOption(options);
      validateCancelSignal(options);
      validateGracefulCancel(options);
      options.shell = normalizeFileUrl(options.shell);
      options.env = getEnv(options);
      options.killSignal = normalizeKillSignal(options.killSignal);
      options.forceKillAfterDelay = normalizeForceKillAfterDelay(options.forceKillAfterDelay);
      options.lines = options.lines.map((lines, fdNumber) => lines && !BINARY_ENCODINGS.has(options.encoding) && options.buffer[fdNumber]);
      if (import_node_process8.default.platform === "win32" && import_node_path10.default.basename(file, ".exe") === "cmd") {
        commandArguments.unshift("/q");
      }
      return { file, commandArguments, options };
    };
    addDefaultOptions = ({
      extendEnv = true,
      preferLocal = false,
      cwd,
      localDir: localDirectory = cwd,
      encoding = "utf8",
      reject = true,
      cleanup = true,
      all = false,
      windowsHide = true,
      killSignal = "SIGTERM",
      forceKillAfterDelay = true,
      gracefulCancel = false,
      ipcInput,
      ipc = ipcInput !== void 0 || gracefulCancel,
      serialization = "advanced",
      ...options
    }) => ({
      ...options,
      extendEnv,
      preferLocal,
      cwd,
      localDirectory,
      encoding,
      reject,
      cleanup,
      all,
      windowsHide,
      killSignal,
      forceKillAfterDelay,
      gracefulCancel,
      ipcInput,
      ipc,
      serialization
    });
    getEnv = ({ env: envOption, extendEnv, preferLocal, node, localDirectory, nodePath }) => {
      const env = extendEnv ? { ...import_node_process8.default.env, ...envOption } : envOption;
      if (preferLocal || node) {
        return npmRunPathEnv({
          env,
          cwd: localDirectory,
          execPath: nodePath,
          preferLocal,
          addExecPath: node
        });
      }
      return env;
    };
  }
});

// node_modules/execa/lib/arguments/shell.js
var concatenateShell;
var init_shell = __esm({
  "node_modules/execa/lib/arguments/shell.js"() {
    concatenateShell = (file, commandArguments, options) => options.shell && commandArguments.length > 0 ? [[file, ...commandArguments].join(" "), [], options] : [file, commandArguments, options];
  }
});

// node_modules/strip-final-newline/index.js
function stripFinalNewline(input) {
  if (typeof input === "string") {
    return stripFinalNewlineString(input);
  }
  if (!(ArrayBuffer.isView(input) && input.BYTES_PER_ELEMENT === 1)) {
    throw new Error("Input must be a string or a Uint8Array");
  }
  return stripFinalNewlineBinary(input);
}
var stripFinalNewlineString, stripFinalNewlineBinary, LF, LF_BINARY, CR, CR_BINARY;
var init_strip_final_newline = __esm({
  "node_modules/strip-final-newline/index.js"() {
    stripFinalNewlineString = (input) => input.at(-1) === LF ? input.slice(0, input.at(-2) === CR ? -2 : -1) : input;
    stripFinalNewlineBinary = (input) => input.at(-1) === LF_BINARY ? input.subarray(0, input.at(-2) === CR_BINARY ? -2 : -1) : input;
    LF = "\n";
    LF_BINARY = LF.codePointAt(0);
    CR = "\r";
    CR_BINARY = CR.codePointAt(0);
  }
});

// node_modules/is-stream/index.js
function isStream(stream, { checkOpen = true } = {}) {
  return stream !== null && typeof stream === "object" && (stream.writable || stream.readable || !checkOpen || stream.writable === void 0 && stream.readable === void 0) && typeof stream.pipe === "function";
}
function isWritableStream(stream, { checkOpen = true } = {}) {
  return isStream(stream, { checkOpen }) && (stream.writable || !checkOpen) && typeof stream.write === "function" && typeof stream.end === "function" && typeof stream.writable === "boolean" && typeof stream.writableObjectMode === "boolean" && typeof stream.destroy === "function" && typeof stream.destroyed === "boolean";
}
function isReadableStream(stream, { checkOpen = true } = {}) {
  return isStream(stream, { checkOpen }) && (stream.readable || !checkOpen) && typeof stream.read === "function" && typeof stream.readable === "boolean" && typeof stream.readableObjectMode === "boolean" && typeof stream.destroy === "function" && typeof stream.destroyed === "boolean";
}
function isDuplexStream(stream, options) {
  return isWritableStream(stream, options) && isReadableStream(stream, options);
}
var init_is_stream = __esm({
  "node_modules/is-stream/index.js"() {
  }
});

// node_modules/@sec-ant/readable-stream/dist/ponyfill/asyncIterator.js
function i() {
  return this[n].next();
}
function o(r) {
  return this[n].return(r);
}
function h({ preventCancel: r = false } = {}) {
  const e = this.getReader(), t = new c(
    e,
    r
  ), s = Object.create(u);
  return s[n] = t, s;
}
var a, c, n, u;
var init_asyncIterator = __esm({
  "node_modules/@sec-ant/readable-stream/dist/ponyfill/asyncIterator.js"() {
    a = Object.getPrototypeOf(
      Object.getPrototypeOf(
        /* istanbul ignore next */
        async function* () {
        }
      ).prototype
    );
    c = class {
      #t;
      #n;
      #r = false;
      #e = void 0;
      constructor(e, t) {
        this.#t = e, this.#n = t;
      }
      next() {
        const e = () => this.#s();
        return this.#e = this.#e ? this.#e.then(e, e) : e(), this.#e;
      }
      return(e) {
        const t = () => this.#i(e);
        return this.#e ? this.#e.then(t, t) : t();
      }
      async #s() {
        if (this.#r)
          return {
            done: true,
            value: void 0
          };
        let e;
        try {
          e = await this.#t.read();
        } catch (t) {
          throw this.#e = void 0, this.#r = true, this.#t.releaseLock(), t;
        }
        return e.done && (this.#e = void 0, this.#r = true, this.#t.releaseLock()), e;
      }
      async #i(e) {
        if (this.#r)
          return {
            done: true,
            value: e
          };
        if (this.#r = true, !this.#n) {
          const t = this.#t.cancel(e);
          return this.#t.releaseLock(), await t, {
            done: true,
            value: e
          };
        }
        return this.#t.releaseLock(), {
          done: true,
          value: e
        };
      }
    };
    n = Symbol();
    Object.defineProperty(i, "name", { value: "next" });
    Object.defineProperty(o, "name", { value: "return" });
    u = Object.create(a, {
      next: {
        enumerable: true,
        configurable: true,
        writable: true,
        value: i
      },
      return: {
        enumerable: true,
        configurable: true,
        writable: true,
        value: o
      }
    });
  }
});

// node_modules/@sec-ant/readable-stream/dist/ponyfill/fromAnyIterable.js
var init_fromAnyIterable = __esm({
  "node_modules/@sec-ant/readable-stream/dist/ponyfill/fromAnyIterable.js"() {
  }
});

// node_modules/@sec-ant/readable-stream/dist/ponyfill/index.js
var init_ponyfill = __esm({
  "node_modules/@sec-ant/readable-stream/dist/ponyfill/index.js"() {
    init_asyncIterator();
    init_fromAnyIterable();
  }
});

// node_modules/get-stream/source/stream.js
var getAsyncIterable, toString, getStreamIterable, handleStreamEnd, nodeImports;
var init_stream = __esm({
  "node_modules/get-stream/source/stream.js"() {
    init_is_stream();
    init_ponyfill();
    getAsyncIterable = (stream) => {
      if (isReadableStream(stream, { checkOpen: false }) && nodeImports.on !== void 0) {
        return getStreamIterable(stream);
      }
      if (typeof stream?.[Symbol.asyncIterator] === "function") {
        return stream;
      }
      if (toString.call(stream) === "[object ReadableStream]") {
        return h.call(stream);
      }
      throw new TypeError("The first argument must be a Readable, a ReadableStream, or an async iterable.");
    };
    ({ toString } = Object.prototype);
    getStreamIterable = async function* (stream) {
      const controller = new AbortController();
      const state = {};
      handleStreamEnd(stream, controller, state);
      try {
        for await (const [chunk] of nodeImports.on(stream, "data", { signal: controller.signal })) {
          yield chunk;
        }
      } catch (error) {
        if (state.error !== void 0) {
          throw state.error;
        } else if (!controller.signal.aborted) {
          throw error;
        }
      } finally {
        stream.destroy();
      }
    };
    handleStreamEnd = async (stream, controller, state) => {
      try {
        await nodeImports.finished(stream, {
          cleanup: true,
          readable: true,
          writable: false,
          error: false
        });
      } catch (error) {
        state.error = error;
      } finally {
        controller.abort();
      }
    };
    nodeImports = {};
  }
});

// node_modules/get-stream/source/contents.js
var getStreamContents, appendFinalChunk, appendChunk, addNewChunk, getChunkType, objectToString2, MaxBufferError;
var init_contents = __esm({
  "node_modules/get-stream/source/contents.js"() {
    init_stream();
    getStreamContents = async (stream, { init, convertChunk, getSize, truncateChunk, addChunk, getFinalChunk, finalize }, { maxBuffer = Number.POSITIVE_INFINITY } = {}) => {
      const asyncIterable = getAsyncIterable(stream);
      const state = init();
      state.length = 0;
      try {
        for await (const chunk of asyncIterable) {
          const chunkType = getChunkType(chunk);
          const convertedChunk = convertChunk[chunkType](chunk, state);
          appendChunk({
            convertedChunk,
            state,
            getSize,
            truncateChunk,
            addChunk,
            maxBuffer
          });
        }
        appendFinalChunk({
          state,
          convertChunk,
          getSize,
          truncateChunk,
          addChunk,
          getFinalChunk,
          maxBuffer
        });
        return finalize(state);
      } catch (error) {
        const normalizedError = typeof error === "object" && error !== null ? error : new Error(error);
        normalizedError.bufferedData = finalize(state);
        throw normalizedError;
      }
    };
    appendFinalChunk = ({ state, getSize, truncateChunk, addChunk, getFinalChunk, maxBuffer }) => {
      const convertedChunk = getFinalChunk(state);
      if (convertedChunk !== void 0) {
        appendChunk({
          convertedChunk,
          state,
          getSize,
          truncateChunk,
          addChunk,
          maxBuffer
        });
      }
    };
    appendChunk = ({ convertedChunk, state, getSize, truncateChunk, addChunk, maxBuffer }) => {
      const chunkSize = getSize(convertedChunk);
      const newLength = state.length + chunkSize;
      if (newLength <= maxBuffer) {
        addNewChunk(convertedChunk, state, addChunk, newLength);
        return;
      }
      const truncatedChunk = truncateChunk(convertedChunk, maxBuffer - state.length);
      if (truncatedChunk !== void 0) {
        addNewChunk(truncatedChunk, state, addChunk, maxBuffer);
      }
      throw new MaxBufferError();
    };
    addNewChunk = (convertedChunk, state, addChunk, newLength) => {
      state.contents = addChunk(convertedChunk, state, newLength);
      state.length = newLength;
    };
    getChunkType = (chunk) => {
      const typeOfChunk = typeof chunk;
      if (typeOfChunk === "string") {
        return "string";
      }
      if (typeOfChunk !== "object" || chunk === null) {
        return "others";
      }
      if (globalThis.Buffer?.isBuffer(chunk)) {
        return "buffer";
      }
      const prototypeName = objectToString2.call(chunk);
      if (prototypeName === "[object ArrayBuffer]") {
        return "arrayBuffer";
      }
      if (prototypeName === "[object DataView]") {
        return "dataView";
      }
      if (Number.isInteger(chunk.byteLength) && Number.isInteger(chunk.byteOffset) && objectToString2.call(chunk.buffer) === "[object ArrayBuffer]") {
        return "typedArray";
      }
      return "others";
    };
    ({ toString: objectToString2 } = Object.prototype);
    MaxBufferError = class extends Error {
      name = "MaxBufferError";
      constructor() {
        super("maxBuffer exceeded");
      }
    };
  }
});

// node_modules/get-stream/source/utils.js
var identity2, noop, getContentsProperty, throwObjectStream, getLengthProperty;
var init_utils = __esm({
  "node_modules/get-stream/source/utils.js"() {
    identity2 = (value) => value;
    noop = () => void 0;
    getContentsProperty = ({ contents }) => contents;
    throwObjectStream = (chunk) => {
      throw new Error(`Streams in object mode are not supported: ${String(chunk)}`);
    };
    getLengthProperty = (convertedChunk) => convertedChunk.length;
  }
});

// node_modules/get-stream/source/array.js
async function getStreamAsArray(stream, options) {
  return getStreamContents(stream, arrayMethods, options);
}
var initArray, increment, addArrayChunk, arrayMethods;
var init_array = __esm({
  "node_modules/get-stream/source/array.js"() {
    init_contents();
    init_utils();
    initArray = () => ({ contents: [] });
    increment = () => 1;
    addArrayChunk = (convertedChunk, { contents }) => {
      contents.push(convertedChunk);
      return contents;
    };
    arrayMethods = {
      init: initArray,
      convertChunk: {
        string: identity2,
        buffer: identity2,
        arrayBuffer: identity2,
        dataView: identity2,
        typedArray: identity2,
        others: identity2
      },
      getSize: increment,
      truncateChunk: noop,
      addChunk: addArrayChunk,
      getFinalChunk: noop,
      finalize: getContentsProperty
    };
  }
});

// node_modules/get-stream/source/array-buffer.js
async function getStreamAsArrayBuffer(stream, options) {
  return getStreamContents(stream, arrayBufferMethods, options);
}
var initArrayBuffer, useTextEncoder, textEncoder2, useUint8Array, useUint8ArrayWithOffset, truncateArrayBufferChunk, addArrayBufferChunk, resizeArrayBufferSlow, resizeArrayBuffer, getNewContentsLength, SCALE_FACTOR, finalizeArrayBuffer, hasArrayBufferResize, arrayBufferMethods;
var init_array_buffer = __esm({
  "node_modules/get-stream/source/array-buffer.js"() {
    init_contents();
    init_utils();
    initArrayBuffer = () => ({ contents: new ArrayBuffer(0) });
    useTextEncoder = (chunk) => textEncoder2.encode(chunk);
    textEncoder2 = new TextEncoder();
    useUint8Array = (chunk) => new Uint8Array(chunk);
    useUint8ArrayWithOffset = (chunk) => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    truncateArrayBufferChunk = (convertedChunk, chunkSize) => convertedChunk.slice(0, chunkSize);
    addArrayBufferChunk = (convertedChunk, { contents, length: previousLength }, length) => {
      const newContents = hasArrayBufferResize() ? resizeArrayBuffer(contents, length) : resizeArrayBufferSlow(contents, length);
      new Uint8Array(newContents).set(convertedChunk, previousLength);
      return newContents;
    };
    resizeArrayBufferSlow = (contents, length) => {
      if (length <= contents.byteLength) {
        return contents;
      }
      const arrayBuffer = new ArrayBuffer(getNewContentsLength(length));
      new Uint8Array(arrayBuffer).set(new Uint8Array(contents), 0);
      return arrayBuffer;
    };
    resizeArrayBuffer = (contents, length) => {
      if (length <= contents.maxByteLength) {
        contents.resize(length);
        return contents;
      }
      const arrayBuffer = new ArrayBuffer(length, { maxByteLength: getNewContentsLength(length) });
      new Uint8Array(arrayBuffer).set(new Uint8Array(contents), 0);
      return arrayBuffer;
    };
    getNewContentsLength = (length) => SCALE_FACTOR ** Math.ceil(Math.log(length) / Math.log(SCALE_FACTOR));
    SCALE_FACTOR = 2;
    finalizeArrayBuffer = ({ contents, length }) => hasArrayBufferResize() ? contents : contents.slice(0, length);
    hasArrayBufferResize = () => "resize" in ArrayBuffer.prototype;
    arrayBufferMethods = {
      init: initArrayBuffer,
      convertChunk: {
        string: useTextEncoder,
        buffer: useUint8Array,
        arrayBuffer: useUint8Array,
        dataView: useUint8ArrayWithOffset,
        typedArray: useUint8ArrayWithOffset,
        others: throwObjectStream
      },
      getSize: getLengthProperty,
      truncateChunk: truncateArrayBufferChunk,
      addChunk: addArrayBufferChunk,
      getFinalChunk: noop,
      finalize: finalizeArrayBuffer
    };
  }
});

// node_modules/get-stream/source/string.js
async function getStreamAsString(stream, options) {
  return getStreamContents(stream, stringMethods, options);
}
var initString, useTextDecoder, addStringChunk, truncateStringChunk, getFinalStringChunk, stringMethods;
var init_string = __esm({
  "node_modules/get-stream/source/string.js"() {
    init_contents();
    init_utils();
    initString = () => ({ contents: "", textDecoder: new TextDecoder() });
    useTextDecoder = (chunk, { textDecoder: textDecoder2 }) => textDecoder2.decode(chunk, { stream: true });
    addStringChunk = (convertedChunk, { contents }) => contents + convertedChunk;
    truncateStringChunk = (convertedChunk, chunkSize) => convertedChunk.slice(0, chunkSize);
    getFinalStringChunk = ({ textDecoder: textDecoder2 }) => {
      const finalChunk = textDecoder2.decode();
      return finalChunk === "" ? void 0 : finalChunk;
    };
    stringMethods = {
      init: initString,
      convertChunk: {
        string: identity2,
        buffer: useTextDecoder,
        arrayBuffer: useTextDecoder,
        dataView: useTextDecoder,
        typedArray: useTextDecoder,
        others: throwObjectStream
      },
      getSize: getLengthProperty,
      truncateChunk: truncateStringChunk,
      addChunk: addStringChunk,
      getFinalChunk: getFinalStringChunk,
      finalize: getContentsProperty
    };
  }
});

// node_modules/get-stream/source/exports.js
var init_exports = __esm({
  "node_modules/get-stream/source/exports.js"() {
    init_array();
    init_array_buffer();
    init_string();
    init_contents();
  }
});

// node_modules/get-stream/source/index.js
var import_node_events6, import_promises5;
var init_source = __esm({
  "node_modules/get-stream/source/index.js"() {
    import_node_events6 = require("node:events");
    import_promises5 = require("node:stream/promises");
    init_stream();
    init_exports();
    Object.assign(nodeImports, { on: import_node_events6.on, finished: import_promises5.finished });
  }
});

// node_modules/execa/lib/io/max-buffer.js
var handleMaxBuffer, getMaxBufferUnit, checkIpcMaxBuffer, getMaxBufferMessage, getMaxBufferInfo, isMaxBufferSync, truncateMaxBufferSync, getMaxBufferSync;
var init_max_buffer = __esm({
  "node_modules/execa/lib/io/max-buffer.js"() {
    init_source();
    init_standard_stream();
    init_specific();
    handleMaxBuffer = ({ error, stream, readableObjectMode, lines, encoding, fdNumber }) => {
      if (!(error instanceof MaxBufferError)) {
        throw error;
      }
      if (fdNumber === "all") {
        return error;
      }
      const unit = getMaxBufferUnit(readableObjectMode, lines, encoding);
      error.maxBufferInfo = { fdNumber, unit };
      stream.destroy();
      throw error;
    };
    getMaxBufferUnit = (readableObjectMode, lines, encoding) => {
      if (readableObjectMode) {
        return "objects";
      }
      if (lines) {
        return "lines";
      }
      if (encoding === "buffer") {
        return "bytes";
      }
      return "characters";
    };
    checkIpcMaxBuffer = (subprocess, ipcOutput, maxBuffer) => {
      if (ipcOutput.length !== maxBuffer) {
        return;
      }
      const error = new MaxBufferError();
      error.maxBufferInfo = { fdNumber: "ipc" };
      throw error;
    };
    getMaxBufferMessage = (error, maxBuffer) => {
      const { streamName, threshold, unit } = getMaxBufferInfo(error, maxBuffer);
      return `Command's ${streamName} was larger than ${threshold} ${unit}`;
    };
    getMaxBufferInfo = (error, maxBuffer) => {
      if (error?.maxBufferInfo === void 0) {
        return { streamName: "output", threshold: maxBuffer[1], unit: "bytes" };
      }
      const { maxBufferInfo: { fdNumber, unit } } = error;
      delete error.maxBufferInfo;
      const threshold = getFdSpecificValue(maxBuffer, fdNumber);
      if (fdNumber === "ipc") {
        return { streamName: "IPC output", threshold, unit: "messages" };
      }
      return { streamName: getStreamName(fdNumber), threshold, unit };
    };
    isMaxBufferSync = (resultError, output, maxBuffer) => resultError?.code === "ENOBUFS" && output !== null && output.some((result) => result !== null && result.length > getMaxBufferSync(maxBuffer));
    truncateMaxBufferSync = (result, isMaxBuffer, maxBuffer) => {
      if (!isMaxBuffer) {
        return result;
      }
      const maxBufferValue = getMaxBufferSync(maxBuffer);
      return result.length > maxBufferValue ? result.slice(0, maxBufferValue) : result;
    };
    getMaxBufferSync = ([, stdoutMaxBuffer]) => stdoutMaxBuffer;
  }
});

// node_modules/execa/lib/return/message.js
var import_node_util6, createMessages, getErrorPrefix, getForcefulSuffix, getOriginalMessage, serializeIpcMessage, serializeMessagePart, serializeMessageItem;
var init_message = __esm({
  "node_modules/execa/lib/return/message.js"() {
    import_node_util6 = require("node:util");
    init_strip_final_newline();
    init_uint_array();
    init_cwd();
    init_escape();
    init_max_buffer();
    init_signal();
    init_final_error();
    createMessages = ({
      stdio,
      all,
      ipcOutput,
      originalError,
      signal,
      signalDescription,
      exitCode,
      escapedCommand,
      timedOut,
      isCanceled,
      isGracefullyCanceled,
      isMaxBuffer,
      isForcefullyTerminated,
      forceKillAfterDelay,
      killSignal,
      maxBuffer,
      timeout,
      cwd
    }) => {
      const errorCode = originalError?.code;
      const prefix = getErrorPrefix({
        originalError,
        timedOut,
        timeout,
        isMaxBuffer,
        maxBuffer,
        errorCode,
        signal,
        signalDescription,
        exitCode,
        isCanceled,
        isGracefullyCanceled,
        isForcefullyTerminated,
        forceKillAfterDelay,
        killSignal
      });
      const originalMessage = getOriginalMessage(originalError, cwd);
      const suffix = originalMessage === void 0 ? "" : `
${originalMessage}`;
      const shortMessage = `${prefix}: ${escapedCommand}${suffix}`;
      const messageStdio = all === void 0 ? [stdio[2], stdio[1]] : [all];
      const message = [
        shortMessage,
        ...messageStdio,
        ...stdio.slice(3),
        ipcOutput.map((ipcMessage) => serializeIpcMessage(ipcMessage)).join("\n")
      ].map((messagePart) => escapeLines(stripFinalNewline(serializeMessagePart(messagePart)))).filter(Boolean).join("\n\n");
      return { originalMessage, shortMessage, message };
    };
    getErrorPrefix = ({
      originalError,
      timedOut,
      timeout,
      isMaxBuffer,
      maxBuffer,
      errorCode,
      signal,
      signalDescription,
      exitCode,
      isCanceled,
      isGracefullyCanceled,
      isForcefullyTerminated,
      forceKillAfterDelay,
      killSignal
    }) => {
      const forcefulSuffix = getForcefulSuffix(isForcefullyTerminated, forceKillAfterDelay);
      if (timedOut) {
        return `Command timed out after ${timeout} milliseconds${forcefulSuffix}`;
      }
      if (isGracefullyCanceled) {
        if (signal === void 0) {
          return `Command was gracefully canceled with exit code ${exitCode}`;
        }
        return isForcefullyTerminated ? `Command was gracefully canceled${forcefulSuffix}` : `Command was gracefully canceled with ${signal} (${signalDescription})`;
      }
      if (isCanceled) {
        return `Command was canceled${forcefulSuffix}`;
      }
      if (isMaxBuffer) {
        return `${getMaxBufferMessage(originalError, maxBuffer)}${forcefulSuffix}`;
      }
      if (errorCode !== void 0) {
        return `Command failed with ${errorCode}${forcefulSuffix}`;
      }
      if (isForcefullyTerminated) {
        return `Command was killed with ${killSignal} (${getSignalDescription(killSignal)})${forcefulSuffix}`;
      }
      if (signal !== void 0) {
        return `Command was killed with ${signal} (${signalDescription})`;
      }
      if (exitCode !== void 0) {
        return `Command failed with exit code ${exitCode}`;
      }
      return "Command failed";
    };
    getForcefulSuffix = (isForcefullyTerminated, forceKillAfterDelay) => isForcefullyTerminated ? ` and was forcefully terminated after ${forceKillAfterDelay} milliseconds` : "";
    getOriginalMessage = (originalError, cwd) => {
      if (originalError instanceof DiscardedError) {
        return;
      }
      const originalMessage = isExecaError(originalError) ? originalError.originalMessage : String(originalError?.message ?? originalError);
      const escapedOriginalMessage = escapeLines(fixCwdError(originalMessage, cwd));
      return escapedOriginalMessage === "" ? void 0 : escapedOriginalMessage;
    };
    serializeIpcMessage = (ipcMessage) => typeof ipcMessage === "string" ? ipcMessage : (0, import_node_util6.inspect)(ipcMessage);
    serializeMessagePart = (messagePart) => Array.isArray(messagePart) ? messagePart.map((messageItem) => stripFinalNewline(serializeMessageItem(messageItem))).filter(Boolean).join("\n") : serializeMessageItem(messagePart);
    serializeMessageItem = (messageItem) => {
      if (typeof messageItem === "string") {
        return messageItem;
      }
      if (isUint8Array(messageItem)) {
        return uint8ArrayToString(messageItem);
      }
      return "";
    };
  }
});

// node_modules/execa/lib/return/result.js
var makeSuccessResult, makeEarlyError, makeError, getErrorProperties, omitUndefinedProperties, normalizeExitPayload;
var init_result = __esm({
  "node_modules/execa/lib/return/result.js"() {
    init_signal();
    init_duration();
    init_final_error();
    init_message();
    makeSuccessResult = ({
      command,
      escapedCommand,
      stdio,
      all,
      ipcOutput,
      options: { cwd },
      startTime
    }) => omitUndefinedProperties({
      command,
      escapedCommand,
      cwd,
      durationMs: getDurationMs(startTime),
      failed: false,
      timedOut: false,
      isCanceled: false,
      isGracefullyCanceled: false,
      isTerminated: false,
      isMaxBuffer: false,
      isForcefullyTerminated: false,
      exitCode: 0,
      stdout: stdio[1],
      stderr: stdio[2],
      all,
      stdio,
      ipcOutput,
      pipedFrom: []
    });
    makeEarlyError = ({
      error,
      command,
      escapedCommand,
      fileDescriptors,
      options,
      startTime,
      isSync
    }) => makeError({
      error,
      command,
      escapedCommand,
      startTime,
      timedOut: false,
      isCanceled: false,
      isGracefullyCanceled: false,
      isMaxBuffer: false,
      isForcefullyTerminated: false,
      stdio: Array.from({ length: fileDescriptors.length }),
      ipcOutput: [],
      options,
      isSync
    });
    makeError = ({
      error: originalError,
      command,
      escapedCommand,
      startTime,
      timedOut,
      isCanceled,
      isGracefullyCanceled,
      isMaxBuffer,
      isForcefullyTerminated,
      exitCode: rawExitCode,
      signal: rawSignal,
      stdio,
      all,
      ipcOutput,
      options: {
        timeoutDuration,
        timeout = timeoutDuration,
        forceKillAfterDelay,
        killSignal,
        cwd,
        maxBuffer
      },
      isSync
    }) => {
      const { exitCode, signal, signalDescription } = normalizeExitPayload(rawExitCode, rawSignal);
      const { originalMessage, shortMessage, message } = createMessages({
        stdio,
        all,
        ipcOutput,
        originalError,
        signal,
        signalDescription,
        exitCode,
        escapedCommand,
        timedOut,
        isCanceled,
        isGracefullyCanceled,
        isMaxBuffer,
        isForcefullyTerminated,
        forceKillAfterDelay,
        killSignal,
        maxBuffer,
        timeout,
        cwd
      });
      const error = getFinalError(originalError, message, isSync);
      Object.assign(error, getErrorProperties({
        error,
        command,
        escapedCommand,
        startTime,
        timedOut,
        isCanceled,
        isGracefullyCanceled,
        isMaxBuffer,
        isForcefullyTerminated,
        exitCode,
        signal,
        signalDescription,
        stdio,
        all,
        ipcOutput,
        cwd,
        originalMessage,
        shortMessage
      }));
      return error;
    };
    getErrorProperties = ({
      error,
      command,
      escapedCommand,
      startTime,
      timedOut,
      isCanceled,
      isGracefullyCanceled,
      isMaxBuffer,
      isForcefullyTerminated,
      exitCode,
      signal,
      signalDescription,
      stdio,
      all,
      ipcOutput,
      cwd,
      originalMessage,
      shortMessage
    }) => omitUndefinedProperties({
      shortMessage,
      originalMessage,
      command,
      escapedCommand,
      cwd,
      durationMs: getDurationMs(startTime),
      failed: true,
      timedOut,
      isCanceled,
      isGracefullyCanceled,
      isTerminated: signal !== void 0,
      isMaxBuffer,
      isForcefullyTerminated,
      exitCode,
      signal,
      signalDescription,
      code: error.cause?.code,
      stdout: stdio[1],
      stderr: stdio[2],
      all,
      stdio,
      ipcOutput,
      pipedFrom: []
    });
    omitUndefinedProperties = (result) => Object.fromEntries(Object.entries(result).filter(([, value]) => value !== void 0));
    normalizeExitPayload = (rawExitCode, rawSignal) => {
      const exitCode = rawExitCode === null ? void 0 : rawExitCode;
      const signal = rawSignal === null ? void 0 : rawSignal;
      const signalDescription = signal === void 0 ? void 0 : getSignalDescription(rawSignal);
      return { exitCode, signal, signalDescription };
    };
  }
});

// node_modules/parse-ms/index.js
function parseNumber(milliseconds) {
  return {
    days: Math.trunc(milliseconds / 864e5),
    hours: Math.trunc(milliseconds / 36e5 % 24),
    minutes: Math.trunc(milliseconds / 6e4 % 60),
    seconds: Math.trunc(milliseconds / 1e3 % 60),
    milliseconds: Math.trunc(milliseconds % 1e3),
    microseconds: Math.trunc(toZeroIfInfinity(milliseconds * 1e3) % 1e3),
    nanoseconds: Math.trunc(toZeroIfInfinity(milliseconds * 1e6) % 1e3)
  };
}
function parseBigint(milliseconds) {
  return {
    days: milliseconds / 86400000n,
    hours: milliseconds / 3600000n % 24n,
    minutes: milliseconds / 60000n % 60n,
    seconds: milliseconds / 1000n % 60n,
    milliseconds: milliseconds % 1000n,
    microseconds: 0n,
    nanoseconds: 0n
  };
}
function parseMilliseconds(milliseconds) {
  switch (typeof milliseconds) {
    case "number": {
      if (Number.isFinite(milliseconds)) {
        return parseNumber(milliseconds);
      }
      break;
    }
    case "bigint": {
      return parseBigint(milliseconds);
    }
  }
  throw new TypeError("Expected a finite number or bigint");
}
var toZeroIfInfinity;
var init_parse_ms = __esm({
  "node_modules/parse-ms/index.js"() {
    toZeroIfInfinity = (value) => Number.isFinite(value) ? value : 0;
  }
});

// node_modules/pretty-ms/index.js
function prettyMilliseconds(milliseconds, options) {
  const isBigInt = typeof milliseconds === "bigint";
  if (!isBigInt && !Number.isFinite(milliseconds)) {
    throw new TypeError("Expected a finite number or bigint");
  }
  options = { ...options };
  const sign = milliseconds < 0 ? "-" : "";
  milliseconds = milliseconds < 0 ? -milliseconds : milliseconds;
  if (options.colonNotation) {
    options.compact = false;
    options.formatSubMilliseconds = false;
    options.separateMilliseconds = false;
    options.verbose = false;
  }
  if (options.compact) {
    options.unitCount = 1;
    options.secondsDecimalDigits = 0;
    options.millisecondsDecimalDigits = 0;
  }
  let result = [];
  const floorDecimals = (value, decimalDigits) => {
    const flooredInterimValue = Math.floor(value * 10 ** decimalDigits + SECOND_ROUNDING_EPSILON);
    const flooredValue = Math.round(flooredInterimValue) / 10 ** decimalDigits;
    return flooredValue.toFixed(decimalDigits);
  };
  const add = (value, long, short, valueString) => {
    if ((result.length === 0 || !options.colonNotation) && isZero(value) && !(options.colonNotation && short === "m")) {
      return;
    }
    valueString ??= String(value);
    if (options.colonNotation) {
      const wholeDigits = valueString.includes(".") ? valueString.split(".")[0].length : valueString.length;
      const minLength = result.length > 0 ? 2 : 1;
      valueString = "0".repeat(Math.max(0, minLength - wholeDigits)) + valueString;
    } else {
      valueString += options.verbose ? " " + pluralize(long, value) : short;
    }
    result.push(valueString);
  };
  const parsed = parseMilliseconds(milliseconds);
  const days = BigInt(parsed.days);
  if (options.hideYearAndDays) {
    add(BigInt(days) * 24n + BigInt(parsed.hours), "hour", "h");
  } else {
    if (options.hideYear) {
      add(days, "day", "d");
    } else {
      add(days / 365n, "year", "y");
      add(days % 365n, "day", "d");
    }
    add(Number(parsed.hours), "hour", "h");
  }
  add(Number(parsed.minutes), "minute", "m");
  if (!options.hideSeconds) {
    if (options.separateMilliseconds || options.formatSubMilliseconds || !options.colonNotation && milliseconds < 1e3 && !options.subSecondsAsDecimals) {
      const seconds = Number(parsed.seconds);
      const milliseconds2 = Number(parsed.milliseconds);
      const microseconds = Number(parsed.microseconds);
      const nanoseconds = Number(parsed.nanoseconds);
      add(seconds, "second", "s");
      if (options.formatSubMilliseconds) {
        add(milliseconds2, "millisecond", "ms");
        add(microseconds, "microsecond", "\xB5s");
        add(nanoseconds, "nanosecond", "ns");
      } else {
        const millisecondsAndBelow = milliseconds2 + microseconds / 1e3 + nanoseconds / 1e6;
        const millisecondsDecimalDigits = typeof options.millisecondsDecimalDigits === "number" ? options.millisecondsDecimalDigits : 0;
        const roundedMilliseconds = millisecondsAndBelow >= 1 ? Math.round(millisecondsAndBelow) : Math.ceil(millisecondsAndBelow);
        const millisecondsString = millisecondsDecimalDigits ? millisecondsAndBelow.toFixed(millisecondsDecimalDigits) : roundedMilliseconds;
        add(
          Number.parseFloat(millisecondsString),
          "millisecond",
          "ms",
          millisecondsString
        );
      }
    } else {
      const seconds = (isBigInt ? Number(milliseconds % ONE_DAY_IN_MILLISECONDS) : milliseconds) / 1e3 % 60;
      const secondsDecimalDigits = typeof options.secondsDecimalDigits === "number" ? options.secondsDecimalDigits : 1;
      const secondsFixed = floorDecimals(seconds, secondsDecimalDigits);
      const secondsString = options.keepDecimalsOnWholeSeconds ? secondsFixed : secondsFixed.replace(/\.0+$/, "");
      add(Number.parseFloat(secondsString), "second", "s", secondsString);
    }
  }
  if (result.length === 0) {
    return sign + "0" + (options.verbose ? " milliseconds" : "ms");
  }
  const separator = options.colonNotation ? ":" : " ";
  if (typeof options.unitCount === "number") {
    result = result.slice(0, Math.max(options.unitCount, 1));
  }
  return sign + result.join(separator);
}
var isZero, pluralize, SECOND_ROUNDING_EPSILON, ONE_DAY_IN_MILLISECONDS;
var init_pretty_ms = __esm({
  "node_modules/pretty-ms/index.js"() {
    init_parse_ms();
    isZero = (value) => value === 0 || value === 0n;
    pluralize = (word, count2) => count2 === 1 || count2 === 1n ? word : `${word}s`;
    SECOND_ROUNDING_EPSILON = 1e-7;
    ONE_DAY_IN_MILLISECONDS = 24n * 60n * 60n * 1000n;
  }
});

// node_modules/execa/lib/verbose/error.js
var logError;
var init_error = __esm({
  "node_modules/execa/lib/verbose/error.js"() {
    init_log2();
    logError = (result, verboseInfo) => {
      if (result.failed) {
        verboseLog({
          type: "error",
          verboseMessage: result.shortMessage,
          verboseInfo,
          result
        });
      }
    };
  }
});

// node_modules/execa/lib/verbose/complete.js
var logResult, logDuration;
var init_complete = __esm({
  "node_modules/execa/lib/verbose/complete.js"() {
    init_pretty_ms();
    init_values();
    init_log2();
    init_error();
    logResult = (result, verboseInfo) => {
      if (!isVerbose(verboseInfo)) {
        return;
      }
      logError(result, verboseInfo);
      logDuration(result, verboseInfo);
    };
    logDuration = (result, verboseInfo) => {
      const verboseMessage = `(done in ${prettyMilliseconds(result.durationMs)})`;
      verboseLog({
        type: "duration",
        verboseMessage,
        verboseInfo,
        result
      });
    };
  }
});

// node_modules/execa/lib/return/reject.js
var handleResult;
var init_reject = __esm({
  "node_modules/execa/lib/return/reject.js"() {
    init_complete();
    handleResult = (result, verboseInfo, { reject }) => {
      logResult(result, verboseInfo);
      if (result.failed && reject) {
        throw result;
      }
      return result;
    };
  }
});

// node_modules/execa/lib/stdio/type.js
var getStdioItemType, getTransformObjectType, getDuplexType, getTransformStreamType, validateNonGeneratorType, checkUndefinedOption, getGeneratorObjectType, checkBooleanOption, isGenerator, isAsyncGenerator, isSyncGenerator, isTransformOptions, isUrl, isRegularUrl, isFilePathObject, FILE_PATH_KEYS, isFilePathString, isUnknownStdioString, KNOWN_STDIO_STRINGS, isReadableStream2, isWritableStream2, isWebStream, isTransformStream, isAsyncIterableObject, isIterableObject, isObject, TRANSFORM_TYPES, FILE_TYPES, SPECIAL_DUPLICATE_TYPES_SYNC, SPECIAL_DUPLICATE_TYPES, FORBID_DUPLICATE_TYPES, TYPE_TO_MESSAGE;
var init_type = __esm({
  "node_modules/execa/lib/stdio/type.js"() {
    init_is_stream();
    init_is_plain_obj();
    init_uint_array();
    getStdioItemType = (value, optionName) => {
      if (isAsyncGenerator(value)) {
        return "asyncGenerator";
      }
      if (isSyncGenerator(value)) {
        return "generator";
      }
      if (isUrl(value)) {
        return "fileUrl";
      }
      if (isFilePathObject(value)) {
        return "filePath";
      }
      if (isWebStream(value)) {
        return "webStream";
      }
      if (isStream(value, { checkOpen: false })) {
        return "native";
      }
      if (isUint8Array(value)) {
        return "uint8Array";
      }
      if (isAsyncIterableObject(value)) {
        return "asyncIterable";
      }
      if (isIterableObject(value)) {
        return "iterable";
      }
      if (isTransformStream(value)) {
        return getTransformStreamType({ transform: value }, optionName);
      }
      if (isTransformOptions(value)) {
        return getTransformObjectType(value, optionName);
      }
      return "native";
    };
    getTransformObjectType = (value, optionName) => {
      if (isDuplexStream(value.transform, { checkOpen: false })) {
        return getDuplexType(value, optionName);
      }
      if (isTransformStream(value.transform)) {
        return getTransformStreamType(value, optionName);
      }
      return getGeneratorObjectType(value, optionName);
    };
    getDuplexType = (value, optionName) => {
      validateNonGeneratorType(value, optionName, "Duplex stream");
      return "duplex";
    };
    getTransformStreamType = (value, optionName) => {
      validateNonGeneratorType(value, optionName, "web TransformStream");
      return "webTransform";
    };
    validateNonGeneratorType = ({ final, binary, objectMode }, optionName, typeName) => {
      checkUndefinedOption(final, `${optionName}.final`, typeName);
      checkUndefinedOption(binary, `${optionName}.binary`, typeName);
      checkBooleanOption(objectMode, `${optionName}.objectMode`);
    };
    checkUndefinedOption = (value, optionName, typeName) => {
      if (value !== void 0) {
        throw new TypeError(`The \`${optionName}\` option can only be defined when using a generator, not a ${typeName}.`);
      }
    };
    getGeneratorObjectType = ({ transform, final, binary, objectMode }, optionName) => {
      if (transform !== void 0 && !isGenerator(transform)) {
        throw new TypeError(`The \`${optionName}.transform\` option must be a generator, a Duplex stream or a web TransformStream.`);
      }
      if (isDuplexStream(final, { checkOpen: false })) {
        throw new TypeError(`The \`${optionName}.final\` option must not be a Duplex stream.`);
      }
      if (isTransformStream(final)) {
        throw new TypeError(`The \`${optionName}.final\` option must not be a web TransformStream.`);
      }
      if (final !== void 0 && !isGenerator(final)) {
        throw new TypeError(`The \`${optionName}.final\` option must be a generator.`);
      }
      checkBooleanOption(binary, `${optionName}.binary`);
      checkBooleanOption(objectMode, `${optionName}.objectMode`);
      return isAsyncGenerator(transform) || isAsyncGenerator(final) ? "asyncGenerator" : "generator";
    };
    checkBooleanOption = (value, optionName) => {
      if (value !== void 0 && typeof value !== "boolean") {
        throw new TypeError(`The \`${optionName}\` option must use a boolean.`);
      }
    };
    isGenerator = (value) => isAsyncGenerator(value) || isSyncGenerator(value);
    isAsyncGenerator = (value) => Object.prototype.toString.call(value) === "[object AsyncGeneratorFunction]";
    isSyncGenerator = (value) => Object.prototype.toString.call(value) === "[object GeneratorFunction]";
    isTransformOptions = (value) => isPlainObject(value) && (value.transform !== void 0 || value.final !== void 0);
    isUrl = (value) => Object.prototype.toString.call(value) === "[object URL]";
    isRegularUrl = (value) => isUrl(value) && value.protocol !== "file:";
    isFilePathObject = (value) => isPlainObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => FILE_PATH_KEYS.has(key)) && isFilePathString(value.file);
    FILE_PATH_KEYS = /* @__PURE__ */ new Set(["file", "append"]);
    isFilePathString = (file) => typeof file === "string";
    isUnknownStdioString = (type, value) => type === "native" && typeof value === "string" && !KNOWN_STDIO_STRINGS.has(value);
    KNOWN_STDIO_STRINGS = /* @__PURE__ */ new Set(["ipc", "ignore", "inherit", "overlapped", "pipe"]);
    isReadableStream2 = (value) => Object.prototype.toString.call(value) === "[object ReadableStream]";
    isWritableStream2 = (value) => Object.prototype.toString.call(value) === "[object WritableStream]";
    isWebStream = (value) => isReadableStream2(value) || isWritableStream2(value);
    isTransformStream = (value) => isReadableStream2(value?.readable) && isWritableStream2(value?.writable);
    isAsyncIterableObject = (value) => isObject(value) && typeof value[Symbol.asyncIterator] === "function";
    isIterableObject = (value) => isObject(value) && typeof value[Symbol.iterator] === "function";
    isObject = (value) => typeof value === "object" && value !== null;
    TRANSFORM_TYPES = /* @__PURE__ */ new Set(["generator", "asyncGenerator", "duplex", "webTransform"]);
    FILE_TYPES = /* @__PURE__ */ new Set(["fileUrl", "filePath", "fileNumber"]);
    SPECIAL_DUPLICATE_TYPES_SYNC = /* @__PURE__ */ new Set(["fileUrl", "filePath"]);
    SPECIAL_DUPLICATE_TYPES = /* @__PURE__ */ new Set([...SPECIAL_DUPLICATE_TYPES_SYNC, "webStream", "nodeStream"]);
    FORBID_DUPLICATE_TYPES = /* @__PURE__ */ new Set(["webTransform", "duplex"]);
    TYPE_TO_MESSAGE = {
      generator: "a generator",
      asyncGenerator: "an async generator",
      fileUrl: "a file URL",
      filePath: "a file path string",
      fileNumber: "a file descriptor number",
      webStream: "a web stream",
      nodeStream: "a Node.js stream",
      webTransform: "a web TransformStream",
      duplex: "a Duplex stream",
      native: "any value",
      iterable: "an iterable",
      asyncIterable: "an async iterable",
      string: "a string",
      uint8Array: "a Uint8Array"
    };
  }
});

// node_modules/execa/lib/transform/object-mode.js
var getTransformObjectModes, getOutputObjectModes, getInputObjectModes, getFdObjectMode;
var init_object_mode = __esm({
  "node_modules/execa/lib/transform/object-mode.js"() {
    init_type();
    getTransformObjectModes = (objectMode, index, newTransforms, direction) => direction === "output" ? getOutputObjectModes(objectMode, index, newTransforms) : getInputObjectModes(objectMode, index, newTransforms);
    getOutputObjectModes = (objectMode, index, newTransforms) => {
      const writableObjectMode = index !== 0 && newTransforms[index - 1].value.readableObjectMode;
      const readableObjectMode = objectMode ?? writableObjectMode;
      return { writableObjectMode, readableObjectMode };
    };
    getInputObjectModes = (objectMode, index, newTransforms) => {
      const writableObjectMode = index === 0 ? objectMode === true : newTransforms[index - 1].value.readableObjectMode;
      const readableObjectMode = index !== newTransforms.length - 1 && (objectMode ?? writableObjectMode);
      return { writableObjectMode, readableObjectMode };
    };
    getFdObjectMode = (stdioItems, direction) => {
      const lastTransform = stdioItems.findLast(({ type }) => TRANSFORM_TYPES.has(type));
      if (lastTransform === void 0) {
        return false;
      }
      return direction === "input" ? lastTransform.value.writableObjectMode : lastTransform.value.readableObjectMode;
    };
  }
});

// node_modules/execa/lib/transform/normalize.js
var normalizeTransforms, getTransforms, normalizeTransform, normalizeDuplex, normalizeTransformStream, normalizeGenerator, sortTransforms;
var init_normalize = __esm({
  "node_modules/execa/lib/transform/normalize.js"() {
    init_is_plain_obj();
    init_encoding_option();
    init_type();
    init_object_mode();
    normalizeTransforms = (stdioItems, optionName, direction, options) => [
      ...stdioItems.filter(({ type }) => !TRANSFORM_TYPES.has(type)),
      ...getTransforms(stdioItems, optionName, direction, options)
    ];
    getTransforms = (stdioItems, optionName, direction, { encoding }) => {
      const transforms = stdioItems.filter(({ type }) => TRANSFORM_TYPES.has(type));
      const newTransforms = Array.from({ length: transforms.length });
      for (const [index, stdioItem] of Object.entries(transforms)) {
        newTransforms[index] = normalizeTransform({
          stdioItem,
          index: Number(index),
          newTransforms,
          optionName,
          direction,
          encoding
        });
      }
      return sortTransforms(newTransforms, direction);
    };
    normalizeTransform = ({ stdioItem, stdioItem: { type }, index, newTransforms, optionName, direction, encoding }) => {
      if (type === "duplex") {
        return normalizeDuplex({ stdioItem, optionName });
      }
      if (type === "webTransform") {
        return normalizeTransformStream({
          stdioItem,
          index,
          newTransforms,
          direction
        });
      }
      return normalizeGenerator({
        stdioItem,
        index,
        newTransforms,
        direction,
        encoding
      });
    };
    normalizeDuplex = ({
      stdioItem,
      stdioItem: {
        value: {
          transform,
          transform: { writableObjectMode, readableObjectMode },
          objectMode = readableObjectMode
        }
      },
      optionName
    }) => {
      if (objectMode && !readableObjectMode) {
        throw new TypeError(`The \`${optionName}.objectMode\` option can only be \`true\` if \`new Duplex({objectMode: true})\` is used.`);
      }
      if (!objectMode && readableObjectMode) {
        throw new TypeError(`The \`${optionName}.objectMode\` option cannot be \`false\` if \`new Duplex({objectMode: true})\` is used.`);
      }
      return {
        ...stdioItem,
        value: { transform, writableObjectMode, readableObjectMode }
      };
    };
    normalizeTransformStream = ({ stdioItem, stdioItem: { value }, index, newTransforms, direction }) => {
      const { transform, objectMode } = isPlainObject(value) ? value : { transform: value };
      const { writableObjectMode, readableObjectMode } = getTransformObjectModes(objectMode, index, newTransforms, direction);
      return {
        ...stdioItem,
        value: { transform, writableObjectMode, readableObjectMode }
      };
    };
    normalizeGenerator = ({ stdioItem, stdioItem: { value }, index, newTransforms, direction, encoding }) => {
      const {
        transform,
        final,
        binary: binaryOption = false,
        preserveNewlines = false,
        objectMode
      } = isPlainObject(value) ? value : { transform: value };
      const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
      const { writableObjectMode, readableObjectMode } = getTransformObjectModes(objectMode, index, newTransforms, direction);
      return {
        ...stdioItem,
        value: {
          transform,
          final,
          binary,
          preserveNewlines,
          writableObjectMode,
          readableObjectMode
        }
      };
    };
    sortTransforms = (newTransforms, direction) => direction === "input" ? newTransforms.reverse() : newTransforms;
  }
});

// node_modules/execa/lib/stdio/direction.js
var import_node_process9, getStreamDirection, getStdioItemDirection, KNOWN_DIRECTIONS, anyDirection, alwaysInput, guessStreamDirection, getStandardStreamDirection, DEFAULT_DIRECTION;
var init_direction = __esm({
  "node_modules/execa/lib/stdio/direction.js"() {
    import_node_process9 = __toESM(require("node:process"), 1);
    init_is_stream();
    init_type();
    getStreamDirection = (stdioItems, fdNumber, optionName) => {
      const directions = stdioItems.map((stdioItem) => getStdioItemDirection(stdioItem, fdNumber));
      if (directions.includes("input") && directions.includes("output")) {
        throw new TypeError(`The \`${optionName}\` option must not be an array of both readable and writable values.`);
      }
      return directions.find(Boolean) ?? DEFAULT_DIRECTION;
    };
    getStdioItemDirection = ({ type, value }, fdNumber) => KNOWN_DIRECTIONS[fdNumber] ?? guessStreamDirection[type](value);
    KNOWN_DIRECTIONS = ["input", "output", "output"];
    anyDirection = () => void 0;
    alwaysInput = () => "input";
    guessStreamDirection = {
      generator: anyDirection,
      asyncGenerator: anyDirection,
      fileUrl: anyDirection,
      filePath: anyDirection,
      iterable: alwaysInput,
      asyncIterable: alwaysInput,
      uint8Array: alwaysInput,
      webStream: (value) => isWritableStream2(value) ? "output" : "input",
      nodeStream(value) {
        if (!isReadableStream(value, { checkOpen: false })) {
          return "output";
        }
        return isWritableStream(value, { checkOpen: false }) ? void 0 : "input";
      },
      webTransform: anyDirection,
      duplex: anyDirection,
      native(value) {
        const standardStreamDirection = getStandardStreamDirection(value);
        if (standardStreamDirection !== void 0) {
          return standardStreamDirection;
        }
        if (isStream(value, { checkOpen: false })) {
          return guessStreamDirection.nodeStream(value);
        }
      }
    };
    getStandardStreamDirection = (value) => {
      if ([0, import_node_process9.default.stdin].includes(value)) {
        return "input";
      }
      if ([1, 2, import_node_process9.default.stdout, import_node_process9.default.stderr].includes(value)) {
        return "output";
      }
    };
    DEFAULT_DIRECTION = "output";
  }
});

// node_modules/execa/lib/ipc/array.js
var normalizeIpcStdioArray;
var init_array2 = __esm({
  "node_modules/execa/lib/ipc/array.js"() {
    normalizeIpcStdioArray = (stdioArray, ipc) => ipc && !stdioArray.includes("ipc") ? [...stdioArray, "ipc"] : stdioArray;
  }
});

// node_modules/execa/lib/stdio/stdio-option.js
var normalizeStdioOption, getStdioArray, hasAlias, addDefaultValue2, normalizeStdioSync, isOutputPipeOnly;
var init_stdio_option = __esm({
  "node_modules/execa/lib/stdio/stdio-option.js"() {
    init_standard_stream();
    init_array2();
    init_values();
    normalizeStdioOption = ({ stdio, ipc, buffer, ...options }, verboseInfo, isSync) => {
      const stdioArray = getStdioArray(stdio, options).map((stdioOption, fdNumber) => addDefaultValue2(stdioOption, fdNumber));
      return isSync ? normalizeStdioSync(stdioArray, buffer, verboseInfo) : normalizeIpcStdioArray(stdioArray, ipc);
    };
    getStdioArray = (stdio, options) => {
      if (stdio === void 0) {
        return STANDARD_STREAMS_ALIASES.map((alias) => options[alias]);
      }
      if (hasAlias(options)) {
        throw new Error(`It's not possible to provide \`stdio\` in combination with one of ${STANDARD_STREAMS_ALIASES.map((alias) => `\`${alias}\``).join(", ")}`);
      }
      if (typeof stdio === "string") {
        return [stdio, stdio, stdio];
      }
      if (!Array.isArray(stdio)) {
        throw new TypeError(`Expected \`stdio\` to be of type \`string\` or \`Array\`, got \`${typeof stdio}\``);
      }
      const length = Math.max(stdio.length, STANDARD_STREAMS_ALIASES.length);
      return Array.from({ length }, (_, fdNumber) => stdio[fdNumber]);
    };
    hasAlias = (options) => STANDARD_STREAMS_ALIASES.some((alias) => options[alias] !== void 0);
    addDefaultValue2 = (stdioOption, fdNumber) => {
      if (Array.isArray(stdioOption)) {
        return stdioOption.map((item) => addDefaultValue2(item, fdNumber));
      }
      if (stdioOption === null || stdioOption === void 0) {
        return fdNumber >= STANDARD_STREAMS_ALIASES.length ? "ignore" : "pipe";
      }
      return stdioOption;
    };
    normalizeStdioSync = (stdioArray, buffer, verboseInfo) => stdioArray.map((stdioOption, fdNumber) => !buffer[fdNumber] && fdNumber !== 0 && !isFullVerbose(verboseInfo, fdNumber) && isOutputPipeOnly(stdioOption) ? "ignore" : stdioOption);
    isOutputPipeOnly = (stdioOption) => stdioOption === "pipe" || Array.isArray(stdioOption) && stdioOption.every((item) => item === "pipe");
  }
});

// node_modules/execa/lib/stdio/native.js
var import_node_fs9, import_node_tty2, handleNativeStream, handleNativeStreamSync, getTargetFd, getTargetFdNumber, handleNativeStreamAsync, getStandardStream;
var init_native = __esm({
  "node_modules/execa/lib/stdio/native.js"() {
    import_node_fs9 = require("node:fs");
    import_node_tty2 = __toESM(require("node:tty"), 1);
    init_is_stream();
    init_standard_stream();
    init_uint_array();
    init_fd_options();
    handleNativeStream = ({ stdioItem, stdioItem: { type }, isStdioArray, fdNumber, direction, isSync }) => {
      if (!isStdioArray || type !== "native") {
        return stdioItem;
      }
      return isSync ? handleNativeStreamSync({ stdioItem, fdNumber, direction }) : handleNativeStreamAsync({ stdioItem, fdNumber });
    };
    handleNativeStreamSync = ({ stdioItem, stdioItem: { value, optionName }, fdNumber, direction }) => {
      const targetFd = getTargetFd({
        value,
        optionName,
        fdNumber,
        direction
      });
      if (targetFd !== void 0) {
        return targetFd;
      }
      if (isStream(value, { checkOpen: false })) {
        throw new TypeError(`The \`${optionName}: Stream\` option cannot both be an array and include a stream with synchronous methods.`);
      }
      return stdioItem;
    };
    getTargetFd = ({ value, optionName, fdNumber, direction }) => {
      const targetFdNumber = getTargetFdNumber(value, fdNumber);
      if (targetFdNumber === void 0) {
        return;
      }
      if (direction === "output") {
        return { type: "fileNumber", value: targetFdNumber, optionName };
      }
      if (import_node_tty2.default.isatty(targetFdNumber)) {
        throw new TypeError(`The \`${optionName}: ${serializeOptionValue(value)}\` option is invalid: it cannot be a TTY with synchronous methods.`);
      }
      return { type: "uint8Array", value: bufferToUint8Array((0, import_node_fs9.readFileSync)(targetFdNumber)), optionName };
    };
    getTargetFdNumber = (value, fdNumber) => {
      if (value === "inherit") {
        return fdNumber;
      }
      if (typeof value === "number") {
        return value;
      }
      const standardStreamIndex = STANDARD_STREAMS.indexOf(value);
      if (standardStreamIndex !== -1) {
        return standardStreamIndex;
      }
    };
    handleNativeStreamAsync = ({ stdioItem, stdioItem: { value, optionName }, fdNumber }) => {
      if (value === "inherit") {
        return { type: "nodeStream", value: getStandardStream(fdNumber, value, optionName), optionName };
      }
      if (typeof value === "number") {
        return { type: "nodeStream", value: getStandardStream(value, value, optionName), optionName };
      }
      if (isStream(value, { checkOpen: false })) {
        return { type: "nodeStream", value, optionName };
      }
      return stdioItem;
    };
    getStandardStream = (fdNumber, value, optionName) => {
      const standardStream = STANDARD_STREAMS[fdNumber];
      if (standardStream === void 0) {
        throw new TypeError(`The \`${optionName}: ${value}\` option is invalid: no such standard stream.`);
      }
      return standardStream;
    };
  }
});

// node_modules/execa/lib/stdio/input-option.js
var handleInputOptions, handleInputOption, getInputType, handleInputFileOption, getInputFileType;
var init_input_option = __esm({
  "node_modules/execa/lib/stdio/input-option.js"() {
    init_is_stream();
    init_uint_array();
    init_type();
    handleInputOptions = ({ input, inputFile }, fdNumber) => fdNumber === 0 ? [
      ...handleInputOption(input),
      ...handleInputFileOption(inputFile)
    ] : [];
    handleInputOption = (input) => input === void 0 ? [] : [{
      type: getInputType(input),
      value: input,
      optionName: "input"
    }];
    getInputType = (input) => {
      if (isReadableStream(input, { checkOpen: false })) {
        return "nodeStream";
      }
      if (typeof input === "string") {
        return "string";
      }
      if (isUint8Array(input)) {
        return "uint8Array";
      }
      throw new Error("The `input` option must be a string, a Uint8Array or a Node.js Readable stream.");
    };
    handleInputFileOption = (inputFile) => inputFile === void 0 ? [] : [{
      ...getInputFileType(inputFile),
      optionName: "inputFile"
    }];
    getInputFileType = (inputFile) => {
      if (isUrl(inputFile)) {
        return { type: "fileUrl", value: inputFile };
      }
      if (isFilePathString(inputFile)) {
        return { type: "filePath", value: { file: inputFile } };
      }
      throw new Error("The `inputFile` option must be a file path string or a file URL.");
    };
  }
});

// node_modules/execa/lib/stdio/duplicate.js
var filterDuplicates, getDuplicateStream, getOtherStdioItems, validateDuplicateStreamSync, getDuplicateStreamInstance, hasSameValue, validateDuplicateTransform, throwOnDuplicateStream;
var init_duplicate = __esm({
  "node_modules/execa/lib/stdio/duplicate.js"() {
    init_type();
    filterDuplicates = (stdioItems) => stdioItems.filter((stdioItemOne, indexOne) => stdioItems.every((stdioItemTwo, indexTwo) => stdioItemOne.value !== stdioItemTwo.value || indexOne >= indexTwo || stdioItemOne.type === "generator" || stdioItemOne.type === "asyncGenerator"));
    getDuplicateStream = ({ stdioItem: { type, value, optionName }, direction, fileDescriptors, isSync }) => {
      const otherStdioItems = getOtherStdioItems(fileDescriptors, type);
      if (otherStdioItems.length === 0) {
        return;
      }
      if (isSync) {
        validateDuplicateStreamSync({
          otherStdioItems,
          type,
          value,
          optionName,
          direction
        });
        return;
      }
      if (SPECIAL_DUPLICATE_TYPES.has(type)) {
        return getDuplicateStreamInstance({
          otherStdioItems,
          type,
          value,
          optionName,
          direction
        });
      }
      if (FORBID_DUPLICATE_TYPES.has(type)) {
        validateDuplicateTransform({
          otherStdioItems,
          type,
          value,
          optionName
        });
      }
    };
    getOtherStdioItems = (fileDescriptors, type) => fileDescriptors.flatMap(({ direction, stdioItems }) => stdioItems.filter((stdioItem) => stdioItem.type === type).map((stdioItem) => ({ ...stdioItem, direction })));
    validateDuplicateStreamSync = ({ otherStdioItems, type, value, optionName, direction }) => {
      if (SPECIAL_DUPLICATE_TYPES_SYNC.has(type)) {
        getDuplicateStreamInstance({
          otherStdioItems,
          type,
          value,
          optionName,
          direction
        });
      }
    };
    getDuplicateStreamInstance = ({ otherStdioItems, type, value, optionName, direction }) => {
      const duplicateStdioItems = otherStdioItems.filter((stdioItem) => hasSameValue(stdioItem, value));
      if (duplicateStdioItems.length === 0) {
        return;
      }
      const differentStdioItem = duplicateStdioItems.find((stdioItem) => stdioItem.direction !== direction);
      throwOnDuplicateStream(differentStdioItem, optionName, type);
      return direction === "output" ? duplicateStdioItems[0].stream : void 0;
    };
    hasSameValue = ({ type, value }, secondValue) => {
      if (type === "filePath") {
        return value.file === secondValue.file;
      }
      if (type === "fileUrl") {
        return value.href === secondValue.href;
      }
      return value === secondValue;
    };
    validateDuplicateTransform = ({ otherStdioItems, type, value, optionName }) => {
      const duplicateStdioItem = otherStdioItems.find(({ value: { transform } }) => transform === value.transform);
      throwOnDuplicateStream(duplicateStdioItem, optionName, type);
    };
    throwOnDuplicateStream = (stdioItem, optionName, type) => {
      if (stdioItem !== void 0) {
        throw new TypeError(`The \`${stdioItem.optionName}\` and \`${optionName}\` options must not target ${TYPE_TO_MESSAGE[type]} that is the same.`);
      }
    };
  }
});

// node_modules/execa/lib/stdio/handle.js
var handleStdio, getFileDescriptor, initializeStdioItems, initializeStdioItem, validateStdioArray, INVALID_STDIO_ARRAY_OPTIONS, validateStreams, validateFileStdio, validateFileObjectMode, getFinalFileDescriptors, getFinalFileDescriptor, addStreamProperties, cleanupCustomStreams, forwardStdio;
var init_handle = __esm({
  "node_modules/execa/lib/stdio/handle.js"() {
    init_standard_stream();
    init_normalize();
    init_object_mode();
    init_type();
    init_direction();
    init_stdio_option();
    init_native();
    init_input_option();
    init_duplicate();
    handleStdio = (addProperties3, options, verboseInfo, isSync) => {
      const stdio = normalizeStdioOption(options, verboseInfo, isSync);
      const initialFileDescriptors = stdio.map((stdioOption, fdNumber) => getFileDescriptor({
        stdioOption,
        fdNumber,
        options,
        isSync
      }));
      const fileDescriptors = getFinalFileDescriptors({
        initialFileDescriptors,
        addProperties: addProperties3,
        options,
        isSync
      });
      options.stdio = fileDescriptors.map(({ stdioItems }) => forwardStdio(stdioItems));
      return fileDescriptors;
    };
    getFileDescriptor = ({ stdioOption, fdNumber, options, isSync }) => {
      const optionName = getStreamName(fdNumber);
      const { stdioItems: initialStdioItems, isStdioArray } = initializeStdioItems({
        stdioOption,
        fdNumber,
        options,
        optionName
      });
      const direction = getStreamDirection(initialStdioItems, fdNumber, optionName);
      const stdioItems = initialStdioItems.map((stdioItem) => handleNativeStream({
        stdioItem,
        isStdioArray,
        fdNumber,
        direction,
        isSync
      }));
      const normalizedStdioItems = normalizeTransforms(stdioItems, optionName, direction, options);
      const objectMode = getFdObjectMode(normalizedStdioItems, direction);
      validateFileObjectMode(normalizedStdioItems, objectMode);
      return { direction, objectMode, stdioItems: normalizedStdioItems };
    };
    initializeStdioItems = ({ stdioOption, fdNumber, options, optionName }) => {
      const values = Array.isArray(stdioOption) ? stdioOption : [stdioOption];
      const initialStdioItems = [
        ...values.map((value) => initializeStdioItem(value, optionName)),
        ...handleInputOptions(options, fdNumber)
      ];
      const stdioItems = filterDuplicates(initialStdioItems);
      const isStdioArray = stdioItems.length > 1;
      validateStdioArray(stdioItems, isStdioArray, optionName);
      validateStreams(stdioItems);
      return { stdioItems, isStdioArray };
    };
    initializeStdioItem = (value, optionName) => ({
      type: getStdioItemType(value, optionName),
      value,
      optionName
    });
    validateStdioArray = (stdioItems, isStdioArray, optionName) => {
      if (stdioItems.length === 0) {
        throw new TypeError(`The \`${optionName}\` option must not be an empty array.`);
      }
      if (!isStdioArray) {
        return;
      }
      for (const { value, optionName: optionName2 } of stdioItems) {
        if (INVALID_STDIO_ARRAY_OPTIONS.has(value)) {
          throw new Error(`The \`${optionName2}\` option must not include \`${value}\`.`);
        }
      }
    };
    INVALID_STDIO_ARRAY_OPTIONS = /* @__PURE__ */ new Set(["ignore", "ipc"]);
    validateStreams = (stdioItems) => {
      for (const stdioItem of stdioItems) {
        validateFileStdio(stdioItem);
      }
    };
    validateFileStdio = ({ type, value, optionName }) => {
      if (isRegularUrl(value)) {
        throw new TypeError(`The \`${optionName}: URL\` option must use the \`file:\` scheme.
For example, you can use the \`pathToFileURL()\` method of the \`url\` core module.`);
      }
      if (isUnknownStdioString(type, value)) {
        throw new TypeError(`The \`${optionName}: { file: '...' }\` option must be used instead of \`${optionName}: '...'\`.`);
      }
    };
    validateFileObjectMode = (stdioItems, objectMode) => {
      if (!objectMode) {
        return;
      }
      const fileStdioItem = stdioItems.find(({ type }) => FILE_TYPES.has(type));
      if (fileStdioItem !== void 0) {
        throw new TypeError(`The \`${fileStdioItem.optionName}\` option cannot use both files and transforms in objectMode.`);
      }
    };
    getFinalFileDescriptors = ({ initialFileDescriptors, addProperties: addProperties3, options, isSync }) => {
      const fileDescriptors = [];
      try {
        for (const fileDescriptor of initialFileDescriptors) {
          fileDescriptors.push(getFinalFileDescriptor({
            fileDescriptor,
            fileDescriptors,
            addProperties: addProperties3,
            options,
            isSync
          }));
        }
        return fileDescriptors;
      } catch (error) {
        cleanupCustomStreams(fileDescriptors);
        throw error;
      }
    };
    getFinalFileDescriptor = ({
      fileDescriptor: { direction, objectMode, stdioItems },
      fileDescriptors,
      addProperties: addProperties3,
      options,
      isSync
    }) => {
      const finalStdioItems = stdioItems.map((stdioItem) => addStreamProperties({
        stdioItem,
        addProperties: addProperties3,
        direction,
        options,
        fileDescriptors,
        isSync
      }));
      return { direction, objectMode, stdioItems: finalStdioItems };
    };
    addStreamProperties = ({ stdioItem, addProperties: addProperties3, direction, options, fileDescriptors, isSync }) => {
      const duplicateStream = getDuplicateStream({
        stdioItem,
        direction,
        fileDescriptors,
        isSync
      });
      if (duplicateStream !== void 0) {
        return { ...stdioItem, stream: duplicateStream };
      }
      return {
        ...stdioItem,
        ...addProperties3[direction][stdioItem.type](stdioItem, options)
      };
    };
    cleanupCustomStreams = (fileDescriptors) => {
      for (const { stdioItems } of fileDescriptors) {
        for (const { stream } of stdioItems) {
          if (stream !== void 0 && !isStandardStream(stream)) {
            stream.destroy();
          }
        }
      }
    };
    forwardStdio = (stdioItems) => {
      if (stdioItems.length > 1) {
        return stdioItems.some(({ value: value2 }) => value2 === "overlapped") ? "overlapped" : "pipe";
      }
      const [{ type, value }] = stdioItems;
      return type === "native" ? value : "pipe";
    };
  }
});

// node_modules/execa/lib/stdio/handle-sync.js
var import_node_fs10, handleStdioSync, forbiddenIfSync, forbiddenNativeIfSync, throwInvalidSyncValue, addProperties, addPropertiesSync;
var init_handle_sync = __esm({
  "node_modules/execa/lib/stdio/handle-sync.js"() {
    import_node_fs10 = require("node:fs");
    init_uint_array();
    init_handle();
    init_type();
    handleStdioSync = (options, verboseInfo) => handleStdio(addPropertiesSync, options, verboseInfo, true);
    forbiddenIfSync = ({ type, optionName }) => {
      throwInvalidSyncValue(optionName, TYPE_TO_MESSAGE[type]);
    };
    forbiddenNativeIfSync = ({ optionName, value }) => {
      if (value === "ipc" || value === "overlapped") {
        throwInvalidSyncValue(optionName, `"${value}"`);
      }
      return {};
    };
    throwInvalidSyncValue = (optionName, value) => {
      throw new TypeError(`The \`${optionName}\` option cannot be ${value} with synchronous methods.`);
    };
    addProperties = {
      generator() {
      },
      asyncGenerator: forbiddenIfSync,
      webStream: forbiddenIfSync,
      nodeStream: forbiddenIfSync,
      webTransform: forbiddenIfSync,
      duplex: forbiddenIfSync,
      asyncIterable: forbiddenIfSync,
      native: forbiddenNativeIfSync
    };
    addPropertiesSync = {
      input: {
        ...addProperties,
        fileUrl: ({ value }) => ({ contents: [bufferToUint8Array((0, import_node_fs10.readFileSync)(value))] }),
        filePath: ({ value: { file } }) => ({ contents: [bufferToUint8Array((0, import_node_fs10.readFileSync)(file))] }),
        fileNumber: forbiddenIfSync,
        iterable: ({ value }) => ({ contents: [...value] }),
        string: ({ value }) => ({ contents: [value] }),
        uint8Array: ({ value }) => ({ contents: [value] })
      },
      output: {
        ...addProperties,
        fileUrl: ({ value }) => ({ path: value }),
        filePath: ({ value: { file, append } }) => ({ path: file, append }),
        fileNumber: ({ value }) => ({ path: value }),
        iterable: forbiddenIfSync,
        string: forbiddenIfSync,
        uint8Array: forbiddenIfSync
      }
    };
  }
});

// node_modules/execa/lib/io/strip-newline.js
var stripNewline, getStripFinalNewline;
var init_strip_newline = __esm({
  "node_modules/execa/lib/io/strip-newline.js"() {
    init_strip_final_newline();
    stripNewline = (value, { stripFinalNewline: stripFinalNewline2 }, fdNumber) => getStripFinalNewline(stripFinalNewline2, fdNumber) && value !== void 0 && !Array.isArray(value) ? stripFinalNewline(value) : value;
    getStripFinalNewline = (stripFinalNewline2, fdNumber) => fdNumber === "all" ? stripFinalNewline2[1] || stripFinalNewline2[2] : stripFinalNewline2[fdNumber];
  }
});

// node_modules/execa/lib/transform/split.js
var getSplitLinesGenerator, splitLinesSync, splitLinesItemSync, initializeSplitLines, splitGenerator, getNewlineLength, linesFinal, getAppendNewlineGenerator, appendNewlineGenerator, concatString, linesStringInfo, concatUint8Array, linesUint8ArrayInfo;
var init_split = __esm({
  "node_modules/execa/lib/transform/split.js"() {
    getSplitLinesGenerator = (binary, preserveNewlines, skipped, state) => binary || skipped ? void 0 : initializeSplitLines(preserveNewlines, state);
    splitLinesSync = (chunk, preserveNewlines, objectMode) => objectMode ? chunk.flatMap((item) => splitLinesItemSync(item, preserveNewlines)) : splitLinesItemSync(chunk, preserveNewlines);
    splitLinesItemSync = (chunk, preserveNewlines) => {
      const { transform, final } = initializeSplitLines(preserveNewlines, {});
      return [...transform(chunk), ...final()];
    };
    initializeSplitLines = (preserveNewlines, state) => {
      state.previousChunks = "";
      return {
        transform: splitGenerator.bind(void 0, state, preserveNewlines),
        final: linesFinal.bind(void 0, state)
      };
    };
    splitGenerator = function* (state, preserveNewlines, chunk) {
      if (typeof chunk !== "string") {
        yield chunk;
        return;
      }
      let { previousChunks } = state;
      let start = -1;
      for (let end = 0; end < chunk.length; end += 1) {
        if (chunk[end] === "\n") {
          const newlineLength = getNewlineLength(chunk, end, preserveNewlines, state);
          let line = chunk.slice(start + 1, end + 1 - newlineLength);
          if (previousChunks.length > 0) {
            line = concatString(previousChunks, line);
            previousChunks = "";
          }
          yield line;
          start = end;
        }
      }
      if (start !== chunk.length - 1) {
        previousChunks = concatString(previousChunks, chunk.slice(start + 1));
      }
      state.previousChunks = previousChunks;
    };
    getNewlineLength = (chunk, end, preserveNewlines, state) => {
      if (preserveNewlines) {
        return 0;
      }
      state.isWindowsNewline = end !== 0 && chunk[end - 1] === "\r";
      return state.isWindowsNewline ? 2 : 1;
    };
    linesFinal = function* ({ previousChunks }) {
      if (previousChunks.length > 0) {
        yield previousChunks;
      }
    };
    getAppendNewlineGenerator = ({ binary, preserveNewlines, readableObjectMode, state }) => binary || preserveNewlines || readableObjectMode ? void 0 : { transform: appendNewlineGenerator.bind(void 0, state) };
    appendNewlineGenerator = function* ({ isWindowsNewline = false }, chunk) {
      const { unixNewline, windowsNewline, LF: LF2, concatBytes } = typeof chunk === "string" ? linesStringInfo : linesUint8ArrayInfo;
      if (chunk.at(-1) === LF2) {
        yield chunk;
        return;
      }
      const newline = isWindowsNewline ? windowsNewline : unixNewline;
      yield concatBytes(chunk, newline);
    };
    concatString = (firstChunk, secondChunk) => `${firstChunk}${secondChunk}`;
    linesStringInfo = {
      windowsNewline: "\r\n",
      unixNewline: "\n",
      LF: "\n",
      concatBytes: concatString
    };
    concatUint8Array = (firstChunk, secondChunk) => {
      const chunk = new Uint8Array(firstChunk.length + secondChunk.length);
      chunk.set(firstChunk, 0);
      chunk.set(secondChunk, firstChunk.length);
      return chunk;
    };
    linesUint8ArrayInfo = {
      windowsNewline: new Uint8Array([13, 10]),
      unixNewline: new Uint8Array([10]),
      LF: 10,
      concatBytes: concatUint8Array
    };
  }
});

// node_modules/execa/lib/transform/validate.js
var import_node_buffer, getValidateTransformInput, validateStringTransformInput, getValidateTransformReturn, validateObjectTransformReturn, validateStringTransformReturn, validateEmptyReturn;
var init_validate = __esm({
  "node_modules/execa/lib/transform/validate.js"() {
    import_node_buffer = require("node:buffer");
    init_uint_array();
    getValidateTransformInput = (writableObjectMode, optionName) => writableObjectMode ? void 0 : validateStringTransformInput.bind(void 0, optionName);
    validateStringTransformInput = function* (optionName, chunk) {
      if (typeof chunk !== "string" && !isUint8Array(chunk) && !import_node_buffer.Buffer.isBuffer(chunk)) {
        throw new TypeError(`The \`${optionName}\` option's transform must use "objectMode: true" to receive as input: ${typeof chunk}.`);
      }
      yield chunk;
    };
    getValidateTransformReturn = (readableObjectMode, optionName) => readableObjectMode ? validateObjectTransformReturn.bind(void 0, optionName) : validateStringTransformReturn.bind(void 0, optionName);
    validateObjectTransformReturn = function* (optionName, chunk) {
      validateEmptyReturn(optionName, chunk);
      yield chunk;
    };
    validateStringTransformReturn = function* (optionName, chunk) {
      validateEmptyReturn(optionName, chunk);
      if (typeof chunk !== "string" && !isUint8Array(chunk)) {
        throw new TypeError(`The \`${optionName}\` option's function must yield a string or an Uint8Array, not ${typeof chunk}.`);
      }
      yield chunk;
    };
    validateEmptyReturn = (optionName, chunk) => {
      if (chunk === null || chunk === void 0) {
        throw new TypeError(`The \`${optionName}\` option's function must not call \`yield ${chunk}\`.
Instead, \`yield\` should either be called with a value, or not be called at all. For example:
  if (condition) { yield value; }`);
      }
    };
  }
});

// node_modules/execa/lib/transform/encoding-transform.js
var import_node_buffer2, import_node_string_decoder2, getEncodingTransformGenerator, encodingUint8ArrayGenerator, encodingStringGenerator, encodingStringFinal;
var init_encoding_transform = __esm({
  "node_modules/execa/lib/transform/encoding-transform.js"() {
    import_node_buffer2 = require("node:buffer");
    import_node_string_decoder2 = require("node:string_decoder");
    init_uint_array();
    getEncodingTransformGenerator = (binary, encoding, skipped) => {
      if (skipped) {
        return;
      }
      if (binary) {
        return { transform: encodingUint8ArrayGenerator.bind(void 0, new TextEncoder()) };
      }
      const stringDecoder = new import_node_string_decoder2.StringDecoder(encoding);
      return {
        transform: encodingStringGenerator.bind(void 0, stringDecoder),
        final: encodingStringFinal.bind(void 0, stringDecoder)
      };
    };
    encodingUint8ArrayGenerator = function* (textEncoder3, chunk) {
      if (import_node_buffer2.Buffer.isBuffer(chunk)) {
        yield bufferToUint8Array(chunk);
      } else if (typeof chunk === "string") {
        yield textEncoder3.encode(chunk);
      } else {
        yield chunk;
      }
    };
    encodingStringGenerator = function* (stringDecoder, chunk) {
      yield isUint8Array(chunk) ? stringDecoder.write(chunk) : chunk;
    };
    encodingStringFinal = function* (stringDecoder) {
      const lastChunk = stringDecoder.end();
      if (lastChunk !== "") {
        yield lastChunk;
      }
    };
  }
});

// node_modules/execa/lib/transform/run-async.js
var import_node_util7, pushChunks, transformChunk, finalChunks, generatorFinalChunks, destroyTransform, identityGenerator;
var init_run_async = __esm({
  "node_modules/execa/lib/transform/run-async.js"() {
    import_node_util7 = require("node:util");
    pushChunks = (0, import_node_util7.callbackify)(async (getChunks, state, getChunksArguments, transformStream) => {
      state.currentIterable = getChunks(...getChunksArguments);
      try {
        for await (const chunk of state.currentIterable) {
          transformStream.push(chunk);
        }
      } finally {
        delete state.currentIterable;
      }
    });
    transformChunk = async function* (chunk, generators, index) {
      if (index === generators.length) {
        yield chunk;
        return;
      }
      const { transform = identityGenerator } = generators[index];
      for await (const transformedChunk of transform(chunk)) {
        yield* transformChunk(transformedChunk, generators, index + 1);
      }
    };
    finalChunks = async function* (generators) {
      for (const [index, { final }] of Object.entries(generators)) {
        yield* generatorFinalChunks(final, Number(index), generators);
      }
    };
    generatorFinalChunks = async function* (final, index, generators) {
      if (final === void 0) {
        return;
      }
      for await (const finalChunk of final()) {
        yield* transformChunk(finalChunk, generators, index + 1);
      }
    };
    destroyTransform = (0, import_node_util7.callbackify)(async ({ currentIterable }, error) => {
      if (currentIterable !== void 0) {
        await (error ? currentIterable.throw(error) : currentIterable.return());
        return;
      }
      if (error) {
        throw error;
      }
    });
    identityGenerator = function* (chunk) {
      yield chunk;
    };
  }
});

// node_modules/execa/lib/transform/run-sync.js
var pushChunksSync, runTransformSync, transformChunkSync, finalChunksSync, generatorFinalChunksSync, identityGenerator2;
var init_run_sync = __esm({
  "node_modules/execa/lib/transform/run-sync.js"() {
    pushChunksSync = (getChunksSync, getChunksArguments, transformStream, done) => {
      try {
        for (const chunk of getChunksSync(...getChunksArguments)) {
          transformStream.push(chunk);
        }
        done();
      } catch (error) {
        done(error);
      }
    };
    runTransformSync = (generators, chunks) => [
      ...chunks.flatMap((chunk) => [...transformChunkSync(chunk, generators, 0)]),
      ...finalChunksSync(generators)
    ];
    transformChunkSync = function* (chunk, generators, index) {
      if (index === generators.length) {
        yield chunk;
        return;
      }
      const { transform = identityGenerator2 } = generators[index];
      for (const transformedChunk of transform(chunk)) {
        yield* transformChunkSync(transformedChunk, generators, index + 1);
      }
    };
    finalChunksSync = function* (generators) {
      for (const [index, { final }] of Object.entries(generators)) {
        yield* generatorFinalChunksSync(final, Number(index), generators);
      }
    };
    generatorFinalChunksSync = function* (final, index, generators) {
      if (final === void 0) {
        return;
      }
      for (const finalChunk of final()) {
        yield* transformChunkSync(finalChunk, generators, index + 1);
      }
    };
    identityGenerator2 = function* (chunk) {
      yield chunk;
    };
  }
});

// node_modules/execa/lib/transform/generator.js
var import_node_stream, generatorToStream, runGeneratorsSync, addInternalGenerators;
var init_generator = __esm({
  "node_modules/execa/lib/transform/generator.js"() {
    import_node_stream = require("node:stream");
    init_type();
    init_split();
    init_validate();
    init_encoding_transform();
    init_run_async();
    init_run_sync();
    generatorToStream = ({
      value,
      value: { transform, final, writableObjectMode, readableObjectMode },
      optionName
    }, { encoding }) => {
      const state = {};
      const generators = addInternalGenerators(value, encoding, optionName);
      const transformAsync = isAsyncGenerator(transform);
      const finalAsync = isAsyncGenerator(final);
      const transformMethod = transformAsync ? pushChunks.bind(void 0, transformChunk, state) : pushChunksSync.bind(void 0, transformChunkSync);
      const finalMethod = transformAsync || finalAsync ? pushChunks.bind(void 0, finalChunks, state) : pushChunksSync.bind(void 0, finalChunksSync);
      const destroyMethod = transformAsync || finalAsync ? destroyTransform.bind(void 0, state) : void 0;
      const stream = new import_node_stream.Transform({
        writableObjectMode,
        writableHighWaterMark: (0, import_node_stream.getDefaultHighWaterMark)(writableObjectMode),
        readableObjectMode,
        readableHighWaterMark: (0, import_node_stream.getDefaultHighWaterMark)(readableObjectMode),
        transform(chunk, encoding2, done) {
          transformMethod([chunk, generators, 0], this, done);
        },
        flush(done) {
          finalMethod([generators], this, done);
        },
        destroy: destroyMethod
      });
      return { stream };
    };
    runGeneratorsSync = (chunks, stdioItems, encoding, isInput) => {
      const generators = stdioItems.filter(({ type }) => type === "generator");
      const reversedGenerators = isInput ? generators.reverse() : generators;
      for (const { value, optionName } of reversedGenerators) {
        const generators2 = addInternalGenerators(value, encoding, optionName);
        chunks = runTransformSync(generators2, chunks);
      }
      return chunks;
    };
    addInternalGenerators = ({ transform, final, binary, writableObjectMode, readableObjectMode, preserveNewlines }, encoding, optionName) => {
      const state = {};
      return [
        { transform: getValidateTransformInput(writableObjectMode, optionName) },
        getEncodingTransformGenerator(binary, encoding, writableObjectMode),
        getSplitLinesGenerator(binary, preserveNewlines, writableObjectMode, state),
        { transform, final },
        { transform: getValidateTransformReturn(readableObjectMode, optionName) },
        getAppendNewlineGenerator({
          binary,
          preserveNewlines,
          readableObjectMode,
          state
        })
      ].filter(Boolean);
    };
  }
});

// node_modules/execa/lib/io/input-sync.js
var addInputOptionsSync, getInputFdNumbers, addInputOptionSync, applySingleInputGeneratorsSync, validateSerializable;
var init_input_sync = __esm({
  "node_modules/execa/lib/io/input-sync.js"() {
    init_generator();
    init_uint_array();
    init_type();
    addInputOptionsSync = (fileDescriptors, options) => {
      for (const fdNumber of getInputFdNumbers(fileDescriptors)) {
        addInputOptionSync(fileDescriptors, fdNumber, options);
      }
    };
    getInputFdNumbers = (fileDescriptors) => new Set(Object.entries(fileDescriptors).filter(([, { direction }]) => direction === "input").map(([fdNumber]) => Number(fdNumber)));
    addInputOptionSync = (fileDescriptors, fdNumber, options) => {
      const { stdioItems } = fileDescriptors[fdNumber];
      const allStdioItems = stdioItems.filter(({ contents }) => contents !== void 0);
      if (allStdioItems.length === 0) {
        return;
      }
      if (fdNumber !== 0) {
        const [{ type, optionName }] = allStdioItems;
        throw new TypeError(`Only the \`stdin\` option, not \`${optionName}\`, can be ${TYPE_TO_MESSAGE[type]} with synchronous methods.`);
      }
      const allContents = allStdioItems.map(({ contents }) => contents);
      const transformedContents = allContents.map((contents) => applySingleInputGeneratorsSync(contents, stdioItems));
      options.input = joinToUint8Array(transformedContents);
    };
    applySingleInputGeneratorsSync = (contents, stdioItems) => {
      const newContents = runGeneratorsSync(contents, stdioItems, "utf8", true);
      validateSerializable(newContents);
      return joinToUint8Array(newContents);
    };
    validateSerializable = (newContents) => {
      const invalidItem = newContents.find((item) => typeof item !== "string" && !isUint8Array(item));
      if (invalidItem !== void 0) {
        throw new TypeError(`The \`stdin\` option is invalid: when passing objects as input, a transform must be used to serialize them to strings or Uint8Arrays: ${invalidItem}.`);
      }
    };
  }
});

// node_modules/execa/lib/verbose/output.js
var shouldLogOutput, fdUsesVerbose, PIPED_STDIO_VALUES, logLines, logLinesSync, isPipingStream, logLine;
var init_output = __esm({
  "node_modules/execa/lib/verbose/output.js"() {
    init_encoding_option();
    init_type();
    init_log2();
    init_values();
    shouldLogOutput = ({ stdioItems, encoding, verboseInfo, fdNumber }) => fdNumber !== "all" && isFullVerbose(verboseInfo, fdNumber) && !BINARY_ENCODINGS.has(encoding) && fdUsesVerbose(fdNumber) && (stdioItems.some(({ type, value }) => type === "native" && PIPED_STDIO_VALUES.has(value)) || stdioItems.every(({ type }) => TRANSFORM_TYPES.has(type)));
    fdUsesVerbose = (fdNumber) => fdNumber === 1 || fdNumber === 2;
    PIPED_STDIO_VALUES = /* @__PURE__ */ new Set(["pipe", "overlapped"]);
    logLines = async (linesIterable, stream, fdNumber, verboseInfo) => {
      for await (const line of linesIterable) {
        if (!isPipingStream(stream)) {
          logLine(line, fdNumber, verboseInfo);
        }
      }
    };
    logLinesSync = (linesArray, fdNumber, verboseInfo) => {
      for (const line of linesArray) {
        logLine(line, fdNumber, verboseInfo);
      }
    };
    isPipingStream = (stream) => stream._readableState.pipes.length > 0;
    logLine = (line, fdNumber, verboseInfo) => {
      const verboseMessage = serializeVerboseMessage(line);
      verboseLog({
        type: "output",
        verboseMessage,
        fdNumber,
        verboseInfo
      });
    };
  }
});

// node_modules/execa/lib/io/output-sync.js
var import_node_fs11, transformOutputSync, transformOutputResultSync, runOutputGeneratorsSync, serializeChunks, logOutputSync, writeToFiles;
var init_output_sync = __esm({
  "node_modules/execa/lib/io/output-sync.js"() {
    import_node_fs11 = require("node:fs");
    init_output();
    init_generator();
    init_split();
    init_uint_array();
    init_type();
    init_max_buffer();
    transformOutputSync = ({ fileDescriptors, syncResult: { output }, options, isMaxBuffer, verboseInfo }) => {
      if (output === null) {
        return { output: Array.from({ length: 3 }) };
      }
      const state = {};
      const outputFiles = /* @__PURE__ */ new Set([]);
      const transformedOutput = output.map((result, fdNumber) => transformOutputResultSync({
        result,
        fileDescriptors,
        fdNumber,
        state,
        outputFiles,
        isMaxBuffer,
        verboseInfo
      }, options));
      return { output: transformedOutput, ...state };
    };
    transformOutputResultSync = ({ result, fileDescriptors, fdNumber, state, outputFiles, isMaxBuffer, verboseInfo }, { buffer, encoding, lines, stripFinalNewline: stripFinalNewline2, maxBuffer }) => {
      if (result === null) {
        return;
      }
      const truncatedResult = truncateMaxBufferSync(result, isMaxBuffer, maxBuffer);
      const uint8ArrayResult = bufferToUint8Array(truncatedResult);
      const { stdioItems, objectMode } = fileDescriptors[fdNumber];
      const chunks = runOutputGeneratorsSync([uint8ArrayResult], stdioItems, encoding, state);
      const { serializedResult, finalResult = serializedResult } = serializeChunks({
        chunks,
        objectMode,
        encoding,
        lines,
        stripFinalNewline: stripFinalNewline2,
        fdNumber
      });
      logOutputSync({
        serializedResult,
        fdNumber,
        state,
        verboseInfo,
        encoding,
        stdioItems,
        objectMode
      });
      const returnedResult = buffer[fdNumber] ? finalResult : void 0;
      try {
        if (state.error === void 0) {
          writeToFiles(serializedResult, stdioItems, outputFiles);
        }
        return returnedResult;
      } catch (error) {
        state.error = error;
        return returnedResult;
      }
    };
    runOutputGeneratorsSync = (chunks, stdioItems, encoding, state) => {
      try {
        return runGeneratorsSync(chunks, stdioItems, encoding, false);
      } catch (error) {
        state.error = error;
        return chunks;
      }
    };
    serializeChunks = ({ chunks, objectMode, encoding, lines, stripFinalNewline: stripFinalNewline2, fdNumber }) => {
      if (objectMode) {
        return { serializedResult: chunks };
      }
      if (encoding === "buffer") {
        return { serializedResult: joinToUint8Array(chunks) };
      }
      const serializedResult = joinToString(chunks, encoding);
      if (lines[fdNumber]) {
        return { serializedResult, finalResult: splitLinesSync(serializedResult, !stripFinalNewline2[fdNumber], objectMode) };
      }
      return { serializedResult };
    };
    logOutputSync = ({ serializedResult, fdNumber, state, verboseInfo, encoding, stdioItems, objectMode }) => {
      if (!shouldLogOutput({
        stdioItems,
        encoding,
        verboseInfo,
        fdNumber
      })) {
        return;
      }
      const linesArray = splitLinesSync(serializedResult, false, objectMode);
      try {
        logLinesSync(linesArray, fdNumber, verboseInfo);
      } catch (error) {
        state.error ??= error;
      }
    };
    writeToFiles = (serializedResult, stdioItems, outputFiles) => {
      for (const { path: path6, append } of stdioItems.filter(({ type }) => FILE_TYPES.has(type))) {
        const pathString = typeof path6 === "string" ? path6 : path6.toString();
        if (append || outputFiles.has(pathString)) {
          (0, import_node_fs11.appendFileSync)(path6, serializedResult);
        } else {
          outputFiles.add(pathString);
          (0, import_node_fs11.writeFileSync)(path6, serializedResult);
        }
      }
    };
  }
});

// node_modules/execa/lib/resolve/all-sync.js
var getAllSync;
var init_all_sync = __esm({
  "node_modules/execa/lib/resolve/all-sync.js"() {
    init_uint_array();
    init_strip_newline();
    getAllSync = ([, stdout, stderr], options) => {
      if (!options.all) {
        return;
      }
      if (stdout === void 0) {
        return stderr;
      }
      if (stderr === void 0) {
        return stdout;
      }
      if (Array.isArray(stdout)) {
        return Array.isArray(stderr) ? [...stdout, ...stderr] : [...stdout, stripNewline(stderr, options, "all")];
      }
      if (Array.isArray(stderr)) {
        return [stripNewline(stdout, options, "all"), ...stderr];
      }
      if (isUint8Array(stdout) && isUint8Array(stderr)) {
        return concatUint8Arrays([stdout, stderr]);
      }
      return `${stdout}${stderr}`;
    };
  }
});

// node_modules/execa/lib/resolve/exit-async.js
var import_node_events7, waitForExit, waitForExitOrError, waitForSubprocessExit, waitForSuccessfulExit, isSubprocessErrorExit, isFailedExit;
var init_exit_async = __esm({
  "node_modules/execa/lib/resolve/exit-async.js"() {
    import_node_events7 = require("node:events");
    init_final_error();
    waitForExit = async (subprocess, context) => {
      const [exitCode, signal] = await waitForExitOrError(subprocess);
      context.isForcefullyTerminated ??= false;
      return [exitCode, signal];
    };
    waitForExitOrError = async (subprocess) => {
      const [spawnPayload, exitPayload] = await Promise.allSettled([
        (0, import_node_events7.once)(subprocess, "spawn"),
        (0, import_node_events7.once)(subprocess, "exit")
      ]);
      if (spawnPayload.status === "rejected") {
        return [];
      }
      return exitPayload.status === "rejected" ? waitForSubprocessExit(subprocess) : exitPayload.value;
    };
    waitForSubprocessExit = async (subprocess) => {
      try {
        return await (0, import_node_events7.once)(subprocess, "exit");
      } catch {
        return waitForSubprocessExit(subprocess);
      }
    };
    waitForSuccessfulExit = async (exitPromise) => {
      const [exitCode, signal] = await exitPromise;
      if (!isSubprocessErrorExit(exitCode, signal) && isFailedExit(exitCode, signal)) {
        throw new DiscardedError();
      }
      return [exitCode, signal];
    };
    isSubprocessErrorExit = (exitCode, signal) => exitCode === void 0 && signal === void 0;
    isFailedExit = (exitCode, signal) => exitCode !== 0 || signal !== null;
  }
});

// node_modules/execa/lib/resolve/exit-sync.js
var getExitResultSync, getResultError;
var init_exit_sync = __esm({
  "node_modules/execa/lib/resolve/exit-sync.js"() {
    init_final_error();
    init_max_buffer();
    init_exit_async();
    getExitResultSync = ({ error, status: exitCode, signal, output }, { maxBuffer }) => {
      const resultError = getResultError(error, exitCode, signal);
      const timedOut = resultError?.code === "ETIMEDOUT";
      const isMaxBuffer = isMaxBufferSync(resultError, output, maxBuffer);
      return {
        resultError,
        exitCode,
        signal,
        timedOut,
        isMaxBuffer
      };
    };
    getResultError = (error, exitCode, signal) => {
      if (error !== void 0) {
        return error;
      }
      return isFailedExit(exitCode, signal) ? new DiscardedError() : void 0;
    };
  }
});

// node_modules/execa/lib/methods/main-sync.js
var import_node_child_process5, execaCoreSync, handleSyncArguments, normalizeSyncOptions, validateSyncOptions, throwInvalidSyncOption, spawnSubprocessSync, runSubprocessSync, normalizeSpawnSyncOptions, getSyncResult;
var init_main_sync = __esm({
  "node_modules/execa/lib/methods/main-sync.js"() {
    import_node_child_process5 = require("node:child_process");
    init_command();
    init_options();
    init_shell();
    init_result();
    init_reject();
    init_handle_sync();
    init_strip_newline();
    init_input_sync();
    init_output_sync();
    init_max_buffer();
    init_all_sync();
    init_exit_sync();
    execaCoreSync = (rawFile, rawArguments, rawOptions) => {
      const { file, commandArguments, command, escapedCommand, startTime, verboseInfo, options, fileDescriptors } = handleSyncArguments(rawFile, rawArguments, rawOptions);
      const result = spawnSubprocessSync({
        file,
        commandArguments,
        options,
        command,
        escapedCommand,
        verboseInfo,
        fileDescriptors,
        startTime
      });
      return handleResult(result, verboseInfo, options);
    };
    handleSyncArguments = (rawFile, rawArguments, rawOptions) => {
      const { command, escapedCommand, startTime, verboseInfo } = handleCommand(rawFile, rawArguments, rawOptions);
      const syncOptions = normalizeSyncOptions(rawOptions);
      const { file, commandArguments, options } = normalizeOptions(rawFile, rawArguments, syncOptions);
      validateSyncOptions(options);
      const fileDescriptors = handleStdioSync(options, verboseInfo);
      return {
        file,
        commandArguments,
        command,
        escapedCommand,
        startTime,
        verboseInfo,
        options,
        fileDescriptors
      };
    };
    normalizeSyncOptions = (options) => options.node && !options.ipc ? { ...options, ipc: false } : options;
    validateSyncOptions = ({ ipc, ipcInput, detached, cancelSignal }) => {
      if (ipcInput) {
        throwInvalidSyncOption("ipcInput");
      }
      if (ipc) {
        throwInvalidSyncOption("ipc: true");
      }
      if (detached) {
        throwInvalidSyncOption("detached: true");
      }
      if (cancelSignal) {
        throwInvalidSyncOption("cancelSignal");
      }
    };
    throwInvalidSyncOption = (value) => {
      throw new TypeError(`The "${value}" option cannot be used with synchronous methods.`);
    };
    spawnSubprocessSync = ({ file, commandArguments, options, command, escapedCommand, verboseInfo, fileDescriptors, startTime }) => {
      const syncResult = runSubprocessSync({
        file,
        commandArguments,
        options,
        command,
        escapedCommand,
        fileDescriptors,
        startTime
      });
      if (syncResult.failed) {
        return syncResult;
      }
      const { resultError, exitCode, signal, timedOut, isMaxBuffer } = getExitResultSync(syncResult, options);
      const { output, error = resultError } = transformOutputSync({
        fileDescriptors,
        syncResult,
        options,
        isMaxBuffer,
        verboseInfo
      });
      const stdio = output.map((stdioOutput, fdNumber) => stripNewline(stdioOutput, options, fdNumber));
      const all = stripNewline(getAllSync(output, options), options, "all");
      return getSyncResult({
        error,
        exitCode,
        signal,
        timedOut,
        isMaxBuffer,
        stdio,
        all,
        options,
        command,
        escapedCommand,
        startTime
      });
    };
    runSubprocessSync = ({ file, commandArguments, options, command, escapedCommand, fileDescriptors, startTime }) => {
      try {
        addInputOptionsSync(fileDescriptors, options);
        const normalizedOptions = normalizeSpawnSyncOptions(options);
        return (0, import_node_child_process5.spawnSync)(...concatenateShell(file, commandArguments, normalizedOptions));
      } catch (error) {
        return makeEarlyError({
          error,
          command,
          escapedCommand,
          fileDescriptors,
          options,
          startTime,
          isSync: true
        });
      }
    };
    normalizeSpawnSyncOptions = ({ encoding, maxBuffer, ...options }) => ({ ...options, encoding: "buffer", maxBuffer: getMaxBufferSync(maxBuffer) });
    getSyncResult = ({ error, exitCode, signal, timedOut, isMaxBuffer, stdio, all, options, command, escapedCommand, startTime }) => error === void 0 ? makeSuccessResult({
      command,
      escapedCommand,
      stdio,
      all,
      ipcOutput: [],
      options,
      startTime
    }) : makeError({
      error,
      command,
      escapedCommand,
      timedOut,
      isCanceled: false,
      isGracefullyCanceled: false,
      isMaxBuffer,
      isForcefullyTerminated: false,
      exitCode,
      signal,
      stdio,
      all,
      ipcOutput: [],
      options,
      startTime,
      isSync: true
    });
  }
});

// node_modules/execa/lib/ipc/get-one.js
var import_node_events8, getOneMessage, getOneMessageAsync, getMessage, throwOnDisconnect2, throwOnStrictError;
var init_get_one = __esm({
  "node_modules/execa/lib/ipc/get-one.js"() {
    import_node_events8 = require("node:events");
    init_validation();
    init_forward();
    init_reference();
    getOneMessage = ({ anyProcess, channel, isSubprocess, ipc }, { reference = true, filter } = {}) => {
      validateIpcMethod({
        methodName: "getOneMessage",
        isSubprocess,
        ipc,
        isConnected: isConnected(anyProcess)
      });
      return getOneMessageAsync({
        anyProcess,
        channel,
        isSubprocess,
        filter,
        reference
      });
    };
    getOneMessageAsync = async ({ anyProcess, channel, isSubprocess, filter, reference }) => {
      addReference(channel, reference);
      const ipcEmitter = getIpcEmitter(anyProcess, channel, isSubprocess);
      const controller = new AbortController();
      try {
        return await Promise.race([
          getMessage(ipcEmitter, filter, controller),
          throwOnDisconnect2(ipcEmitter, isSubprocess, controller),
          throwOnStrictError(ipcEmitter, isSubprocess, controller)
        ]);
      } catch (error) {
        disconnect(anyProcess);
        throw error;
      } finally {
        controller.abort();
        removeReference(channel, reference);
      }
    };
    getMessage = async (ipcEmitter, filter, { signal }) => {
      if (filter === void 0) {
        const [message] = await (0, import_node_events8.once)(ipcEmitter, "message", { signal });
        return message;
      }
      for await (const [message] of (0, import_node_events8.on)(ipcEmitter, "message", { signal })) {
        if (filter(message)) {
          return message;
        }
      }
    };
    throwOnDisconnect2 = async (ipcEmitter, isSubprocess, { signal }) => {
      await (0, import_node_events8.once)(ipcEmitter, "disconnect", { signal });
      throwOnEarlyDisconnect(isSubprocess);
    };
    throwOnStrictError = async (ipcEmitter, isSubprocess, { signal }) => {
      const [error] = await (0, import_node_events8.once)(ipcEmitter, "strict:error", { signal });
      throw getStrictResponseError(error, isSubprocess);
    };
  }
});

// node_modules/execa/lib/ipc/get-each.js
var import_node_events9, getEachMessage, loopOnMessages, stopOnDisconnect, abortOnStrictError, iterateOnMessages, throwIfStrictError;
var init_get_each = __esm({
  "node_modules/execa/lib/ipc/get-each.js"() {
    import_node_events9 = require("node:events");
    init_validation();
    init_forward();
    init_reference();
    getEachMessage = ({ anyProcess, channel, isSubprocess, ipc }, { reference = true } = {}) => loopOnMessages({
      anyProcess,
      channel,
      isSubprocess,
      ipc,
      shouldAwait: !isSubprocess,
      reference
    });
    loopOnMessages = ({ anyProcess, channel, isSubprocess, ipc, shouldAwait, reference }) => {
      validateIpcMethod({
        methodName: "getEachMessage",
        isSubprocess,
        ipc,
        isConnected: isConnected(anyProcess)
      });
      addReference(channel, reference);
      const ipcEmitter = getIpcEmitter(anyProcess, channel, isSubprocess);
      const controller = new AbortController();
      const state = {};
      stopOnDisconnect(anyProcess, ipcEmitter, controller);
      abortOnStrictError({
        ipcEmitter,
        isSubprocess,
        controller,
        state
      });
      return iterateOnMessages({
        anyProcess,
        channel,
        ipcEmitter,
        isSubprocess,
        shouldAwait,
        controller,
        state,
        reference
      });
    };
    stopOnDisconnect = async (anyProcess, ipcEmitter, controller) => {
      try {
        await (0, import_node_events9.once)(ipcEmitter, "disconnect", { signal: controller.signal });
        controller.abort();
      } catch {
      }
    };
    abortOnStrictError = async ({ ipcEmitter, isSubprocess, controller, state }) => {
      try {
        const [error] = await (0, import_node_events9.once)(ipcEmitter, "strict:error", { signal: controller.signal });
        state.error = getStrictResponseError(error, isSubprocess);
        controller.abort();
      } catch {
      }
    };
    iterateOnMessages = async function* ({ anyProcess, channel, ipcEmitter, isSubprocess, shouldAwait, controller, state, reference }) {
      try {
        for await (const [message] of (0, import_node_events9.on)(ipcEmitter, "message", { signal: controller.signal })) {
          throwIfStrictError(state);
          yield message;
        }
      } catch {
        throwIfStrictError(state);
      } finally {
        controller.abort();
        removeReference(channel, reference);
        if (!isSubprocess) {
          disconnect(anyProcess);
        }
        if (shouldAwait) {
          await anyProcess;
        }
      }
    };
    throwIfStrictError = ({ error }) => {
      if (error) {
        throw error;
      }
    };
  }
});

// node_modules/execa/lib/ipc/methods.js
var import_node_process10, addIpcMethods, getIpcExport, getIpcMethods;
var init_methods = __esm({
  "node_modules/execa/lib/ipc/methods.js"() {
    import_node_process10 = __toESM(require("node:process"), 1);
    init_send();
    init_get_one();
    init_get_each();
    init_graceful();
    addIpcMethods = (subprocess, { ipc }) => {
      Object.assign(subprocess, getIpcMethods(subprocess, false, ipc));
    };
    getIpcExport = () => {
      const anyProcess = import_node_process10.default;
      const isSubprocess = true;
      const ipc = import_node_process10.default.channel !== void 0;
      return {
        ...getIpcMethods(anyProcess, isSubprocess, ipc),
        getCancelSignal: getCancelSignal.bind(void 0, {
          anyProcess,
          channel: anyProcess.channel,
          isSubprocess,
          ipc
        })
      };
    };
    getIpcMethods = (anyProcess, isSubprocess, ipc) => ({
      sendMessage: sendMessage.bind(void 0, {
        anyProcess,
        channel: anyProcess.channel,
        isSubprocess,
        ipc
      }),
      getOneMessage: getOneMessage.bind(void 0, {
        anyProcess,
        channel: anyProcess.channel,
        isSubprocess,
        ipc
      }),
      getEachMessage: getEachMessage.bind(void 0, {
        anyProcess,
        channel: anyProcess.channel,
        isSubprocess,
        ipc
      })
    });
  }
});

// node_modules/execa/lib/return/early-error.js
var import_node_child_process6, import_node_stream2, handleEarlyError, createDummyStreams, createDummyStream, readable, writable, duplex, handleDummyPromise;
var init_early_error = __esm({
  "node_modules/execa/lib/return/early-error.js"() {
    import_node_child_process6 = require("node:child_process");
    import_node_stream2 = require("node:stream");
    init_handle();
    init_result();
    init_reject();
    handleEarlyError = ({ error, command, escapedCommand, fileDescriptors, options, startTime, verboseInfo }) => {
      cleanupCustomStreams(fileDescriptors);
      const subprocess = new import_node_child_process6.ChildProcess();
      createDummyStreams(subprocess, fileDescriptors);
      Object.assign(subprocess, { readable, writable, duplex });
      const earlyError = makeEarlyError({
        error,
        command,
        escapedCommand,
        fileDescriptors,
        options,
        startTime,
        isSync: false
      });
      const promise = handleDummyPromise(earlyError, verboseInfo, options);
      return { subprocess, promise };
    };
    createDummyStreams = (subprocess, fileDescriptors) => {
      const stdin = createDummyStream();
      const stdout = createDummyStream();
      const stderr = createDummyStream();
      const extraStdio = Array.from({ length: fileDescriptors.length - 3 }, createDummyStream);
      const all = createDummyStream();
      const stdio = [stdin, stdout, stderr, ...extraStdio];
      Object.assign(subprocess, {
        stdin,
        stdout,
        stderr,
        all,
        stdio
      });
    };
    createDummyStream = () => {
      const stream = new import_node_stream2.PassThrough();
      stream.end();
      return stream;
    };
    readable = () => new import_node_stream2.Readable({ read() {
    } });
    writable = () => new import_node_stream2.Writable({ write() {
    } });
    duplex = () => new import_node_stream2.Duplex({ read() {
    }, write() {
    } });
    handleDummyPromise = async (error, verboseInfo, options) => handleResult(error, verboseInfo, options);
  }
});

// node_modules/execa/lib/stdio/handle-async.js
var import_node_fs12, import_node_buffer3, import_node_stream3, handleStdioAsync, forbiddenIfAsync, addProperties2, addPropertiesAsync;
var init_handle_async = __esm({
  "node_modules/execa/lib/stdio/handle-async.js"() {
    import_node_fs12 = require("node:fs");
    import_node_buffer3 = require("node:buffer");
    import_node_stream3 = require("node:stream");
    init_generator();
    init_handle();
    init_type();
    handleStdioAsync = (options, verboseInfo) => handleStdio(addPropertiesAsync, options, verboseInfo, false);
    forbiddenIfAsync = ({ type, optionName }) => {
      throw new TypeError(`The \`${optionName}\` option cannot be ${TYPE_TO_MESSAGE[type]}.`);
    };
    addProperties2 = {
      fileNumber: forbiddenIfAsync,
      generator: generatorToStream,
      asyncGenerator: generatorToStream,
      nodeStream: ({ value }) => ({ stream: value }),
      webTransform({ value: { transform, writableObjectMode, readableObjectMode } }) {
        const objectMode = writableObjectMode || readableObjectMode;
        const stream = import_node_stream3.Duplex.fromWeb(transform, { objectMode });
        return { stream };
      },
      duplex: ({ value: { transform } }) => ({ stream: transform }),
      native() {
      }
    };
    addPropertiesAsync = {
      input: {
        ...addProperties2,
        fileUrl: ({ value }) => ({ stream: (0, import_node_fs12.createReadStream)(value) }),
        filePath: ({ value: { file } }) => ({ stream: (0, import_node_fs12.createReadStream)(file) }),
        webStream: ({ value }) => ({ stream: import_node_stream3.Readable.fromWeb(value) }),
        iterable: ({ value }) => ({ stream: import_node_stream3.Readable.from(value) }),
        asyncIterable: ({ value }) => ({ stream: import_node_stream3.Readable.from(value) }),
        string: ({ value }) => ({ stream: import_node_stream3.Readable.from(value) }),
        uint8Array: ({ value }) => ({ stream: import_node_stream3.Readable.from(import_node_buffer3.Buffer.from(value)) })
      },
      output: {
        ...addProperties2,
        fileUrl: ({ value }) => ({ stream: (0, import_node_fs12.createWriteStream)(value) }),
        filePath: ({ value: { file, append } }) => ({ stream: (0, import_node_fs12.createWriteStream)(file, append ? { flags: "a" } : {}) }),
        webStream: ({ value }) => ({ stream: import_node_stream3.Writable.fromWeb(value) }),
        iterable: forbiddenIfAsync,
        asyncIterable: forbiddenIfAsync,
        string: forbiddenIfAsync,
        uint8Array: forbiddenIfAsync
      }
    };
  }
});

// node_modules/@sindresorhus/merge-streams/index.js
function mergeStreams(streams) {
  if (!Array.isArray(streams)) {
    throw new TypeError(`Expected an array, got \`${typeof streams}\`.`);
  }
  for (const stream of streams) {
    validateStream(stream);
  }
  const objectMode = streams.some(({ readableObjectMode }) => readableObjectMode);
  const highWaterMark = getHighWaterMark(streams, objectMode);
  const passThroughStream = new MergedStream({
    objectMode,
    writableHighWaterMark: highWaterMark,
    readableHighWaterMark: highWaterMark
  });
  for (const stream of streams) {
    passThroughStream.add(stream);
  }
  return passThroughStream;
}
var import_node_events10, import_node_stream4, import_promises6, getHighWaterMark, MergedStream, onMergedStreamFinished, onMergedStreamEnd, onInputStreamsUnpipe, validateStream, endWhenStreamsDone, afterMergedStreamFinished, onInputStreamEnd, onInputStreamUnpipe, endStream, errorOrAbortStream, isAbortError, abortStream, errorStream, noop2, updateMaxListeners, PASSTHROUGH_LISTENERS_COUNT, PASSTHROUGH_LISTENERS_PER_STREAM;
var init_merge_streams = __esm({
  "node_modules/@sindresorhus/merge-streams/index.js"() {
    import_node_events10 = require("node:events");
    import_node_stream4 = require("node:stream");
    import_promises6 = require("node:stream/promises");
    getHighWaterMark = (streams, objectMode) => {
      if (streams.length === 0) {
        return (0, import_node_stream4.getDefaultHighWaterMark)(objectMode);
      }
      const highWaterMarks = streams.filter(({ readableObjectMode }) => readableObjectMode === objectMode).map(({ readableHighWaterMark }) => readableHighWaterMark);
      return Math.max(...highWaterMarks);
    };
    MergedStream = class extends import_node_stream4.PassThrough {
      #streams = /* @__PURE__ */ new Set([]);
      #ended = /* @__PURE__ */ new Set([]);
      #aborted = /* @__PURE__ */ new Set([]);
      #onFinished;
      #unpipeEvent = Symbol("unpipe");
      #streamPromises = /* @__PURE__ */ new WeakMap();
      add(stream) {
        validateStream(stream);
        if (this.#streams.has(stream)) {
          return;
        }
        this.#streams.add(stream);
        this.#onFinished ??= onMergedStreamFinished(this, this.#streams, this.#unpipeEvent);
        const streamPromise = endWhenStreamsDone({
          passThroughStream: this,
          stream,
          streams: this.#streams,
          ended: this.#ended,
          aborted: this.#aborted,
          onFinished: this.#onFinished,
          unpipeEvent: this.#unpipeEvent
        });
        this.#streamPromises.set(stream, streamPromise);
        stream.pipe(this, { end: false });
      }
      async remove(stream) {
        validateStream(stream);
        if (!this.#streams.has(stream)) {
          return false;
        }
        const streamPromise = this.#streamPromises.get(stream);
        if (streamPromise === void 0) {
          return false;
        }
        this.#streamPromises.delete(stream);
        stream.unpipe(this);
        await streamPromise;
        return true;
      }
    };
    onMergedStreamFinished = async (passThroughStream, streams, unpipeEvent) => {
      updateMaxListeners(passThroughStream, PASSTHROUGH_LISTENERS_COUNT);
      const controller = new AbortController();
      try {
        await Promise.race([
          onMergedStreamEnd(passThroughStream, controller),
          onInputStreamsUnpipe(passThroughStream, streams, unpipeEvent, controller)
        ]);
      } finally {
        controller.abort();
        updateMaxListeners(passThroughStream, -PASSTHROUGH_LISTENERS_COUNT);
      }
    };
    onMergedStreamEnd = async (passThroughStream, { signal }) => {
      try {
        await (0, import_promises6.finished)(passThroughStream, { signal, cleanup: true });
      } catch (error) {
        errorOrAbortStream(passThroughStream, error);
        throw error;
      }
    };
    onInputStreamsUnpipe = async (passThroughStream, streams, unpipeEvent, { signal }) => {
      for await (const [unpipedStream] of (0, import_node_events10.on)(passThroughStream, "unpipe", { signal })) {
        if (streams.has(unpipedStream)) {
          unpipedStream.emit(unpipeEvent);
        }
      }
    };
    validateStream = (stream) => {
      if (typeof stream?.pipe !== "function") {
        throw new TypeError(`Expected a readable stream, got: \`${typeof stream}\`.`);
      }
    };
    endWhenStreamsDone = async ({ passThroughStream, stream, streams, ended, aborted: aborted2, onFinished, unpipeEvent }) => {
      updateMaxListeners(passThroughStream, PASSTHROUGH_LISTENERS_PER_STREAM);
      const controller = new AbortController();
      try {
        await Promise.race([
          afterMergedStreamFinished(onFinished, stream, controller),
          onInputStreamEnd({
            passThroughStream,
            stream,
            streams,
            ended,
            aborted: aborted2,
            controller
          }),
          onInputStreamUnpipe({
            stream,
            streams,
            ended,
            aborted: aborted2,
            unpipeEvent,
            controller
          })
        ]);
      } finally {
        controller.abort();
        updateMaxListeners(passThroughStream, -PASSTHROUGH_LISTENERS_PER_STREAM);
      }
      if (streams.size > 0 && streams.size === ended.size + aborted2.size) {
        if (ended.size === 0 && aborted2.size > 0) {
          abortStream(passThroughStream);
        } else {
          endStream(passThroughStream);
        }
      }
    };
    afterMergedStreamFinished = async (onFinished, stream, { signal }) => {
      try {
        await onFinished;
        if (!signal.aborted) {
          abortStream(stream);
        }
      } catch (error) {
        if (!signal.aborted) {
          errorOrAbortStream(stream, error);
        }
      }
    };
    onInputStreamEnd = async ({ passThroughStream, stream, streams, ended, aborted: aborted2, controller: { signal } }) => {
      try {
        await (0, import_promises6.finished)(stream, {
          signal,
          cleanup: true,
          readable: true,
          writable: false
        });
        if (streams.has(stream)) {
          ended.add(stream);
        }
      } catch (error) {
        if (signal.aborted || !streams.has(stream)) {
          return;
        }
        if (isAbortError(error)) {
          aborted2.add(stream);
        } else {
          errorStream(passThroughStream, error);
        }
      }
    };
    onInputStreamUnpipe = async ({ stream, streams, ended, aborted: aborted2, unpipeEvent, controller: { signal } }) => {
      await (0, import_node_events10.once)(stream, unpipeEvent, { signal });
      if (!stream.readable) {
        return (0, import_node_events10.once)(signal, "abort", { signal });
      }
      streams.delete(stream);
      ended.delete(stream);
      aborted2.delete(stream);
    };
    endStream = (stream) => {
      if (stream.writable) {
        stream.end();
      }
    };
    errorOrAbortStream = (stream, error) => {
      if (isAbortError(error)) {
        abortStream(stream);
      } else {
        errorStream(stream, error);
      }
    };
    isAbortError = (error) => error?.code === "ERR_STREAM_PREMATURE_CLOSE";
    abortStream = (stream) => {
      if (stream.readable || stream.writable) {
        stream.destroy();
      }
    };
    errorStream = (stream, error) => {
      if (!stream.destroyed) {
        stream.once("error", noop2);
        stream.destroy(error);
      }
    };
    noop2 = () => {
    };
    updateMaxListeners = (passThroughStream, increment2) => {
      const maxListeners = passThroughStream.getMaxListeners();
      if (maxListeners !== 0 && maxListeners !== Number.POSITIVE_INFINITY) {
        passThroughStream.setMaxListeners(maxListeners + increment2);
      }
    };
    PASSTHROUGH_LISTENERS_COUNT = 2;
    PASSTHROUGH_LISTENERS_PER_STREAM = 1;
  }
});

// node_modules/execa/lib/io/pipeline.js
var import_promises7, pipeStreams, onSourceFinish, endDestinationStream, onDestinationFinish, abortSourceStream;
var init_pipeline = __esm({
  "node_modules/execa/lib/io/pipeline.js"() {
    import_promises7 = require("node:stream/promises");
    init_standard_stream();
    pipeStreams = (source, destination) => {
      source.pipe(destination);
      onSourceFinish(source, destination);
      onDestinationFinish(source, destination);
    };
    onSourceFinish = async (source, destination) => {
      if (isStandardStream(source) || isStandardStream(destination)) {
        return;
      }
      try {
        await (0, import_promises7.finished)(source, { cleanup: true, readable: true, writable: false });
      } catch {
      }
      endDestinationStream(destination);
    };
    endDestinationStream = (destination) => {
      if (destination.writable) {
        destination.end();
      }
    };
    onDestinationFinish = async (source, destination) => {
      if (isStandardStream(source) || isStandardStream(destination)) {
        return;
      }
      try {
        await (0, import_promises7.finished)(destination, { cleanup: true, readable: false, writable: true });
      } catch {
      }
      abortSourceStream(source);
    };
    abortSourceStream = (source) => {
      if (source.readable) {
        source.destroy();
      }
    };
  }
});

// node_modules/execa/lib/io/output-async.js
var pipeOutputAsync, pipeTransform, SUBPROCESS_STREAM_PROPERTIES, pipeStdioItem, setStandardStreamMaxListeners, MAX_LISTENERS_INCREMENT;
var init_output_async = __esm({
  "node_modules/execa/lib/io/output-async.js"() {
    init_merge_streams();
    init_standard_stream();
    init_max_listeners();
    init_type();
    init_pipeline();
    pipeOutputAsync = (subprocess, fileDescriptors, controller) => {
      const pipeGroups = /* @__PURE__ */ new Map();
      for (const [fdNumber, { stdioItems, direction }] of Object.entries(fileDescriptors)) {
        for (const { stream } of stdioItems.filter(({ type }) => TRANSFORM_TYPES.has(type))) {
          pipeTransform(subprocess, stream, direction, fdNumber);
        }
        for (const { stream } of stdioItems.filter(({ type }) => !TRANSFORM_TYPES.has(type))) {
          pipeStdioItem({
            subprocess,
            stream,
            direction,
            fdNumber,
            pipeGroups,
            controller
          });
        }
      }
      for (const [outputStream, inputStreams] of pipeGroups.entries()) {
        const inputStream = inputStreams.length === 1 ? inputStreams[0] : mergeStreams(inputStreams);
        pipeStreams(inputStream, outputStream);
      }
    };
    pipeTransform = (subprocess, stream, direction, fdNumber) => {
      if (direction === "output") {
        pipeStreams(subprocess.stdio[fdNumber], stream);
      } else {
        pipeStreams(stream, subprocess.stdio[fdNumber]);
      }
      const streamProperty = SUBPROCESS_STREAM_PROPERTIES[fdNumber];
      if (streamProperty !== void 0) {
        subprocess[streamProperty] = stream;
      }
      subprocess.stdio[fdNumber] = stream;
    };
    SUBPROCESS_STREAM_PROPERTIES = ["stdin", "stdout", "stderr"];
    pipeStdioItem = ({ subprocess, stream, direction, fdNumber, pipeGroups, controller }) => {
      if (stream === void 0) {
        return;
      }
      setStandardStreamMaxListeners(stream, controller);
      const [inputStream, outputStream] = direction === "output" ? [stream, subprocess.stdio[fdNumber]] : [subprocess.stdio[fdNumber], stream];
      const outputStreams = pipeGroups.get(inputStream) ?? [];
      pipeGroups.set(inputStream, [...outputStreams, outputStream]);
    };
    setStandardStreamMaxListeners = (stream, { signal }) => {
      if (isStandardStream(stream)) {
        incrementMaxListeners(stream, MAX_LISTENERS_INCREMENT, signal);
      }
    };
    MAX_LISTENERS_INCREMENT = 2;
  }
});

// node_modules/signal-exit/dist/mjs/signals.js
var signals;
var init_signals2 = __esm({
  "node_modules/signal-exit/dist/mjs/signals.js"() {
    signals = [];
    signals.push("SIGHUP", "SIGINT", "SIGTERM");
    if (process.platform !== "win32") {
      signals.push(
        "SIGALRM",
        "SIGABRT",
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
    }
  }
});

// node_modules/signal-exit/dist/mjs/index.js
var processOk, kExitEmitter, global2, ObjectDefineProperty, Emitter, SignalExitBase, signalExitWrap, SignalExitFallback, SignalExit, process9, onExit, load2, unload;
var init_mjs = __esm({
  "node_modules/signal-exit/dist/mjs/index.js"() {
    init_signals2();
    processOk = (process10) => !!process10 && typeof process10 === "object" && typeof process10.removeListener === "function" && typeof process10.emit === "function" && typeof process10.reallyExit === "function" && typeof process10.listeners === "function" && typeof process10.kill === "function" && typeof process10.pid === "number" && typeof process10.on === "function";
    kExitEmitter = Symbol.for("signal-exit emitter");
    global2 = globalThis;
    ObjectDefineProperty = Object.defineProperty.bind(Object);
    Emitter = class {
      emitted = {
        afterExit: false,
        exit: false
      };
      listeners = {
        afterExit: [],
        exit: []
      };
      count = 0;
      id = Math.random();
      constructor() {
        if (global2[kExitEmitter]) {
          return global2[kExitEmitter];
        }
        ObjectDefineProperty(global2, kExitEmitter, {
          value: this,
          writable: false,
          enumerable: false,
          configurable: false
        });
      }
      on(ev, fn) {
        this.listeners[ev].push(fn);
      }
      removeListener(ev, fn) {
        const list = this.listeners[ev];
        const i2 = list.indexOf(fn);
        if (i2 === -1) {
          return;
        }
        if (i2 === 0 && list.length === 1) {
          list.length = 0;
        } else {
          list.splice(i2, 1);
        }
      }
      emit(ev, code, signal) {
        if (this.emitted[ev]) {
          return false;
        }
        this.emitted[ev] = true;
        let ret = false;
        for (const fn of this.listeners[ev]) {
          ret = fn(code, signal) === true || ret;
        }
        if (ev === "exit") {
          ret = this.emit("afterExit", code, signal) || ret;
        }
        return ret;
      }
    };
    SignalExitBase = class {
    };
    signalExitWrap = (handler) => {
      return {
        onExit(cb, opts) {
          return handler.onExit(cb, opts);
        },
        load() {
          return handler.load();
        },
        unload() {
          return handler.unload();
        }
      };
    };
    SignalExitFallback = class extends SignalExitBase {
      onExit() {
        return () => {
        };
      }
      load() {
      }
      unload() {
      }
    };
    SignalExit = class extends SignalExitBase {
      // "SIGHUP" throws an `ENOSYS` error on Windows,
      // so use a supported signal instead
      /* c8 ignore start */
      #hupSig = process9.platform === "win32" ? "SIGINT" : "SIGHUP";
      /* c8 ignore stop */
      #emitter = new Emitter();
      #process;
      #originalProcessEmit;
      #originalProcessReallyExit;
      #sigListeners = {};
      #loaded = false;
      constructor(process10) {
        super();
        this.#process = process10;
        this.#sigListeners = {};
        for (const sig of signals) {
          this.#sigListeners[sig] = () => {
            const listeners = this.#process.listeners(sig);
            let { count: count2 } = this.#emitter;
            const p = process10;
            if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") {
              count2 += p.__signal_exit_emitter__.count;
            }
            if (listeners.length === count2) {
              this.unload();
              const ret = this.#emitter.emit("exit", null, sig);
              const s = sig === "SIGHUP" ? this.#hupSig : sig;
              if (!ret)
                process10.kill(process10.pid, s);
            }
          };
        }
        this.#originalProcessReallyExit = process10.reallyExit;
        this.#originalProcessEmit = process10.emit;
      }
      onExit(cb, opts) {
        if (!processOk(this.#process)) {
          return () => {
          };
        }
        if (this.#loaded === false) {
          this.load();
        }
        const ev = opts?.alwaysLast ? "afterExit" : "exit";
        this.#emitter.on(ev, cb);
        return () => {
          this.#emitter.removeListener(ev, cb);
          if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) {
            this.unload();
          }
        };
      }
      load() {
        if (this.#loaded) {
          return;
        }
        this.#loaded = true;
        this.#emitter.count += 1;
        for (const sig of signals) {
          try {
            const fn = this.#sigListeners[sig];
            if (fn)
              this.#process.on(sig, fn);
          } catch (_) {
          }
        }
        this.#process.emit = (ev, ...a2) => {
          return this.#processEmit(ev, ...a2);
        };
        this.#process.reallyExit = (code) => {
          return this.#processReallyExit(code);
        };
      }
      unload() {
        if (!this.#loaded) {
          return;
        }
        this.#loaded = false;
        signals.forEach((sig) => {
          const listener = this.#sigListeners[sig];
          if (!listener) {
            throw new Error("Listener not defined for signal: " + sig);
          }
          try {
            this.#process.removeListener(sig, listener);
          } catch (_) {
          }
        });
        this.#process.emit = this.#originalProcessEmit;
        this.#process.reallyExit = this.#originalProcessReallyExit;
        this.#emitter.count -= 1;
      }
      #processReallyExit(code) {
        if (!processOk(this.#process)) {
          return 0;
        }
        this.#process.exitCode = code || 0;
        this.#emitter.emit("exit", this.#process.exitCode, null);
        return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
      }
      #processEmit(ev, ...args) {
        const og = this.#originalProcessEmit;
        if (ev === "exit" && processOk(this.#process)) {
          if (typeof args[0] === "number") {
            this.#process.exitCode = args[0];
          }
          const ret = og.call(this.#process, ev, ...args);
          this.#emitter.emit("exit", this.#process.exitCode, null);
          return ret;
        } else {
          return og.call(this.#process, ev, ...args);
        }
      }
    };
    process9 = globalThis.process;
    ({
      onExit: (
        /**
         * Called when the process is exiting, whether via signal, explicit
         * exit, or running out of stuff to do.
         *
         * If the global process object is not suitable for instrumentation,
         * then this will be a no-op.
         *
         * Returns a function that may be used to unload signal-exit.
         */
        onExit
      ),
      load: (
        /**
         * Load the listeners.  Likely you never need to call this, unless
         * doing a rather deep integration with signal-exit functionality.
         * Mostly exposed for the benefit of testing.
         *
         * @internal
         */
        load2
      ),
      unload: (
        /**
         * Unload the listeners.  Likely you never need to call this, unless
         * doing a rather deep integration with signal-exit functionality.
         * Mostly exposed for the benefit of testing.
         *
         * @internal
         */
        unload
      )
    } = signalExitWrap(processOk(process9) ? new SignalExit(process9) : new SignalExitFallback()));
  }
});

// node_modules/execa/lib/terminate/cleanup.js
var import_node_events11, cleanupOnExit;
var init_cleanup = __esm({
  "node_modules/execa/lib/terminate/cleanup.js"() {
    import_node_events11 = require("node:events");
    init_mjs();
    cleanupOnExit = (subprocess, { cleanup, detached }, { signal }) => {
      if (!cleanup || detached) {
        return;
      }
      const removeExitHandler = onExit(() => {
        subprocess.kill();
      });
      (0, import_node_events11.addAbortListener)(signal, () => {
        removeExitHandler();
      });
    };
  }
});

// node_modules/execa/lib/pipe/pipe-arguments.js
var normalizePipeArguments, getDestinationStream, getDestination, mapDestinationArguments, getSourceStream;
var init_pipe_arguments = __esm({
  "node_modules/execa/lib/pipe/pipe-arguments.js"() {
    init_parameters();
    init_duration();
    init_fd_options();
    init_file_url();
    normalizePipeArguments = ({ source, sourcePromise, boundOptions, createNested }, ...pipeArguments) => {
      const startTime = getStartTime();
      const {
        destination,
        destinationStream,
        destinationError,
        from,
        unpipeSignal
      } = getDestinationStream(boundOptions, createNested, pipeArguments);
      const { sourceStream, sourceError } = getSourceStream(source, from);
      const { options: sourceOptions, fileDescriptors } = SUBPROCESS_OPTIONS.get(source);
      return {
        sourcePromise,
        sourceStream,
        sourceOptions,
        sourceError,
        destination,
        destinationStream,
        destinationError,
        unpipeSignal,
        fileDescriptors,
        startTime
      };
    };
    getDestinationStream = (boundOptions, createNested, pipeArguments) => {
      try {
        const {
          destination,
          pipeOptions: { from, to, unpipeSignal } = {}
        } = getDestination(boundOptions, createNested, ...pipeArguments);
        const destinationStream = getToStream(destination, to);
        return {
          destination,
          destinationStream,
          from,
          unpipeSignal
        };
      } catch (error) {
        return { destinationError: error };
      }
    };
    getDestination = (boundOptions, createNested, firstArgument, ...pipeArguments) => {
      if (Array.isArray(firstArgument)) {
        const destination = createNested(mapDestinationArguments, boundOptions)(firstArgument, ...pipeArguments);
        return { destination, pipeOptions: boundOptions };
      }
      if (typeof firstArgument === "string" || firstArgument instanceof URL || isDenoExecPath(firstArgument)) {
        if (Object.keys(boundOptions).length > 0) {
          throw new TypeError('Please use .pipe("file", ..., options) or .pipe(execa("file", ..., options)) instead of .pipe(options)("file", ...).');
        }
        const [rawFile, rawArguments, rawOptions] = normalizeParameters(firstArgument, ...pipeArguments);
        const destination = createNested(mapDestinationArguments)(rawFile, rawArguments, rawOptions);
        return { destination, pipeOptions: rawOptions };
      }
      if (SUBPROCESS_OPTIONS.has(firstArgument)) {
        if (Object.keys(boundOptions).length > 0) {
          throw new TypeError("Please use .pipe(options)`command` or .pipe($(options)`command`) instead of .pipe(options)($`command`).");
        }
        return { destination: firstArgument, pipeOptions: pipeArguments[0] };
      }
      throw new TypeError(`The first argument must be a template string, an options object, or an Execa subprocess: ${firstArgument}`);
    };
    mapDestinationArguments = ({ options }) => ({ options: { ...options, stdin: "pipe", piped: true } });
    getSourceStream = (source, from) => {
      try {
        const sourceStream = getFromStream(source, from);
        return { sourceStream };
      } catch (error) {
        return { sourceError: error };
      }
    };
  }
});

// node_modules/execa/lib/pipe/throw.js
var handlePipeArgumentsError, getPipeArgumentsError, createNonCommandError, PIPE_COMMAND_MESSAGE;
var init_throw = __esm({
  "node_modules/execa/lib/pipe/throw.js"() {
    init_result();
    init_pipeline();
    handlePipeArgumentsError = ({
      sourceStream,
      sourceError,
      destinationStream,
      destinationError,
      fileDescriptors,
      sourceOptions,
      startTime
    }) => {
      const error = getPipeArgumentsError({
        sourceStream,
        sourceError,
        destinationStream,
        destinationError
      });
      if (error !== void 0) {
        throw createNonCommandError({
          error,
          fileDescriptors,
          sourceOptions,
          startTime
        });
      }
    };
    getPipeArgumentsError = ({ sourceStream, sourceError, destinationStream, destinationError }) => {
      if (sourceError !== void 0 && destinationError !== void 0) {
        return destinationError;
      }
      if (destinationError !== void 0) {
        abortSourceStream(sourceStream);
        return destinationError;
      }
      if (sourceError !== void 0) {
        endDestinationStream(destinationStream);
        return sourceError;
      }
    };
    createNonCommandError = ({ error, fileDescriptors, sourceOptions, startTime }) => makeEarlyError({
      error,
      command: PIPE_COMMAND_MESSAGE,
      escapedCommand: PIPE_COMMAND_MESSAGE,
      fileDescriptors,
      options: sourceOptions,
      startTime,
      isSync: false
    });
    PIPE_COMMAND_MESSAGE = "source.pipe(destination)";
  }
});

// node_modules/execa/lib/pipe/sequence.js
var waitForBothSubprocesses;
var init_sequence = __esm({
  "node_modules/execa/lib/pipe/sequence.js"() {
    waitForBothSubprocesses = async (subprocessPromises) => {
      const [
        { status: sourceStatus, reason: sourceReason, value: sourceResult = sourceReason },
        { status: destinationStatus, reason: destinationReason, value: destinationResult = destinationReason }
      ] = await subprocessPromises;
      if (!destinationResult.pipedFrom.includes(sourceResult)) {
        destinationResult.pipedFrom.push(sourceResult);
      }
      if (destinationStatus === "rejected") {
        throw destinationResult;
      }
      if (sourceStatus === "rejected") {
        throw sourceResult;
      }
      return destinationResult;
    };
  }
});

// node_modules/execa/lib/pipe/streaming.js
var import_promises8, pipeSubprocessStream, pipeFirstSubprocessStream, pipeMoreSubprocessStream, cleanupMergedStreamsMap, MERGED_STREAMS, SOURCE_LISTENERS_PER_PIPE, DESTINATION_LISTENERS_PER_PIPE;
var init_streaming = __esm({
  "node_modules/execa/lib/pipe/streaming.js"() {
    import_promises8 = require("node:stream/promises");
    init_merge_streams();
    init_max_listeners();
    init_pipeline();
    pipeSubprocessStream = (sourceStream, destinationStream, maxListenersController) => {
      const mergedStream = MERGED_STREAMS.has(destinationStream) ? pipeMoreSubprocessStream(sourceStream, destinationStream) : pipeFirstSubprocessStream(sourceStream, destinationStream);
      incrementMaxListeners(sourceStream, SOURCE_LISTENERS_PER_PIPE, maxListenersController.signal);
      incrementMaxListeners(destinationStream, DESTINATION_LISTENERS_PER_PIPE, maxListenersController.signal);
      cleanupMergedStreamsMap(destinationStream);
      return mergedStream;
    };
    pipeFirstSubprocessStream = (sourceStream, destinationStream) => {
      const mergedStream = mergeStreams([sourceStream]);
      pipeStreams(mergedStream, destinationStream);
      MERGED_STREAMS.set(destinationStream, mergedStream);
      return mergedStream;
    };
    pipeMoreSubprocessStream = (sourceStream, destinationStream) => {
      const mergedStream = MERGED_STREAMS.get(destinationStream);
      mergedStream.add(sourceStream);
      return mergedStream;
    };
    cleanupMergedStreamsMap = async (destinationStream) => {
      try {
        await (0, import_promises8.finished)(destinationStream, { cleanup: true, readable: false, writable: true });
      } catch {
      }
      MERGED_STREAMS.delete(destinationStream);
    };
    MERGED_STREAMS = /* @__PURE__ */ new WeakMap();
    SOURCE_LISTENERS_PER_PIPE = 2;
    DESTINATION_LISTENERS_PER_PIPE = 1;
  }
});

// node_modules/execa/lib/pipe/abort.js
var import_node_util8, unpipeOnAbort, unpipeOnSignalAbort;
var init_abort = __esm({
  "node_modules/execa/lib/pipe/abort.js"() {
    import_node_util8 = require("node:util");
    init_throw();
    unpipeOnAbort = (unpipeSignal, unpipeContext) => unpipeSignal === void 0 ? [] : [unpipeOnSignalAbort(unpipeSignal, unpipeContext)];
    unpipeOnSignalAbort = async (unpipeSignal, { sourceStream, mergedStream, fileDescriptors, sourceOptions, startTime }) => {
      await (0, import_node_util8.aborted)(unpipeSignal, sourceStream);
      await mergedStream.remove(sourceStream);
      const error = new Error("Pipe canceled by `unpipeSignal` option.");
      throw createNonCommandError({
        error,
        fileDescriptors,
        sourceOptions,
        startTime
      });
    };
  }
});

// node_modules/execa/lib/pipe/setup.js
var pipeToSubprocess, handlePipePromise, getSubprocessPromises;
var init_setup = __esm({
  "node_modules/execa/lib/pipe/setup.js"() {
    init_is_plain_obj();
    init_pipe_arguments();
    init_throw();
    init_sequence();
    init_streaming();
    init_abort();
    pipeToSubprocess = (sourceInfo, ...pipeArguments) => {
      if (isPlainObject(pipeArguments[0])) {
        return pipeToSubprocess.bind(void 0, {
          ...sourceInfo,
          boundOptions: { ...sourceInfo.boundOptions, ...pipeArguments[0] }
        });
      }
      const { destination, ...normalizedInfo } = normalizePipeArguments(sourceInfo, ...pipeArguments);
      const promise = handlePipePromise({ ...normalizedInfo, destination });
      promise.pipe = pipeToSubprocess.bind(void 0, {
        ...sourceInfo,
        source: destination,
        sourcePromise: promise,
        boundOptions: {}
      });
      return promise;
    };
    handlePipePromise = async ({
      sourcePromise,
      sourceStream,
      sourceOptions,
      sourceError,
      destination,
      destinationStream,
      destinationError,
      unpipeSignal,
      fileDescriptors,
      startTime
    }) => {
      const subprocessPromises = getSubprocessPromises(sourcePromise, destination);
      handlePipeArgumentsError({
        sourceStream,
        sourceError,
        destinationStream,
        destinationError,
        fileDescriptors,
        sourceOptions,
        startTime
      });
      const maxListenersController = new AbortController();
      try {
        const mergedStream = pipeSubprocessStream(sourceStream, destinationStream, maxListenersController);
        return await Promise.race([
          waitForBothSubprocesses(subprocessPromises),
          ...unpipeOnAbort(unpipeSignal, {
            sourceStream,
            mergedStream,
            sourceOptions,
            fileDescriptors,
            startTime
          })
        ]);
      } finally {
        maxListenersController.abort();
      }
    };
    getSubprocessPromises = (sourcePromise, destination) => Promise.allSettled([sourcePromise, destination]);
  }
});

// node_modules/execa/lib/io/iterate.js
var import_node_events12, import_node_stream5, iterateOnSubprocessStream, stopReadingOnExit, iterateForResult, stopReadingOnStreamEnd, iterateOnStream, DEFAULT_OBJECT_HIGH_WATER_MARK, HIGH_WATER_MARK, iterateOnData, getGenerators;
var init_iterate = __esm({
  "node_modules/execa/lib/io/iterate.js"() {
    import_node_events12 = require("node:events");
    import_node_stream5 = require("node:stream");
    init_encoding_transform();
    init_split();
    init_run_sync();
    iterateOnSubprocessStream = ({ subprocessStdout, subprocess, binary, shouldEncode, encoding, preserveNewlines }) => {
      const controller = new AbortController();
      stopReadingOnExit(subprocess, controller);
      return iterateOnStream({
        stream: subprocessStdout,
        controller,
        binary,
        shouldEncode: !subprocessStdout.readableObjectMode && shouldEncode,
        encoding,
        shouldSplit: !subprocessStdout.readableObjectMode,
        preserveNewlines
      });
    };
    stopReadingOnExit = async (subprocess, controller) => {
      try {
        await subprocess;
      } catch {
      } finally {
        controller.abort();
      }
    };
    iterateForResult = ({ stream, onStreamEnd, lines, encoding, stripFinalNewline: stripFinalNewline2, allMixed }) => {
      const controller = new AbortController();
      stopReadingOnStreamEnd(onStreamEnd, controller, stream);
      const objectMode = stream.readableObjectMode && !allMixed;
      return iterateOnStream({
        stream,
        controller,
        binary: encoding === "buffer",
        shouldEncode: !objectMode,
        encoding,
        shouldSplit: !objectMode && lines,
        preserveNewlines: !stripFinalNewline2
      });
    };
    stopReadingOnStreamEnd = async (onStreamEnd, controller, stream) => {
      try {
        await onStreamEnd;
      } catch {
        stream.destroy();
      } finally {
        controller.abort();
      }
    };
    iterateOnStream = ({ stream, controller, binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) => {
      const onStdoutChunk = (0, import_node_events12.on)(stream, "data", {
        signal: controller.signal,
        highWaterMark: HIGH_WATER_MARK,
        // Backward compatibility with older name for this option
        // See https://github.com/nodejs/node/pull/52080#discussion_r1525227861
        // @todo Remove after removing support for Node 21
        highWatermark: HIGH_WATER_MARK
      });
      return iterateOnData({
        onStdoutChunk,
        controller,
        binary,
        shouldEncode,
        encoding,
        shouldSplit,
        preserveNewlines
      });
    };
    DEFAULT_OBJECT_HIGH_WATER_MARK = (0, import_node_stream5.getDefaultHighWaterMark)(true);
    HIGH_WATER_MARK = DEFAULT_OBJECT_HIGH_WATER_MARK;
    iterateOnData = async function* ({ onStdoutChunk, controller, binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) {
      const generators = getGenerators({
        binary,
        shouldEncode,
        encoding,
        shouldSplit,
        preserveNewlines
      });
      try {
        for await (const [chunk] of onStdoutChunk) {
          yield* transformChunkSync(chunk, generators, 0);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      } finally {
        yield* finalChunksSync(generators);
      }
    };
    getGenerators = ({ binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) => [
      getEncodingTransformGenerator(binary, encoding, !shouldEncode),
      getSplitLinesGenerator(binary, preserveNewlines, !shouldSplit, {})
    ].filter(Boolean);
  }
});

// node_modules/execa/lib/io/contents.js
var import_promises9, getStreamOutput, logOutputAsync, resumeStream, getStreamContents2, getBufferedData, handleBufferedData;
var init_contents2 = __esm({
  "node_modules/execa/lib/io/contents.js"() {
    import_promises9 = require("node:timers/promises");
    init_source();
    init_uint_array();
    init_output();
    init_iterate();
    init_max_buffer();
    init_strip_newline();
    getStreamOutput = async ({ stream, onStreamEnd, fdNumber, encoding, buffer, maxBuffer, lines, allMixed, stripFinalNewline: stripFinalNewline2, verboseInfo, streamInfo }) => {
      const logPromise = logOutputAsync({
        stream,
        onStreamEnd,
        fdNumber,
        encoding,
        allMixed,
        verboseInfo,
        streamInfo
      });
      if (!buffer) {
        await Promise.all([resumeStream(stream), logPromise]);
        return;
      }
      const stripFinalNewlineValue = getStripFinalNewline(stripFinalNewline2, fdNumber);
      const iterable = iterateForResult({
        stream,
        onStreamEnd,
        lines,
        encoding,
        stripFinalNewline: stripFinalNewlineValue,
        allMixed
      });
      const [output] = await Promise.all([
        getStreamContents2({
          stream,
          iterable,
          fdNumber,
          encoding,
          maxBuffer,
          lines
        }),
        logPromise
      ]);
      return output;
    };
    logOutputAsync = async ({ stream, onStreamEnd, fdNumber, encoding, allMixed, verboseInfo, streamInfo: { fileDescriptors } }) => {
      if (!shouldLogOutput({
        stdioItems: fileDescriptors[fdNumber]?.stdioItems,
        encoding,
        verboseInfo,
        fdNumber
      })) {
        return;
      }
      const linesIterable = iterateForResult({
        stream,
        onStreamEnd,
        lines: true,
        encoding,
        stripFinalNewline: true,
        allMixed
      });
      await logLines(linesIterable, stream, fdNumber, verboseInfo);
    };
    resumeStream = async (stream) => {
      await (0, import_promises9.setImmediate)();
      if (stream.readableFlowing === null) {
        stream.resume();
      }
    };
    getStreamContents2 = async ({ stream, stream: { readableObjectMode }, iterable, fdNumber, encoding, maxBuffer, lines }) => {
      try {
        if (readableObjectMode || lines) {
          return await getStreamAsArray(iterable, { maxBuffer });
        }
        if (encoding === "buffer") {
          return new Uint8Array(await getStreamAsArrayBuffer(iterable, { maxBuffer }));
        }
        return await getStreamAsString(iterable, { maxBuffer });
      } catch (error) {
        return handleBufferedData(handleMaxBuffer({
          error,
          stream,
          readableObjectMode,
          lines,
          encoding,
          fdNumber
        }));
      }
    };
    getBufferedData = async (streamPromise) => {
      try {
        return await streamPromise;
      } catch (error) {
        return handleBufferedData(error);
      }
    };
    handleBufferedData = ({ bufferedData }) => isArrayBuffer(bufferedData) ? new Uint8Array(bufferedData) : bufferedData;
  }
});

// node_modules/execa/lib/resolve/wait-stream.js
var import_promises10, waitForStream, handleStdinDestroy, spyOnStdinDestroy, setStdinCleanedUp, handleStreamError, shouldIgnoreStreamError, isInputFileDescriptor, isStreamAbort, isStreamEpipe;
var init_wait_stream = __esm({
  "node_modules/execa/lib/resolve/wait-stream.js"() {
    import_promises10 = require("node:stream/promises");
    waitForStream = async (stream, fdNumber, streamInfo, { isSameDirection, stopOnExit = false } = {}) => {
      const state = handleStdinDestroy(stream, streamInfo);
      const abortController = new AbortController();
      try {
        await Promise.race([
          ...stopOnExit ? [streamInfo.exitPromise] : [],
          (0, import_promises10.finished)(stream, { cleanup: true, signal: abortController.signal })
        ]);
      } catch (error) {
        if (!state.stdinCleanedUp) {
          handleStreamError(error, fdNumber, streamInfo, isSameDirection);
        }
      } finally {
        abortController.abort();
      }
    };
    handleStdinDestroy = (stream, { originalStreams: [originalStdin], subprocess }) => {
      const state = { stdinCleanedUp: false };
      if (stream === originalStdin) {
        spyOnStdinDestroy(stream, subprocess, state);
      }
      return state;
    };
    spyOnStdinDestroy = (subprocessStdin, subprocess, state) => {
      const { _destroy } = subprocessStdin;
      subprocessStdin._destroy = (...destroyArguments) => {
        setStdinCleanedUp(subprocess, state);
        _destroy.call(subprocessStdin, ...destroyArguments);
      };
    };
    setStdinCleanedUp = ({ exitCode, signalCode }, state) => {
      if (exitCode !== null || signalCode !== null) {
        state.stdinCleanedUp = true;
      }
    };
    handleStreamError = (error, fdNumber, streamInfo, isSameDirection) => {
      if (!shouldIgnoreStreamError(error, fdNumber, streamInfo, isSameDirection)) {
        throw error;
      }
    };
    shouldIgnoreStreamError = (error, fdNumber, streamInfo, isSameDirection = true) => {
      if (streamInfo.propagating) {
        return isStreamEpipe(error) || isStreamAbort(error);
      }
      streamInfo.propagating = true;
      return isInputFileDescriptor(streamInfo, fdNumber) === isSameDirection ? isStreamEpipe(error) : isStreamAbort(error);
    };
    isInputFileDescriptor = ({ fileDescriptors }, fdNumber) => fdNumber !== "all" && fileDescriptors[fdNumber].direction === "input";
    isStreamAbort = (error) => error?.code === "ERR_STREAM_PREMATURE_CLOSE";
    isStreamEpipe = (error) => error?.code === "EPIPE";
  }
});

// node_modules/execa/lib/resolve/stdio.js
var waitForStdioStreams, waitForSubprocessStream;
var init_stdio = __esm({
  "node_modules/execa/lib/resolve/stdio.js"() {
    init_contents2();
    init_wait_stream();
    waitForStdioStreams = ({ subprocess, encoding, buffer, maxBuffer, lines, stripFinalNewline: stripFinalNewline2, verboseInfo, streamInfo }) => subprocess.stdio.map((stream, fdNumber) => waitForSubprocessStream({
      stream,
      fdNumber,
      encoding,
      buffer: buffer[fdNumber],
      maxBuffer: maxBuffer[fdNumber],
      lines: lines[fdNumber],
      allMixed: false,
      stripFinalNewline: stripFinalNewline2,
      verboseInfo,
      streamInfo
    }));
    waitForSubprocessStream = async ({ stream, fdNumber, encoding, buffer, maxBuffer, lines, allMixed, stripFinalNewline: stripFinalNewline2, verboseInfo, streamInfo }) => {
      if (!stream) {
        return;
      }
      const onStreamEnd = waitForStream(stream, fdNumber, streamInfo);
      if (isInputFileDescriptor(streamInfo, fdNumber)) {
        await onStreamEnd;
        return;
      }
      const [output] = await Promise.all([
        getStreamOutput({
          stream,
          onStreamEnd,
          fdNumber,
          encoding,
          buffer,
          maxBuffer,
          lines,
          allMixed,
          stripFinalNewline: stripFinalNewline2,
          verboseInfo,
          streamInfo
        }),
        onStreamEnd
      ]);
      return output;
    };
  }
});

// node_modules/execa/lib/resolve/all-async.js
var makeAllStream, waitForAllStream, getAllStream, getAllMixed;
var init_all_async = __esm({
  "node_modules/execa/lib/resolve/all-async.js"() {
    init_merge_streams();
    init_stdio();
    makeAllStream = ({ stdout, stderr }, { all }) => all && (stdout || stderr) ? mergeStreams([stdout, stderr].filter(Boolean)) : void 0;
    waitForAllStream = ({ subprocess, encoding, buffer, maxBuffer, lines, stripFinalNewline: stripFinalNewline2, verboseInfo, streamInfo }) => waitForSubprocessStream({
      ...getAllStream(subprocess, buffer),
      fdNumber: "all",
      encoding,
      maxBuffer: maxBuffer[1] + maxBuffer[2],
      lines: lines[1] || lines[2],
      allMixed: getAllMixed(subprocess),
      stripFinalNewline: stripFinalNewline2,
      verboseInfo,
      streamInfo
    });
    getAllStream = ({ stdout, stderr, all }, [, bufferStdout, bufferStderr]) => {
      const buffer = bufferStdout || bufferStderr;
      if (!buffer) {
        return { stream: all, buffer };
      }
      if (!bufferStdout) {
        return { stream: stderr, buffer };
      }
      if (!bufferStderr) {
        return { stream: stdout, buffer };
      }
      return { stream: all, buffer };
    };
    getAllMixed = ({ all, stdout, stderr }) => all && stdout && stderr && stdout.readableObjectMode !== stderr.readableObjectMode;
  }
});

// node_modules/execa/lib/verbose/ipc.js
var shouldLogIpc, logIpcOutput;
var init_ipc2 = __esm({
  "node_modules/execa/lib/verbose/ipc.js"() {
    init_log2();
    init_values();
    shouldLogIpc = (verboseInfo) => isFullVerbose(verboseInfo, "ipc");
    logIpcOutput = (message, verboseInfo) => {
      const verboseMessage = serializeVerboseMessage(message);
      verboseLog({
        type: "ipc",
        verboseMessage,
        fdNumber: "ipc",
        verboseInfo
      });
    };
  }
});

// node_modules/execa/lib/ipc/buffer-messages.js
var waitForIpcOutput, getBufferedIpcOutput;
var init_buffer_messages = __esm({
  "node_modules/execa/lib/ipc/buffer-messages.js"() {
    init_max_buffer();
    init_ipc2();
    init_specific();
    init_get_each();
    waitForIpcOutput = async ({
      subprocess,
      buffer: bufferArray,
      maxBuffer: maxBufferArray,
      ipc,
      ipcOutput,
      verboseInfo
    }) => {
      if (!ipc) {
        return ipcOutput;
      }
      const isVerbose2 = shouldLogIpc(verboseInfo);
      const buffer = getFdSpecificValue(bufferArray, "ipc");
      const maxBuffer = getFdSpecificValue(maxBufferArray, "ipc");
      for await (const message of loopOnMessages({
        anyProcess: subprocess,
        channel: subprocess.channel,
        isSubprocess: false,
        ipc,
        shouldAwait: false,
        reference: true
      })) {
        if (buffer) {
          checkIpcMaxBuffer(subprocess, ipcOutput, maxBuffer);
          ipcOutput.push(message);
        }
        if (isVerbose2) {
          logIpcOutput(message, verboseInfo);
        }
      }
      return ipcOutput;
    };
    getBufferedIpcOutput = async (ipcOutputPromise, ipcOutput) => {
      await Promise.allSettled([ipcOutputPromise]);
      return ipcOutput;
    };
  }
});

// node_modules/execa/lib/resolve/wait-subprocess.js
var import_node_events13, waitForSubprocessResult, waitForOriginalStreams, waitForCustomStreamsEnd, throwOnSubprocessError;
var init_wait_subprocess = __esm({
  "node_modules/execa/lib/resolve/wait-subprocess.js"() {
    import_node_events13 = require("node:events");
    init_is_stream();
    init_timeout();
    init_cancel();
    init_graceful2();
    init_standard_stream();
    init_type();
    init_contents2();
    init_buffer_messages();
    init_ipc_input();
    init_all_async();
    init_stdio();
    init_exit_async();
    init_wait_stream();
    waitForSubprocessResult = async ({
      subprocess,
      options: {
        encoding,
        buffer,
        maxBuffer,
        lines,
        timeoutDuration: timeout,
        cancelSignal,
        gracefulCancel,
        forceKillAfterDelay,
        stripFinalNewline: stripFinalNewline2,
        ipc,
        ipcInput
      },
      context,
      verboseInfo,
      fileDescriptors,
      originalStreams,
      onInternalError,
      controller
    }) => {
      const exitPromise = waitForExit(subprocess, context);
      const streamInfo = {
        originalStreams,
        fileDescriptors,
        subprocess,
        exitPromise,
        propagating: false
      };
      const stdioPromises = waitForStdioStreams({
        subprocess,
        encoding,
        buffer,
        maxBuffer,
        lines,
        stripFinalNewline: stripFinalNewline2,
        verboseInfo,
        streamInfo
      });
      const allPromise = waitForAllStream({
        subprocess,
        encoding,
        buffer,
        maxBuffer,
        lines,
        stripFinalNewline: stripFinalNewline2,
        verboseInfo,
        streamInfo
      });
      const ipcOutput = [];
      const ipcOutputPromise = waitForIpcOutput({
        subprocess,
        buffer,
        maxBuffer,
        ipc,
        ipcOutput,
        verboseInfo
      });
      const originalPromises = waitForOriginalStreams(originalStreams, subprocess, streamInfo);
      const customStreamsEndPromises = waitForCustomStreamsEnd(fileDescriptors, streamInfo);
      try {
        return await Promise.race([
          Promise.all([
            {},
            waitForSuccessfulExit(exitPromise),
            Promise.all(stdioPromises),
            allPromise,
            ipcOutputPromise,
            sendIpcInput(subprocess, ipcInput),
            ...originalPromises,
            ...customStreamsEndPromises
          ]),
          onInternalError,
          throwOnSubprocessError(subprocess, controller),
          ...throwOnTimeout(subprocess, timeout, context, controller),
          ...throwOnCancel({
            subprocess,
            cancelSignal,
            gracefulCancel,
            context,
            controller
          }),
          ...throwOnGracefulCancel({
            subprocess,
            cancelSignal,
            gracefulCancel,
            forceKillAfterDelay,
            context,
            controller
          })
        ]);
      } catch (error) {
        context.terminationReason ??= "other";
        return Promise.all([
          { error },
          exitPromise,
          Promise.all(stdioPromises.map((stdioPromise) => getBufferedData(stdioPromise))),
          getBufferedData(allPromise),
          getBufferedIpcOutput(ipcOutputPromise, ipcOutput),
          Promise.allSettled(originalPromises),
          Promise.allSettled(customStreamsEndPromises)
        ]);
      }
    };
    waitForOriginalStreams = (originalStreams, subprocess, streamInfo) => originalStreams.map((stream, fdNumber) => stream === subprocess.stdio[fdNumber] ? void 0 : waitForStream(stream, fdNumber, streamInfo));
    waitForCustomStreamsEnd = (fileDescriptors, streamInfo) => fileDescriptors.flatMap(({ stdioItems }, fdNumber) => stdioItems.filter(({ value, stream = value }) => isStream(stream, { checkOpen: false }) && !isStandardStream(stream)).map(({ type, value, stream = value }) => waitForStream(stream, fdNumber, streamInfo, {
      isSameDirection: TRANSFORM_TYPES.has(type),
      stopOnExit: type === "native"
    })));
    throwOnSubprocessError = async (subprocess, { signal }) => {
      const [error] = await (0, import_node_events13.once)(subprocess, "error", { signal });
      throw error;
    };
  }
});

// node_modules/execa/lib/convert/concurrent.js
var initializeConcurrentStreams, addConcurrentStream, waitForConcurrentStreams;
var init_concurrent = __esm({
  "node_modules/execa/lib/convert/concurrent.js"() {
    init_deferred();
    initializeConcurrentStreams = () => ({
      readableDestroy: /* @__PURE__ */ new WeakMap(),
      writableFinal: /* @__PURE__ */ new WeakMap(),
      writableDestroy: /* @__PURE__ */ new WeakMap()
    });
    addConcurrentStream = (concurrentStreams, stream, waitName) => {
      const weakMap = concurrentStreams[waitName];
      if (!weakMap.has(stream)) {
        weakMap.set(stream, []);
      }
      const promises = weakMap.get(stream);
      const promise = createDeferred();
      promises.push(promise);
      const resolve = promise.resolve.bind(promise);
      return { resolve, promises };
    };
    waitForConcurrentStreams = async ({ resolve, promises }, subprocess) => {
      resolve();
      const [isSubprocessExit] = await Promise.race([
        Promise.allSettled([true, subprocess]),
        Promise.all([false, ...promises])
      ]);
      return !isSubprocessExit;
    };
  }
});

// node_modules/execa/lib/convert/shared.js
var import_promises11, safeWaitForSubprocessStdin, safeWaitForSubprocessStdout, waitForSubprocessStdin, waitForSubprocessStdout, waitForSubprocess, destroyOtherStream;
var init_shared = __esm({
  "node_modules/execa/lib/convert/shared.js"() {
    import_promises11 = require("node:stream/promises");
    init_wait_stream();
    safeWaitForSubprocessStdin = async (subprocessStdin) => {
      if (subprocessStdin === void 0) {
        return;
      }
      try {
        await waitForSubprocessStdin(subprocessStdin);
      } catch {
      }
    };
    safeWaitForSubprocessStdout = async (subprocessStdout) => {
      if (subprocessStdout === void 0) {
        return;
      }
      try {
        await waitForSubprocessStdout(subprocessStdout);
      } catch {
      }
    };
    waitForSubprocessStdin = async (subprocessStdin) => {
      await (0, import_promises11.finished)(subprocessStdin, { cleanup: true, readable: false, writable: true });
    };
    waitForSubprocessStdout = async (subprocessStdout) => {
      await (0, import_promises11.finished)(subprocessStdout, { cleanup: true, readable: true, writable: false });
    };
    waitForSubprocess = async (subprocess, error) => {
      await subprocess;
      if (error) {
        throw error;
      }
    };
    destroyOtherStream = (stream, isOpen, error) => {
      if (error && !isStreamAbort(error)) {
        stream.destroy(error);
      } else if (isOpen) {
        stream.destroy();
      }
    };
  }
});

// node_modules/execa/lib/convert/readable.js
var import_node_stream6, import_node_util9, createReadable, getSubprocessStdout, getReadableOptions, getReadableMethods, onRead, onStdoutFinished, onReadableDestroy, destroyOtherReadable;
var init_readable = __esm({
  "node_modules/execa/lib/convert/readable.js"() {
    import_node_stream6 = require("node:stream");
    import_node_util9 = require("node:util");
    init_encoding_option();
    init_fd_options();
    init_iterate();
    init_deferred();
    init_concurrent();
    init_shared();
    createReadable = ({ subprocess, concurrentStreams, encoding }, { from, binary: binaryOption = true, preserveNewlines = true } = {}) => {
      const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
      const { subprocessStdout, waitReadableDestroy } = getSubprocessStdout(subprocess, from, concurrentStreams);
      const { readableEncoding, readableObjectMode, readableHighWaterMark } = getReadableOptions(subprocessStdout, binary);
      const { read, onStdoutDataDone } = getReadableMethods({
        subprocessStdout,
        subprocess,
        binary,
        encoding,
        preserveNewlines
      });
      const readable2 = new import_node_stream6.Readable({
        read,
        destroy: (0, import_node_util9.callbackify)(onReadableDestroy.bind(void 0, { subprocessStdout, subprocess, waitReadableDestroy })),
        highWaterMark: readableHighWaterMark,
        objectMode: readableObjectMode,
        encoding: readableEncoding
      });
      onStdoutFinished({
        subprocessStdout,
        onStdoutDataDone,
        readable: readable2,
        subprocess
      });
      return readable2;
    };
    getSubprocessStdout = (subprocess, from, concurrentStreams) => {
      const subprocessStdout = getFromStream(subprocess, from);
      const waitReadableDestroy = addConcurrentStream(concurrentStreams, subprocessStdout, "readableDestroy");
      return { subprocessStdout, waitReadableDestroy };
    };
    getReadableOptions = ({ readableEncoding, readableObjectMode, readableHighWaterMark }, binary) => binary ? { readableEncoding, readableObjectMode, readableHighWaterMark } : { readableEncoding, readableObjectMode: true, readableHighWaterMark: DEFAULT_OBJECT_HIGH_WATER_MARK };
    getReadableMethods = ({ subprocessStdout, subprocess, binary, encoding, preserveNewlines }) => {
      const onStdoutDataDone = createDeferred();
      const onStdoutData = iterateOnSubprocessStream({
        subprocessStdout,
        subprocess,
        binary,
        shouldEncode: !binary,
        encoding,
        preserveNewlines
      });
      return {
        read() {
          onRead(this, onStdoutData, onStdoutDataDone);
        },
        onStdoutDataDone
      };
    };
    onRead = async (readable2, onStdoutData, onStdoutDataDone) => {
      try {
        const { value, done } = await onStdoutData.next();
        if (done) {
          onStdoutDataDone.resolve();
        } else {
          readable2.push(value);
        }
      } catch {
      }
    };
    onStdoutFinished = async ({ subprocessStdout, onStdoutDataDone, readable: readable2, subprocess, subprocessStdin }) => {
      try {
        await waitForSubprocessStdout(subprocessStdout);
        await subprocess;
        await safeWaitForSubprocessStdin(subprocessStdin);
        await onStdoutDataDone;
        if (readable2.readable) {
          readable2.push(null);
        }
      } catch (error) {
        await safeWaitForSubprocessStdin(subprocessStdin);
        destroyOtherReadable(readable2, error);
      }
    };
    onReadableDestroy = async ({ subprocessStdout, subprocess, waitReadableDestroy }, error) => {
      if (await waitForConcurrentStreams(waitReadableDestroy, subprocess)) {
        destroyOtherReadable(subprocessStdout, error);
        await waitForSubprocess(subprocess, error);
      }
    };
    destroyOtherReadable = (stream, error) => {
      destroyOtherStream(stream, stream.readable, error);
    };
  }
});

// node_modules/execa/lib/convert/writable.js
var import_node_stream7, import_node_util10, createWritable, getSubprocessStdin, getWritableMethods, onWrite, onWritableFinal, onStdinFinished, onWritableDestroy, destroyOtherWritable;
var init_writable = __esm({
  "node_modules/execa/lib/convert/writable.js"() {
    import_node_stream7 = require("node:stream");
    import_node_util10 = require("node:util");
    init_fd_options();
    init_concurrent();
    init_shared();
    createWritable = ({ subprocess, concurrentStreams }, { to } = {}) => {
      const { subprocessStdin, waitWritableFinal, waitWritableDestroy } = getSubprocessStdin(subprocess, to, concurrentStreams);
      const writable2 = new import_node_stream7.Writable({
        ...getWritableMethods(subprocessStdin, subprocess, waitWritableFinal),
        destroy: (0, import_node_util10.callbackify)(onWritableDestroy.bind(void 0, {
          subprocessStdin,
          subprocess,
          waitWritableFinal,
          waitWritableDestroy
        })),
        highWaterMark: subprocessStdin.writableHighWaterMark,
        objectMode: subprocessStdin.writableObjectMode
      });
      onStdinFinished(subprocessStdin, writable2);
      return writable2;
    };
    getSubprocessStdin = (subprocess, to, concurrentStreams) => {
      const subprocessStdin = getToStream(subprocess, to);
      const waitWritableFinal = addConcurrentStream(concurrentStreams, subprocessStdin, "writableFinal");
      const waitWritableDestroy = addConcurrentStream(concurrentStreams, subprocessStdin, "writableDestroy");
      return { subprocessStdin, waitWritableFinal, waitWritableDestroy };
    };
    getWritableMethods = (subprocessStdin, subprocess, waitWritableFinal) => ({
      write: onWrite.bind(void 0, subprocessStdin),
      final: (0, import_node_util10.callbackify)(onWritableFinal.bind(void 0, subprocessStdin, subprocess, waitWritableFinal))
    });
    onWrite = (subprocessStdin, chunk, encoding, done) => {
      if (subprocessStdin.write(chunk, encoding)) {
        done();
      } else {
        subprocessStdin.once("drain", done);
      }
    };
    onWritableFinal = async (subprocessStdin, subprocess, waitWritableFinal) => {
      if (await waitForConcurrentStreams(waitWritableFinal, subprocess)) {
        if (subprocessStdin.writable) {
          subprocessStdin.end();
        }
        await subprocess;
      }
    };
    onStdinFinished = async (subprocessStdin, writable2, subprocessStdout) => {
      try {
        await waitForSubprocessStdin(subprocessStdin);
        if (writable2.writable) {
          writable2.end();
        }
      } catch (error) {
        await safeWaitForSubprocessStdout(subprocessStdout);
        destroyOtherWritable(writable2, error);
      }
    };
    onWritableDestroy = async ({ subprocessStdin, subprocess, waitWritableFinal, waitWritableDestroy }, error) => {
      await waitForConcurrentStreams(waitWritableFinal, subprocess);
      if (await waitForConcurrentStreams(waitWritableDestroy, subprocess)) {
        destroyOtherWritable(subprocessStdin, error);
        await waitForSubprocess(subprocess, error);
      }
    };
    destroyOtherWritable = (stream, error) => {
      destroyOtherStream(stream, stream.writable, error);
    };
  }
});

// node_modules/execa/lib/convert/duplex.js
var import_node_stream8, import_node_util11, createDuplex, onDuplexDestroy;
var init_duplex = __esm({
  "node_modules/execa/lib/convert/duplex.js"() {
    import_node_stream8 = require("node:stream");
    import_node_util11 = require("node:util");
    init_encoding_option();
    init_readable();
    init_writable();
    createDuplex = ({ subprocess, concurrentStreams, encoding }, { from, to, binary: binaryOption = true, preserveNewlines = true } = {}) => {
      const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
      const { subprocessStdout, waitReadableDestroy } = getSubprocessStdout(subprocess, from, concurrentStreams);
      const { subprocessStdin, waitWritableFinal, waitWritableDestroy } = getSubprocessStdin(subprocess, to, concurrentStreams);
      const { readableEncoding, readableObjectMode, readableHighWaterMark } = getReadableOptions(subprocessStdout, binary);
      const { read, onStdoutDataDone } = getReadableMethods({
        subprocessStdout,
        subprocess,
        binary,
        encoding,
        preserveNewlines
      });
      const duplex2 = new import_node_stream8.Duplex({
        read,
        ...getWritableMethods(subprocessStdin, subprocess, waitWritableFinal),
        destroy: (0, import_node_util11.callbackify)(onDuplexDestroy.bind(void 0, {
          subprocessStdout,
          subprocessStdin,
          subprocess,
          waitReadableDestroy,
          waitWritableFinal,
          waitWritableDestroy
        })),
        readableHighWaterMark,
        writableHighWaterMark: subprocessStdin.writableHighWaterMark,
        readableObjectMode,
        writableObjectMode: subprocessStdin.writableObjectMode,
        encoding: readableEncoding
      });
      onStdoutFinished({
        subprocessStdout,
        onStdoutDataDone,
        readable: duplex2,
        subprocess,
        subprocessStdin
      });
      onStdinFinished(subprocessStdin, duplex2, subprocessStdout);
      return duplex2;
    };
    onDuplexDestroy = async ({ subprocessStdout, subprocessStdin, subprocess, waitReadableDestroy, waitWritableFinal, waitWritableDestroy }, error) => {
      await Promise.all([
        onReadableDestroy({ subprocessStdout, subprocess, waitReadableDestroy }, error),
        onWritableDestroy({
          subprocessStdin,
          subprocess,
          waitWritableFinal,
          waitWritableDestroy
        }, error)
      ]);
    };
  }
});

// node_modules/execa/lib/convert/iterable.js
var createIterable, iterateOnStdoutData;
var init_iterable = __esm({
  "node_modules/execa/lib/convert/iterable.js"() {
    init_encoding_option();
    init_fd_options();
    init_iterate();
    createIterable = (subprocess, encoding, {
      from,
      binary: binaryOption = false,
      preserveNewlines = false
    } = {}) => {
      const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
      const subprocessStdout = getFromStream(subprocess, from);
      const onStdoutData = iterateOnSubprocessStream({
        subprocessStdout,
        subprocess,
        binary,
        shouldEncode: true,
        encoding,
        preserveNewlines
      });
      return iterateOnStdoutData(onStdoutData, subprocessStdout, subprocess);
    };
    iterateOnStdoutData = async function* (onStdoutData, subprocessStdout, subprocess) {
      try {
        yield* onStdoutData;
      } finally {
        if (subprocessStdout.readable) {
          subprocessStdout.destroy();
        }
        await subprocess;
      }
    };
  }
});

// node_modules/execa/lib/convert/add.js
var addConvertedStreams;
var init_add = __esm({
  "node_modules/execa/lib/convert/add.js"() {
    init_concurrent();
    init_readable();
    init_writable();
    init_duplex();
    init_iterable();
    addConvertedStreams = (subprocess, { encoding }) => {
      const concurrentStreams = initializeConcurrentStreams();
      subprocess.readable = createReadable.bind(void 0, { subprocess, concurrentStreams, encoding });
      subprocess.writable = createWritable.bind(void 0, { subprocess, concurrentStreams });
      subprocess.duplex = createDuplex.bind(void 0, { subprocess, concurrentStreams, encoding });
      subprocess.iterable = createIterable.bind(void 0, subprocess, encoding);
      subprocess[Symbol.asyncIterator] = createIterable.bind(void 0, subprocess, encoding, {});
    };
  }
});

// node_modules/execa/lib/methods/promise.js
var mergePromise, nativePromisePrototype, descriptors;
var init_promise = __esm({
  "node_modules/execa/lib/methods/promise.js"() {
    mergePromise = (subprocess, promise) => {
      for (const [property, descriptor] of descriptors) {
        const value = descriptor.value.bind(promise);
        Reflect.defineProperty(subprocess, property, { ...descriptor, value });
      }
    };
    nativePromisePrototype = (async () => {
    })().constructor.prototype;
    descriptors = ["then", "catch", "finally"].map((property) => [
      property,
      Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)
    ]);
  }
});

// node_modules/execa/lib/methods/main-async.js
var import_node_events14, import_node_child_process7, execaCoreAsync, handleAsyncArguments, handleAsyncOptions, spawnSubprocessAsync, handlePromise, getAsyncResult;
var init_main_async = __esm({
  "node_modules/execa/lib/methods/main-async.js"() {
    import_node_events14 = require("node:events");
    import_node_child_process7 = require("node:child_process");
    init_source();
    init_command();
    init_options();
    init_fd_options();
    init_shell();
    init_methods();
    init_result();
    init_reject();
    init_early_error();
    init_handle_async();
    init_strip_newline();
    init_output_async();
    init_kill();
    init_cleanup();
    init_setup();
    init_all_async();
    init_wait_subprocess();
    init_add();
    init_deferred();
    init_promise();
    execaCoreAsync = (rawFile, rawArguments, rawOptions, createNested) => {
      const { file, commandArguments, command, escapedCommand, startTime, verboseInfo, options, fileDescriptors } = handleAsyncArguments(rawFile, rawArguments, rawOptions);
      const { subprocess, promise } = spawnSubprocessAsync({
        file,
        commandArguments,
        options,
        startTime,
        verboseInfo,
        command,
        escapedCommand,
        fileDescriptors
      });
      subprocess.pipe = pipeToSubprocess.bind(void 0, {
        source: subprocess,
        sourcePromise: promise,
        boundOptions: {},
        createNested
      });
      mergePromise(subprocess, promise);
      SUBPROCESS_OPTIONS.set(subprocess, { options, fileDescriptors });
      return subprocess;
    };
    handleAsyncArguments = (rawFile, rawArguments, rawOptions) => {
      const { command, escapedCommand, startTime, verboseInfo } = handleCommand(rawFile, rawArguments, rawOptions);
      const { file, commandArguments, options: normalizedOptions } = normalizeOptions(rawFile, rawArguments, rawOptions);
      const options = handleAsyncOptions(normalizedOptions);
      const fileDescriptors = handleStdioAsync(options, verboseInfo);
      return {
        file,
        commandArguments,
        command,
        escapedCommand,
        startTime,
        verboseInfo,
        options,
        fileDescriptors
      };
    };
    handleAsyncOptions = ({ timeout, signal, ...options }) => {
      if (signal !== void 0) {
        throw new TypeError('The "signal" option has been renamed to "cancelSignal" instead.');
      }
      return { ...options, timeoutDuration: timeout };
    };
    spawnSubprocessAsync = ({ file, commandArguments, options, startTime, verboseInfo, command, escapedCommand, fileDescriptors }) => {
      let subprocess;
      try {
        subprocess = (0, import_node_child_process7.spawn)(...concatenateShell(file, commandArguments, options));
      } catch (error) {
        return handleEarlyError({
          error,
          command,
          escapedCommand,
          fileDescriptors,
          options,
          startTime,
          verboseInfo
        });
      }
      const controller = new AbortController();
      (0, import_node_events14.setMaxListeners)(Number.POSITIVE_INFINITY, controller.signal);
      const originalStreams = [...subprocess.stdio];
      pipeOutputAsync(subprocess, fileDescriptors, controller);
      cleanupOnExit(subprocess, options, controller);
      const context = {};
      const onInternalError = createDeferred();
      subprocess.kill = subprocessKill.bind(void 0, {
        kill: subprocess.kill.bind(subprocess),
        options,
        onInternalError,
        context,
        controller
      });
      subprocess.all = makeAllStream(subprocess, options);
      addConvertedStreams(subprocess, options);
      addIpcMethods(subprocess, options);
      const promise = handlePromise({
        subprocess,
        options,
        startTime,
        verboseInfo,
        fileDescriptors,
        originalStreams,
        command,
        escapedCommand,
        context,
        onInternalError,
        controller
      });
      return { subprocess, promise };
    };
    handlePromise = async ({ subprocess, options, startTime, verboseInfo, fileDescriptors, originalStreams, command, escapedCommand, context, onInternalError, controller }) => {
      const [
        errorInfo,
        [exitCode, signal],
        stdioResults,
        allResult,
        ipcOutput
      ] = await waitForSubprocessResult({
        subprocess,
        options,
        context,
        verboseInfo,
        fileDescriptors,
        originalStreams,
        onInternalError,
        controller
      });
      controller.abort();
      onInternalError.resolve();
      const stdio = stdioResults.map((stdioResult, fdNumber) => stripNewline(stdioResult, options, fdNumber));
      const all = stripNewline(allResult, options, "all");
      const result = getAsyncResult({
        errorInfo,
        exitCode,
        signal,
        stdio,
        all,
        ipcOutput,
        context,
        options,
        command,
        escapedCommand,
        startTime
      });
      return handleResult(result, verboseInfo, options);
    };
    getAsyncResult = ({ errorInfo, exitCode, signal, stdio, all, ipcOutput, context, options, command, escapedCommand, startTime }) => "error" in errorInfo ? makeError({
      error: errorInfo.error,
      command,
      escapedCommand,
      timedOut: context.terminationReason === "timeout",
      isCanceled: context.terminationReason === "cancel" || context.terminationReason === "gracefulCancel",
      isGracefullyCanceled: context.terminationReason === "gracefulCancel",
      isMaxBuffer: errorInfo.error instanceof MaxBufferError,
      isForcefullyTerminated: context.isForcefullyTerminated,
      exitCode,
      signal,
      stdio,
      all,
      ipcOutput,
      options,
      startTime,
      isSync: false
    }) : makeSuccessResult({
      command,
      escapedCommand,
      stdio,
      all,
      ipcOutput,
      options,
      startTime
    });
  }
});

// node_modules/execa/lib/methods/bind.js
var mergeOptions, mergeOption, DEEP_OPTIONS;
var init_bind = __esm({
  "node_modules/execa/lib/methods/bind.js"() {
    init_is_plain_obj();
    init_specific();
    mergeOptions = (boundOptions, options) => {
      const newOptions = Object.fromEntries(
        Object.entries(options).map(([optionName, optionValue]) => [
          optionName,
          mergeOption(optionName, boundOptions[optionName], optionValue)
        ])
      );
      return { ...boundOptions, ...newOptions };
    };
    mergeOption = (optionName, boundOptionValue, optionValue) => {
      if (DEEP_OPTIONS.has(optionName) && isPlainObject(boundOptionValue) && isPlainObject(optionValue)) {
        return { ...boundOptionValue, ...optionValue };
      }
      return optionValue;
    };
    DEEP_OPTIONS = /* @__PURE__ */ new Set(["env", ...FD_SPECIFIC_OPTIONS]);
  }
});

// node_modules/execa/lib/methods/create.js
var createExeca, callBoundExeca, parseArguments;
var init_create = __esm({
  "node_modules/execa/lib/methods/create.js"() {
    init_is_plain_obj();
    init_parameters();
    init_template();
    init_main_sync();
    init_main_async();
    init_bind();
    createExeca = (mapArguments, boundOptions, deepOptions, setBoundExeca) => {
      const createNested = (mapArguments2, boundOptions2, setBoundExeca2) => createExeca(mapArguments2, boundOptions2, deepOptions, setBoundExeca2);
      const boundExeca = (...execaArguments) => callBoundExeca({
        mapArguments,
        deepOptions,
        boundOptions,
        setBoundExeca,
        createNested
      }, ...execaArguments);
      if (setBoundExeca !== void 0) {
        setBoundExeca(boundExeca, createNested, boundOptions);
      }
      return boundExeca;
    };
    callBoundExeca = ({ mapArguments, deepOptions = {}, boundOptions = {}, setBoundExeca, createNested }, firstArgument, ...nextArguments) => {
      if (isPlainObject(firstArgument)) {
        return createNested(mapArguments, mergeOptions(boundOptions, firstArgument), setBoundExeca);
      }
      const { file, commandArguments, options, isSync } = parseArguments({
        mapArguments,
        firstArgument,
        nextArguments,
        deepOptions,
        boundOptions
      });
      return isSync ? execaCoreSync(file, commandArguments, options) : execaCoreAsync(file, commandArguments, options, createNested);
    };
    parseArguments = ({ mapArguments, firstArgument, nextArguments, deepOptions, boundOptions }) => {
      const callArguments = isTemplateString(firstArgument) ? parseTemplates(firstArgument, nextArguments) : [firstArgument, ...nextArguments];
      const [initialFile, initialArguments, initialOptions] = normalizeParameters(...callArguments);
      const mergedOptions = mergeOptions(mergeOptions(deepOptions, boundOptions), initialOptions);
      const {
        file = initialFile,
        commandArguments = initialArguments,
        options = mergedOptions,
        isSync = false
      } = mapArguments({ file: initialFile, commandArguments: initialArguments, options: mergedOptions });
      return {
        file,
        commandArguments,
        options,
        isSync
      };
    };
  }
});

// node_modules/execa/lib/methods/command.js
var mapCommandAsync, mapCommandSync, parseCommand, parseCommandString, SPACES_REGEXP;
var init_command2 = __esm({
  "node_modules/execa/lib/methods/command.js"() {
    mapCommandAsync = ({ file, commandArguments }) => parseCommand(file, commandArguments);
    mapCommandSync = ({ file, commandArguments }) => ({ ...parseCommand(file, commandArguments), isSync: true });
    parseCommand = (command, unusedArguments) => {
      if (unusedArguments.length > 0) {
        throw new TypeError(`The command and its arguments must be passed as a single string: ${command} ${unusedArguments}.`);
      }
      const [file, ...commandArguments] = parseCommandString(command);
      return { file, commandArguments };
    };
    parseCommandString = (command) => {
      if (typeof command !== "string") {
        throw new TypeError(`The command must be a string: ${String(command)}.`);
      }
      const trimmedCommand = command.trim();
      if (trimmedCommand === "") {
        return [];
      }
      const tokens = [];
      for (const token of trimmedCommand.split(SPACES_REGEXP)) {
        const previousToken = tokens.at(-1);
        if (previousToken && previousToken.endsWith("\\")) {
          tokens[tokens.length - 1] = `${previousToken.slice(0, -1)} ${token}`;
        } else {
          tokens.push(token);
        }
      }
      return tokens;
    };
    SPACES_REGEXP = / +/g;
  }
});

// node_modules/execa/lib/methods/script.js
var setScriptSync, mapScriptAsync, mapScriptSync, getScriptOptions, getScriptStdinOption, deepScriptOptions;
var init_script = __esm({
  "node_modules/execa/lib/methods/script.js"() {
    setScriptSync = (boundExeca, createNested, boundOptions) => {
      boundExeca.sync = createNested(mapScriptSync, boundOptions);
      boundExeca.s = boundExeca.sync;
    };
    mapScriptAsync = ({ options }) => getScriptOptions(options);
    mapScriptSync = ({ options }) => ({ ...getScriptOptions(options), isSync: true });
    getScriptOptions = (options) => ({ options: { ...getScriptStdinOption(options), ...options } });
    getScriptStdinOption = ({ input, inputFile, stdio }) => input === void 0 && inputFile === void 0 && stdio === void 0 ? { stdin: "inherit" } : {};
    deepScriptOptions = { preferLocal: true };
  }
});

// node_modules/execa/index.js
var execa, execaSync, execaCommand, execaCommandSync, execaNode, $, sendMessage2, getOneMessage2, getEachMessage2, getCancelSignal2;
var init_execa = __esm({
  "node_modules/execa/index.js"() {
    init_create();
    init_command2();
    init_node2();
    init_script();
    init_methods();
    execa = createExeca(() => ({}));
    execaSync = createExeca(() => ({ isSync: true }));
    execaCommand = createExeca(mapCommandAsync);
    execaCommandSync = createExeca(mapCommandSync);
    execaNode = createExeca(mapNode);
    $ = createExeca(mapScriptAsync, {}, deepScriptOptions, setScriptSync);
    ({
      sendMessage: sendMessage2,
      getOneMessage: getOneMessage2,
      getEachMessage: getEachMessage2,
      getCancelSignal: getCancelSignal2
    } = getIpcExport());
  }
});

// src/core/tmux.ts
function splitRightArgs(launch, target, cwd) {
  const a2 = ["split-window", "-P", "-F", "#{pane_id}", "-h"];
  if (target) a2.push("-t", target);
  if (cwd) a2.push("-c", cwd);
  a2.push(launch);
  return a2;
}
function splitDownArgs(launch, target, cwd) {
  const a2 = ["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", target];
  if (cwd) a2.push("-c", cwd);
  a2.push(launch);
  return a2;
}
function respawnArgs(pane, launch, cwd) {
  const a2 = ["respawn-pane", "-k", "-t", pane];
  if (cwd) a2.push("-c", cwd);
  a2.push(launch);
  return a2;
}
function setOptionArgs(pane, opt, val) {
  return ["set-option", "-p", "-t", pane, opt, val];
}
function sendKeysLiteralArgs(pane, line) {
  return ["send-keys", "-t", pane, "-l", line];
}
function sendKeysEnterArgs(pane) {
  return ["send-keys", "-t", pane, "Enter"];
}
function wrapLaunch(launch, hasBashrc = (0, import_node_fs13.existsSync)((0, import_node_path11.join)((0, import_node_os5.homedir)(), ".bashrc"))) {
  return hasBashrc ? `bash -ic 'exec ${launch}'` : launch;
}
function sentinelCommand(labelFmt2) {
  return `printf '%s\\n  preflight pane reserved \u2014 awaiting spawn...\\n' ${JSON.stringify(labelFmt2)}; sleep infinity`;
}
async function tmux(args) {
  const { stdout } = await execa("tmux", args);
  return stdout.trim();
}
async function paneAlive(pane) {
  const { stdout } = await execa("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  return stdout.split("\n").includes(pane);
}
async function paneSend(pane, line) {
  await execa("tmux", sendKeysLiteralArgs(pane, line));
  await new Promise((r) => setTimeout(r, 300));
  await execa("tmux", sendKeysEnterArgs(pane));
}
async function capturePane(pane, lines) {
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-t", pane]);
    return lines ? stdout.split("\n").slice(-lines).join("\n") : stdout;
  } catch {
    return "";
  }
}
async function killNow(pane) {
  try {
    await execa("tmux", ["kill-pane", "-t", pane]);
  } catch {
  }
}
async function selectLayoutMainVertical(target) {
  await execa("tmux", ["select-layout", "-t", target, "main-vertical"]);
}
async function conductorPane() {
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return tmux(["display-message", "-p", "#{pane_id}"]);
}
function paneLabelSetArgs(pane, instrument, model, topic) {
  return [
    setOptionArgs(pane, "@cs_label", labelFor(instrument, model, topic)),
    setOptionArgs(pane, "@cs_color", colorFor(instrument)),
    setOptionArgs(pane, "@cs_label_fmt", labelFmt(instrument, model, topic))
  ];
}
async function paneLabelSet(pane, instrument, model, topic) {
  for (const args of paneLabelSetArgs(pane, instrument, model, topic)) await execa("tmux", args);
}
function gracefulRespawnCommand(snap, pluginRoot6, label, color) {
  return `cat '${snap}'; node '${pluginRoot6}/dist/consort.cjs' _banner '${label}' '${color}'; rm -f '${snap}'`;
}
async function paneLabel(pane) {
  try {
    return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_label}"])).stdout;
  } catch {
    return "";
  }
}
async function paneColor(pane) {
  try {
    return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_color}"])).stdout;
  } catch {
    return "";
  }
}
async function killGraceful(pane, pluginRoot6) {
  if (!await paneAlive(pane)) return;
  const label = await paneLabel(pane) || "part";
  const color = await paneColor(pane);
  const snap = (0, import_node_path11.join)((0, import_node_fs13.mkdtempSync)((0, import_node_path11.join)((0, import_node_os5.tmpdir)(), "cs-snap-")), "snap.txt");
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-e", "-t", pane]);
    (0, import_node_fs13.writeFileSync)(snap, stdout);
  } catch {
    (0, import_node_fs13.writeFileSync)(snap, "");
  }
  await respawn(pane, gracefulRespawnCommand(snap, pluginRoot6, label, color));
}
async function preflightLayout(topic, roster, opts) {
  const conductor = await conductorPane();
  const created = [];
  const out = [];
  let prev = conductor;
  let flag = "-h";
  try {
    for (const e of roster) {
      const sentinel = sentinelCommand(labelFmt(e.instrument, e.model, topic));
      const args = ["split-window", "-P", "-F", "#{pane_id}", flag, "-t", prev];
      if (e.cwd) args.push("-c", e.cwd);
      args.push(sentinel);
      const { stdout } = await execa("tmux", args);
      const pane = stdout.trim();
      created.push(pane);
      await paneLabelSet(pane, e.instrument, e.model, topic);
      out.push({ instrument: e.instrument, pane });
      prev = pane;
      flag = "-v";
    }
    await selectLayoutMainVertical(conductor);
    opts.writePanes(out.map((o2) => `${o2.instrument}	${o2.pane}`).join("\n") + "\n");
    return out;
  } catch (e) {
    for (const p of created) {
      try {
        await execa("tmux", ["kill-pane", "-t", p]);
      } catch {
      }
    }
    throw e;
  }
}
var import_node_os5, import_node_fs13, import_node_path11, splitRight, splitDown, respawn;
var init_tmux = __esm({
  "src/core/tmux.ts"() {
    "use strict";
    init_execa();
    import_node_os5 = require("node:os");
    import_node_fs13 = require("node:fs");
    import_node_path11 = require("node:path");
    init_colors();
    splitRight = (launch, target, cwd) => tmux(splitRightArgs(launch, target, cwd));
    splitDown = (launch, target, cwd) => tmux(splitDownArgs(launch, target, cwd));
    respawn = (pane, launch, cwd) => tmux(respawnArgs(pane, launch, cwd));
  }
});

// src/core/forensics.ts
function renderFailureReport(f) {
  const meta = `timestamp:     ${f.timestamp}
instrument:    ${f.instrument}
model:         ${f.model}
topic:         ${f.topic}
pane_id:       ${f.paneId}
fail_reason:   ${f.reason}
ready_timeout: ${f.readyTimeout}
`;
  const evt = f.reason === "error_event" && f.eventLine ? f.eventLine : NO_EVENT_SENTINEL;
  return `# Spawn bootstrap failure
${meta}
## Pane scrollback (last 50 lines, captured BEFORE pane kill)
${f.scrollback}

## Event context
${evt}
`;
}
async function captureFailure(input, deps) {
  if (!input.instrument || !input.model || !input.topic) return { ok: false, code: 1 };
  if (input.reason !== "timeout" && input.reason !== "error_event") return { ok: false, code: 2 };
  const dir = deps.partDir(input.instrument, input.model, input.topic);
  if (!deps.isWritableDir(dir)) return { ok: false, code: 1 };
  const scrollback = await deps.capturePane(input.paneId, SCROLLBACK_LINES).catch(() => "");
  const dest = `${dir}/${FAILURE_FILENAME}`;
  const doc = renderFailureReport({
    timestamp: (deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z")))(),
    instrument: input.instrument,
    model: input.model,
    topic: input.topic,
    paneId: input.paneId,
    reason: input.reason,
    readyTimeout: input.readyTimeout == null ? "unknown" : String(input.readyTimeout),
    scrollback,
    eventLine: input.eventLine
  });
  deps.atomicWriteSync(dest, doc);
  return { ok: true, path: dest };
}
var SCROLLBACK_LINES, NO_EVENT_SENTINEL, FAILURE_FILENAME;
var init_forensics = __esm({
  "src/core/forensics.ts"() {
    "use strict";
    SCROLLBACK_LINES = 50;
    NO_EVENT_SENTINEL = "no error event before timeout";
    FAILURE_FILENAME = "failure-reason.txt";
  }
});

// src/commands/spawn.ts
var spawn_exports = {};
__export(spawn_exports, {
  resolveMode: () => resolveMode,
  run: () => run,
  validateSlug: () => validateSlug
});
function validateSlug(s) {
  return SLUG.test(s) && s.length >= 1 && s.length <= 32;
}
function resolveMode(explicit, dflt) {
  return explicit || dflt || "full";
}
async function run(args) {
  if (args.length < 3) {
    log.error("usage: spawn <instrument|random> <model> <topic> [--mode m] [--cwd abs] [--target-pane id] [initial-prompt]");
    return 2;
  }
  let instrument = args[0];
  const [, model, topic] = args;
  let i2 = 3, mode = "", cwd = "", targetPane = "", initial = "";
  for (; i2 < args.length; i2++) {
    const a2 = args[i2];
    if (a2 === "--mode" || a2.startsWith("--mode=")) {
      const r = kvParse(a2, args[i2 + 1]);
      mode = r.value;
      i2 += r.shift - 1;
    } else if (a2 === "--cwd" || a2.startsWith("--cwd=")) {
      const r = kvParse(a2, args[i2 + 1]);
      cwd = r.value;
      i2 += r.shift - 1;
    } else if (a2 === "--target-pane" || a2.startsWith("--target-pane=")) {
      const r = kvParse(a2, args[i2 + 1]);
      targetPane = r.value;
      i2 += r.shift - 1;
    } else {
      initial = args.slice(i2).join(" ");
      break;
    }
  }
  if (!validateSlug(topic)) {
    log.error(`topic must match [a-z0-9-]+ and be <= 32 chars; got: '${topic}'`);
    return 2;
  }
  if (instrument !== "random" && !validateSlug(instrument)) {
    log.error(`instrument must match [a-z0-9-]+ and be <= 32 chars (or 'random'); got: '${instrument}'`);
    return 2;
  }
  if (cwd && (!cwd.startsWith("/") || !(0, import_node_fs14.existsSync)(cwd))) {
    log.error(`spawn --cwd must be an existing absolute path: ${cwd}`);
    return 1;
  }
  if (!inTmuxSession()) {
    log.error("must run inside a tmux session");
    return 1;
  }
  if (!haveCmd("tmux")) {
    log.error("tmux not on PATH");
    return 1;
  }
  if (!tmuxVersionOk()) {
    log.error("tmux >= 3.0 required");
    return 1;
  }
  if (instrument === "random") {
    const pick = pickRandomInstrument(topic);
    if (!pick) {
      log.error(`no available instrument in pool for topic '${topic}'`);
      return 1;
    }
    instrument = pick;
    log.info(`random pick: ${instrument}`);
  }
  if (instrumentInUse(instrument, topic)) {
    for (const l of formatCollisionError(instrument, model, topic).split("\n")) log.error(l);
    return 1;
  }
  const binary = instrumentBinary(model);
  if (!binary) {
    log.error(`model '${model}' has no entry in contracts.yaml`);
    return 1;
  }
  if (!haveCmd(binary)) {
    log.error(`${model}'s binary '${binary}' is not on PATH`);
    return 1;
  }
  const useMode = resolveMode(mode, instrumentDefaultMode(model));
  const modeArgs = instrumentModeArgs(model, useMode);
  if (!modeArgs) {
    log.error(`mode '${useMode}' not defined for ${model} in contracts.yaml`);
    return 1;
  }
  const readyTimeout = instrumentReadyTimeout(model);
  log.info(`preparing state for ${instrument}-${model} on ${topic}`);
  stateInit(instrument, model, topic);
  identityWrite(instrument, model, topic);
  const launch = wrapLaunch([binary, ...modeArgs].join(" "));
  const startDir = cwd || repoRoot();
  let pane;
  if (targetPane) {
    if (!await paneAlive(targetPane)) {
      log.error(`--target-pane ${targetPane} is not alive`);
      return 1;
    }
    pane = await respawn(targetPane, launch, startDir);
    await paneLabelSet(pane, instrument, model, topic);
  } else {
    const lastFile = (0, import_node_path12.join)(topicDir(topic), ".last_pane");
    const prior = (0, import_node_fs14.existsSync)(lastFile) ? (0, import_node_fs14.readFileSync)(lastFile, "utf8").trim() : "";
    if (prior && await paneAlive(prior)) pane = await splitDown(launch, prior, startDir);
    else pane = await splitRight(launch, void 0, startDir);
    await paneLabelSet(pane, instrument, model, topic);
    (0, import_node_fs14.mkdirSync)(topicDir(topic), { recursive: true });
    (0, import_node_fs14.writeFileSync)(lastFile, pane + "\n");
  }
  paneMetaWrite(instrument, model, topic, pane);
  log.ok(`spawned ${labelFor(instrument, model, topic)} in pane ${pane} (mode=${useMode})`);
  const boot = instrumentBootstrapSleep(model);
  log.info(`sleeping ${boot}s for ${model} bootstrap`);
  await sleep2(boot * 1e3);
  log.info(`asking ${instrument} to read identity`);
  await paneSend(pane, `Read ${identityPath(instrument, model, topic)} and follow its instructions exactly.`);
  log.info(`waiting for {ready,error} in outbox (timeout ${readyTimeout}s)`);
  const ev = await outboxWait(instrument, model, topic, ["ready", "error"], readyTimeout);
  if (!ev || ev.event === "error") {
    const reason = ev ? "error_event" : "timeout";
    const tail = await capturePane(pane, 25);
    process.stderr.write(tail + "\n");
    await captureFailure(
      { instrument, model, topic, paneId: pane, reason, eventLine: ev ? JSON.stringify(ev) : void 0, readyTimeout },
      { partDir, capturePane: (p, n2) => capturePane(p, n2), atomicWriteSync: (d, c3) => (0, import_node_fs14.writeFileSync)(d, c3), isWritableDir: (d) => (0, import_node_fs14.existsSync)(d), now: () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z") }
    );
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
  process.stdout.write(`
  part:    ${labelFor(instrument, model, topic)}
  pane:    ${pane}
  state:   ${partDir(instrument, model, topic)}
  ready:   yes
`);
  return 0;
}
var import_node_fs14, import_node_path12, SLUG, sleep2;
var init_spawn = __esm({
  "src/commands/spawn.ts"() {
    "use strict";
    import_node_fs14 = require("node:fs");
    import_node_path12 = require("node:path");
    init_args();
    init_log();
    init_deps();
    init_paths();
    init_archive();
    init_ipc();
    init_instruments();
    init_contracts();
    init_tmux();
    init_colors();
    init_forensics();
    SLUG = /^[a-z0-9-]+$/;
    sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  }
});

// src/commands/send.ts
var send_exports = {};
__export(send_exports, {
  run: () => run2
});
async function run2(args) {
  let from;
  let a2 = [...args];
  if (a2[0] === "--from") {
    if (!a2[1]) {
      log.error("--from requires a sender name");
      return 2;
    }
    from = a2[1];
    a2 = a2.slice(2);
  }
  if (a2.length < 3) {
    log.error("usage: send [--from s] <instrument> <topic> <message|@file>");
    return 2;
  }
  const [instrument, topic] = a2;
  let msg = a2.slice(2).join(" ");
  const td = topicDir(topic);
  const dir = (0, import_node_fs15.existsSync)(td) ? (0, import_node_fs15.readdirSync)(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`)) : void 0;
  if (!dir) {
    log.error(`no part '${instrument}' on topic '${topic}' (state dir absent)`);
    log.error(`  spawn first: consort spawn ${instrument} <model> ${topic}`);
    return 1;
  }
  const model = paneMetaModel(instrument, dir.name.slice(instrument.length + 1), topic);
  const pane = paneMetaRead(instrument, model, topic);
  if (!pane) {
    log.error(`pane.json missing for ${instrument}-${model} on ${topic}`);
    return 1;
  }
  if (!await paneAlive(pane)) {
    log.error(`${instrument}'s pane ${pane} is gone (orphan); run consort coda ${instrument} ${topic}`);
    return 1;
  }
  if (msg.startsWith("@")) {
    const f = msg.slice(1);
    if (!(0, import_node_fs15.existsSync)(f)) {
      log.error(`file not found: ${f}`);
      return 1;
    }
    msg = (0, import_node_fs15.readFileSync)(f, "utf8");
  }
  inboxWrite(instrument, model, topic, msg, from ? { from } : void 0);
  const inbox = inboxPath(instrument, model, topic);
  log.info(`wrote inbox at ${inbox}; nudging pane ${pane}`);
  await paneSend(pane, `Read ${inbox} and execute the task. Reply when done.`);
  process.stdout.write(`
  part:    ${instrument}-${model} on ${topic}
  pane:    ${pane}
  inbox:   ${inbox}
  status:  queued \u2014 use: consort collect ${instrument} ${topic}  (to wait for {done})
`);
  return 0;
}
var import_node_fs15;
var init_send2 = __esm({
  "src/commands/send.ts"() {
    "use strict";
    import_node_fs15 = require("node:fs");
    init_log();
    init_paths();
    init_ipc();
    init_tmux();
  }
});

// src/commands/collect.ts
var collect_exports = {};
__export(collect_exports, {
  run: () => run3
});
function resolveModel(instrument, topic) {
  const td = topicDir(topic);
  if (!(0, import_node_fs16.existsSync)(td)) return null;
  const dir = (0, import_node_fs16.readdirSync)(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`));
  if (!dir) return null;
  const hint = dir.name.slice(instrument.length + 1);
  return paneMetaModel(instrument, hint, topic);
}
async function run3(args) {
  if (args.length < 2) {
    log.error("usage: collect <instrument> <topic> [--timeout n]");
    return 2;
  }
  const [instrument, topic] = args;
  let timeout = 600;
  for (let i2 = 2; i2 < args.length; i2++) {
    const a2 = args[i2];
    if (a2 === "--timeout" || a2.startsWith("--timeout=")) {
      const r = kvParse(a2, args[i2 + 1]);
      timeout = Number(r.value);
      i2 += r.shift - 1;
    } else {
      log.error(`unknown arg: ${a2}`);
      return 2;
    }
  }
  const model = resolveModel(instrument, topic);
  if (!model) {
    log.error(`no part '${instrument}' on topic '${topic}'`);
    return 1;
  }
  log.info(`tailing outbox for ${instrument}-${model} (timeout ${timeout}s)`);
  const ev = await outboxWait(instrument, model, topic, ["done", "error"], timeout);
  if (ev?.event === "done") {
    log.ok("{done} received");
    process.stdout.write(JSON.stringify(ev) + "\n");
    return 0;
  }
  if (ev?.event === "error") {
    log.error(`{error} received from ${instrument}`);
    process.stdout.write(JSON.stringify(ev) + "\n");
    return 1;
  }
  log.error(`timeout after ${timeout}s; outbox tail:`);
  process.stderr.write(outboxDump(instrument, model, topic).split("\n").slice(-5).join("\n") + "\n");
  return 1;
}
var import_node_fs16;
var init_collect = __esm({
  "src/commands/collect.ts"() {
    "use strict";
    import_node_fs16 = require("node:fs");
    init_args();
    init_log();
    init_paths();
    init_ipc();
  }
});

// src/commands/roster.ts
var roster_exports = {};
__export(roster_exports, {
  classifyStale: () => classifyStale,
  deriveState: () => deriveState,
  lastOutboxEvent: () => lastOutboxEvent,
  run: () => run4
});
function deriveState(lastEvent) {
  switch (lastEvent) {
    case void 0:
    case "":
      return "spawning";
    case "done":
      return "idle (done)";
    case "error":
      return "idle (error)";
    case "ack":
      return "working";
    case "ready":
      return "ready";
    default:
      return lastEvent;
  }
}
function lastOutboxEvent(outbox) {
  if (!(0, import_node_fs17.existsSync)(outbox)) return void 0;
  const lines = (0, import_node_fs17.readFileSync)(outbox, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return void 0;
  try {
    return JSON.parse(lines[lines.length - 1]).event;
  } catch {
    return void 0;
  }
}
function classifyStale(state, outbox, thresholdS = 180) {
  if (state !== "working" || !(0, import_node_fs17.existsSync)(outbox)) return state;
  const t = Number.isInteger(thresholdS) && thresholdS >= 0 ? thresholdS : 180;
  const ageS = (Date.now() - (0, import_node_fs17.statSync)(outbox).mtimeMs) / 1e3;
  return ageS > 0 && ageS > t ? "stale" : state;
}
async function run4(args) {
  const filter = args.find((a2) => !a2.startsWith("--"));
  const repo = repoStateDir();
  if (!(0, import_node_fs17.existsSync)(repo)) {
    process.stdout.write(`no parts deployed (state dir absent: ${repo})
`);
    return 0;
  }
  const W = (s, n2) => s.padEnd(n2);
  process.stdout.write(`${W("PART", 32)} ${W("MODEL", 8)} ${W("TOPIC", 12)} ${W("PANE", 9)} STATE
`);
  process.stdout.write(`${"-".repeat(32)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(9)} -----
`);
  for (const t of (0, import_node_fs17.readdirSync)(repo, { withFileTypes: true })) {
    if (!t.isDirectory()) continue;
    if (filter && t.name !== filter) continue;
    const td = (0, import_node_path13.join)(repo, t.name);
    for (const p of (0, import_node_fs17.readdirSync)(td, { withFileTypes: true })) {
      if (!p.isDirectory() || isArtifactDir(p.name)) continue;
      const dir = (0, import_node_path13.join)(td, p.name);
      const meta = paneMetaReadForDir(dir);
      const pane = meta.paneId || "?";
      let state = "[ORPHAN]";
      if (pane !== "?" && await paneAlive(pane)) state = classifyStale(deriveState(lastOutboxEvent(outboxPath(meta.instrument, meta.model, t.name))), outboxPath(meta.instrument, meta.model, t.name));
      process.stdout.write(`${W(meta.instrument, 32)} ${W(meta.model, 8)} ${W(t.name, 12)} ${W(pane, 9)} ${state}
`);
    }
  }
  return 0;
}
var import_node_fs17, import_node_path13;
var init_roster = __esm({
  "src/commands/roster.ts"() {
    "use strict";
    import_node_fs17 = require("node:fs");
    import_node_path13 = require("node:path");
    init_paths();
    init_ipc();
    init_tmux();
  }
});

// src/commands/coda.ts
var coda_exports = {};
__export(coda_exports, {
  GRACEFUL_BATCH_WAIT_MS: () => GRACEFUL_BATCH_WAIT_MS,
  run: () => run5,
  teardownBatch: () => teardownBatch
});
async function teardownBatch(topic, pairs, d) {
  const pending = [];
  for (const { instrument, model } of pairs) {
    const pane = d.paneMetaRead(instrument, model, topic) ?? "";
    if (pane && await d.paneAlive(pane)) {
      log.info(`graceful shutdown for ${instrument}-${model} on ${topic} (pane ${pane})`);
      await d.killGraceful(pane);
      pending.push(pane);
    }
  }
  if (pending.length > 0) {
    log.info("waiting 9s for graceful banners to finish");
    await d.sleep(GRACEFUL_BATCH_WAIT_MS);
    for (const p of pending) await d.killNow(p);
  }
  for (const { instrument, model } of pairs) {
    const dest = d.stateArchive(instrument, model, topic);
    if (dest) log.ok(`archived ${instrument}-${model}: ${dest}`);
  }
  const last = d.readLastPane(topic);
  if (last && pending.includes(last)) d.removeLastPane(topic);
}
function liveDeps() {
  return {
    paneMetaRead: (i2, m, t) => paneMetaRead(i2, m, t),
    paneAlive: (p) => paneAlive(p),
    killGraceful: (p) => killGraceful(p, pluginRoot4()),
    killNow: (p) => killNow(p),
    stateArchive: (i2, m, t) => stateArchive(i2, m, t),
    sleep: sleep3,
    topicDir,
    readLastPane: (t) => {
      const f = (0, import_node_path14.join)(topicDir(t), ".last_pane");
      return (0, import_node_fs18.existsSync)(f) ? (0, import_node_fs18.readFileSync)(f, "utf8").trim() : "";
    },
    removeLastPane: (t) => {
      try {
        (0, import_node_fs18.rmSync)((0, import_node_path14.join)(topicDir(t), ".last_pane"), { force: true });
      } catch {
      }
    }
  };
}
function collectTopicPairs(topic) {
  const td = topicDir(topic);
  if (!(0, import_node_fs18.existsSync)(td)) return [];
  const pairs = [];
  for (const name of (0, import_node_fs18.readdirSync)(td, { withFileTypes: true })) {
    if (!name.isDirectory() || isArtifactDir(name.name)) continue;
    const m = paneMetaReadForDir((0, import_node_path14.join)(td, name.name));
    pairs.push({ instrument: m.instrument, model: m.model });
  }
  return pairs;
}
function collectInstrumentPairs(topic, instruments) {
  const td = topicDir(topic);
  if (!(0, import_node_fs18.existsSync)(td)) return [];
  const dirs = (0, import_node_fs18.readdirSync)(td, { withFileTypes: true }).filter((e) => e.isDirectory());
  const pairs = [];
  for (const instrument of instruments) {
    for (const e of dirs) {
      if (e.name === `${instrument}-${e.name.slice(instrument.length + 1)}` && e.name.startsWith(`${instrument}-`)) {
        const m = paneMetaReadForDir((0, import_node_path14.join)(td, e.name));
        if (m.instrument === instrument) pairs.push({ instrument, model: m.model });
      }
    }
  }
  return pairs;
}
function cleanupTopicDir(topic) {
  const td = topicDir(topic);
  try {
    (0, import_node_fs18.rmSync)((0, import_node_path14.join)(td, ".last_pane"), { force: true });
  } catch {
  }
  try {
    (0, import_node_fs18.rmdirSync)(td);
  } catch {
  }
}
async function run5(args) {
  const d = liveDeps();
  const a0 = args[0] ?? "";
  if (a0 === "" || a0 === "-h" || a0 === "--help") {
    process.stderr.write("Usage: coda <topic>\n       coda <instrument> <topic>\n       coda --all\n       coda --pairs <topic> <i1> [i2...]\n");
    return 2;
  }
  if (a0 === "--all") {
    if (!args.includes("--yes")) {
      log.warn("coda --all tears down EVERY part across every topic in this repo; re-run to confirm: coda --all --yes");
      return 2;
    }
    const repo = repoStateDir();
    if (!(0, import_node_fs18.existsSync)(repo)) {
      log.info("no state dirs to tear down");
      return 0;
    }
    for (const t of (0, import_node_fs18.readdirSync)(repo, { withFileTypes: true })) {
      if (t.isDirectory()) {
        await teardownBatch(t.name, collectTopicPairs(t.name), d);
        cleanupTopicDir(t.name);
      }
    }
    return 0;
  }
  if (a0 === "--pairs") {
    const topic = args[1];
    const instruments = args.slice(2);
    if (!topic || instruments.length === 0) {
      log.error("--pairs requires <topic> <i1> [i2...]");
      return 2;
    }
    const pairs = collectInstrumentPairs(topic, instruments);
    if (pairs.length === 0) log.warn(`no matching part dirs found for any of: ${instruments.join(" ")}`);
    else await teardownBatch(topic, pairs, d);
    cleanupTopicDir(topic);
    return 0;
  }
  if (args.length === 1) {
    await teardownBatch(a0, collectTopicPairs(a0), d);
    cleanupTopicDir(a0);
    return 0;
  }
  if (args.length === 2) {
    const [instrument, topic] = args;
    const pairs = collectInstrumentPairs(topic, [instrument]);
    if (pairs.length === 0) {
      log.error(`no part '${instrument}' on topic '${topic}'`);
      return 1;
    }
    await teardownBatch(topic, pairs, d);
    cleanupTopicDir(topic);
    return 0;
  }
  process.stderr.write("Usage: coda <topic> | <instrument> <topic> | --all | --pairs <topic> <i...>\n");
  return 2;
}
var import_node_fs18, import_node_path14, GRACEFUL_BATCH_WAIT_MS, sleep3, pluginRoot4;
var init_coda = __esm({
  "src/commands/coda.ts"() {
    "use strict";
    import_node_fs18 = require("node:fs");
    import_node_path14 = require("node:path");
    init_log();
    init_paths();
    init_archive();
    init_ipc();
    init_tmux();
    GRACEFUL_BATCH_WAIT_MS = 9e3;
    sleep3 = (ms) => new Promise((r) => setTimeout(r, ms));
    pluginRoot4 = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
  }
});

// src/commands/soundcheck.ts
var soundcheck_exports = {};
__export(soundcheck_exports, {
  opencodeConfigPath: () => opencodeConfigPath,
  opencodePermissionCheck: () => opencodePermissionCheck,
  run: () => run6
});
function opencodeConfigPath(cwd = process.cwd(), home = (0, import_node_os6.homedir)()) {
  const proj = (0, import_node_path15.join)(cwd, "opencode.json");
  if ((0, import_node_fs19.existsSync)(proj)) return proj;
  const glob = (0, import_node_path15.join)(home, ".config", "opencode", "opencode.json");
  return (0, import_node_fs19.existsSync)(glob) ? glob : null;
}
function opencodePermissionCheck(cfgPath) {
  const p = cfgPath ?? opencodeConfigPath();
  if (!p || !(0, import_node_fs19.existsSync)(p)) return { rc: 1, message: "no opencode.json found" };
  let obj;
  try {
    obj = JSON.parse((0, import_node_fs19.readFileSync)(p, "utf8"));
  } catch {
    return { rc: 1, message: "opencode.json: unparseable", configPath: p };
  }
  const perm = obj?.permission;
  if (perm === "allow") return { rc: 0, configPath: p };
  if (typeof perm === "string") return { rc: 1, message: `opencode.json: permission is '${perm}' (need 'allow' for part auto-approve)`, configPath: p };
  if (perm && typeof perm === "object") return { rc: 2, message: "opencode.json: object-form permission detected; soundcheck does not introspect per-tool keys", configPath: p };
  return { rc: 1, message: "opencode.json: no top-level 'permission' key (defaults to 'ask')", configPath: p };
}
async function run6(_args) {
  let fail = 0, warn = 0, ok = 0, total = 0;
  const root = globalRoot();
  try {
    (0, import_node_fs19.mkdirSync)(root, { recursive: true });
  } catch {
  }
  const ver = tmuxVersionString();
  if (!ver) {
    log.error("tmux: not on PATH (install: https://github.com/tmux/tmux)");
    fail = 1;
  } else if (!tmuxVersionOk(ver)) {
    log.error(`tmux: ${ver} \u2014 consort requires >= 3.0`);
    fail = 1;
  } else log.ok(`tmux: ${ver}`);
  if (inTmuxSession()) log.ok(`tmux session: ${process.env.TMUX} is set`);
  else {
    log.warn("tmux session: not set \u2014 `tmux new -s consort` before spawning");
    warn = 1;
  }
  if ((0, import_node_fs19.existsSync)(root)) log.ok(`state dir: ${root} (writable)`);
  else {
    log.error(`state dir: ${root} cannot be created or is not writable`);
    fail = 1;
  }
  for (const f of ["contracts.yaml", "instruments.yaml"]) {
    const dest = (0, import_node_path15.join)(globalRoot(), f);
    if ((0, import_node_fs19.existsSync)(dest)) log.ok(`config: ${f}`);
    else {
      const shipped = (0, import_node_path15.join)(pluginRoot5(), "config", f);
      if ((0, import_node_fs19.existsSync)(shipped)) {
        try {
          (0, import_node_fs19.copyFileSync)(shipped, dest);
          log.ok(`config: ${f} (copied default into state dir)`);
        } catch {
          log.error(`config: ${f} missing; copy from plugin defaults failed`);
          fail = 1;
        }
      } else {
        log.error(`config: ${f} not in state dir and not shipped at ${shipped}`);
        fail = 1;
      }
    }
  }
  const detected = [];
  if (!contractsExist()) {
    log.error(`contracts.yaml not found at ${(0, import_node_path15.join)(globalRoot(), "contracts.yaml")}`);
    fail = 1;
  } else {
    for (const prov of listInstruments()) {
      total++;
      const bin = instrumentBinary(prov);
      if (!bin) {
        log.warn(`  ${prov}: binary field missing in contracts.yaml`);
        continue;
      }
      if (haveCmd(bin)) {
        log.ok(`  ${prov} (${bin}): installed`);
        ok++;
        detected.push(prov);
      } else log.warn(`  ${prov} (${bin}): not on PATH \u2014 skip if you don't use this provider`);
    }
    if (detected.includes("opencode")) {
      const r = opencodePermissionCheck();
      if (r.rc === 0) log.ok("  opencode auto-approve: 'permission: allow' detected");
      else log.warn(`  opencode auto-approve: ${r.message}${r.rc === 2 ? " (non-fatal)" : ""}`);
    }
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  atomicWrite(
    (0, import_node_path15.join)(globalRoot(), "providers-available.txt"),
    `# generated ${stamp} by /consort:soundcheck
# providers detected with binary on PATH + contracts.yaml row
${detected.join("\n")}${detected.length ? "\n" : ""}`
  );
  if (fail !== 0 || ok === 0) {
    if (ok === 0 && total > 0) log.error(`no providers available; install at least one of: ${listInstruments().join(" ")}`);
    process.stdout.write("Verdict: FAIL \u2014 fix items above before spawning\n");
    return 1;
  }
  process.stdout.write(`Verdict: OK \u2014 ready to spawn (${ok}/${total} providers available; ${warn} warnings)
`);
  return 0;
}
var import_node_fs19, import_node_path15, import_node_os6, pluginRoot5;
var init_soundcheck = __esm({
  "src/commands/soundcheck.ts"() {
    "use strict";
    import_node_fs19 = require("node:fs");
    import_node_path15 = require("node:path");
    import_node_os6 = require("node:os");
    init_log();
    init_deps();
    init_paths();
    init_atomic();
    init_contracts();
    pluginRoot5 = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
  }
});

// src/commands/preflight.ts
var preflight_exports = {};
__export(preflight_exports, {
  run: () => run7
});
async function run7(args) {
  if (args.length < 2) {
    log.error("usage: preflight <topic> <N> [--roster i1:m1,i2:m2,...] [--art-dir abs]");
    return 2;
  }
  const topic = args[0];
  const n2 = Number(args[1]);
  let rosterArg = "", artDir = "";
  for (let i2 = 2; i2 < args.length; i2++) {
    const a2 = args[i2];
    if (a2 === "--roster" || a2.startsWith("--roster=")) {
      const r = kvParse(a2, args[i2 + 1]);
      rosterArg = r.value;
      i2 += r.shift - 1;
    } else if (a2 === "--art-dir" || a2.startsWith("--art-dir=")) {
      const r = kvParse(a2, args[i2 + 1]);
      artDir = r.value;
      i2 += r.shift - 1;
    }
  }
  if (!SLUG2.test(topic) || topic.length > 64) {
    log.error(`topic must match [a-z0-9-]+ and be <= 64 chars; got: '${topic}'`);
    return 2;
  }
  if (!Number.isInteger(n2) || n2 < 2 || n2 > 4) {
    log.error(`N must be 2..4; got: '${args[1]}'`);
    return 2;
  }
  const roster = rosterArg.split(",").filter(Boolean).map((pair) => {
    const [instrument, model] = pair.split(":");
    return { instrument, model };
  });
  if (roster.length !== n2) {
    log.error(`roster has ${roster.length} entries, expected ${n2}`);
    return 1;
  }
  const art = artDir || (0, import_node_path16.join)(topicDir(topic), "_consult");
  (0, import_node_fs20.mkdirSync)(art, { recursive: true });
  const panesFile = (0, import_node_path16.join)(art, "preflight-panes.txt");
  try {
    const out = await preflightLayout(topic, roster, { writePanes: (tsv) => atomicWrite(panesFile, tsv) });
    log.ok(`preflight: ${out.length} panes allocated for topic ${topic}`);
    for (const o2 of out) process.stdout.write(`  ${o2.instrument}	${o2.pane}
`);
    return 0;
  } catch (e) {
    log.error(`preflight failed: ${e?.message ?? e}`);
    return 1;
  }
}
var import_node_fs20, import_node_path16, SLUG2;
var init_preflight = __esm({
  "src/commands/preflight.ts"() {
    "use strict";
    import_node_fs20 = require("node:fs");
    import_node_path16 = require("node:path");
    init_args();
    init_log();
    init_paths();
    init_atomic();
    init_tmux();
    SLUG2 = /^[a-z0-9-]+$/;
  }
});

// src/commands/hook.ts
var hook_exports = {};
__export(hook_exports, {
  run: () => run8
});
async function run8(_args) {
  return 0;
}
var init_hook = __esm({
  "src/commands/hook.ts"() {
    "use strict";
  }
});

// src/consort.ts
init_args();
init_paths();
init_colors();
async function loadHandlers() {
  const [spawn2, send, collect, roster, coda, soundcheck, preflight, hook] = await Promise.all([
    Promise.resolve().then(() => (init_spawn(), spawn_exports)),
    Promise.resolve().then(() => (init_send2(), send_exports)),
    Promise.resolve().then(() => (init_collect(), collect_exports)),
    Promise.resolve().then(() => (init_roster(), roster_exports)),
    Promise.resolve().then(() => (init_coda(), coda_exports)),
    Promise.resolve().then(() => (init_soundcheck(), soundcheck_exports)),
    Promise.resolve().then(() => (init_preflight(), preflight_exports)),
    Promise.resolve().then(() => (init_hook(), hook_exports))
  ]);
  return {
    spawn: spawn2.run,
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
  const c3 = /^colour(\d+)$/.test(color) ? `\x1B[38;5;${color.replace("colour", "")}m` : "";
  const r = "\x1B[0m";
  const fast = Boolean(process.env.CONSORT_BANNER_FAST);
  for (let i2 = 8; i2 >= 1; i2--) {
    process.stdout.write(`  ${c3}Closing in ${i2} second${i2 === 1 ? "" : "s"}...${r}\r`);
    if (!fast) await new Promise((res) => setTimeout(res, 1e3));
  }
  process.stdout.write(`  ${c3}Closed.                          ${r}
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
