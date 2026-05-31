// tests/solo-cmd.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { run as soloRun, initWith } from "../src/commands/solo.js";
import type { InitDeps } from "../src/commands/solo.js";

describe("solo dispatcher", () => {
  it("no verb / unknown verb → usage, rc 2", async () => {
    expect(await soloRun([])).toBe(2);
    expect(await soloRun(["frobnicate"])).toBe(2);
  });
});

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { freshHome } from "./helpers/tmpHome.js";
import { soloArtDir } from "../src/core/solo.js";

// Build an --args-file the way the dispatcher expects (first line tokenized).
function argsFile(home: string, line: string): string {
  const p = join(home, "args.txt");
  writeFileSync(p, line + "\n");
  return p;
}

describe("solo init", () => {
  let h: { home: string; cleanup: () => void };
  let outSpy: ReturnType<typeof captureStdout>;
  beforeEach(() => { h = freshHome(); outSpy = captureStdout(); });
  afterEach(() => { outSpy.restore(); h.cleanup(); });

  // Deterministic deps: provider present + on PATH, instrument fixed — no env dependency.
  const okDeps: InitDeps = { haveCmd: () => true, instrumentBinary: () => "codex", pickRandomInstrument: () => "violin" };

  it("scaffolds _solo, validates provider, prints KV; rc 0", async () => {
    const rc = await initWith(["add", "oauth", "login", "--provider", "codex"], okDeps);
    expect(rc).toBe(0);
    const art = soloArtDir("add-oauth-login");
    expect(existsSync(join(art, "execute"))).toBe(true);
    expect(readFileSync(join(art, "topic.txt"), "utf8").trim()).toBe("add-oauth-login");
    expect(readFileSync(join(art, "selected-provider.txt"), "utf8").trim()).toBe("codex");
    expect(readFileSync(join(art, "instrument.txt"), "utf8").trim()).toBe("violin");
    expect(readFileSync(join(art, "execute", "finish.txt"), "utf8").trim()).toBe("yes");
    expect(outSpy.text()).toMatch(/^SLUG=add-oauth-login$/m);
    expect(outSpy.text()).toMatch(/^PROVIDER=codex$/m);
    expect(outSpy.text()).toMatch(/^INSTRUMENT=violin$/m);
  });

  it("--no-finish opts out → finish.txt is no; rc 0", async () => {
    const rc = await initWith(["add", "oauth", "login", "--provider", "codex", "--no-finish"], okDeps);
    expect(rc).toBe(0);
    const art = soloArtDir("add-oauth-login");
    expect(readFileSync(join(art, "execute", "finish.txt"), "utf8").trim()).toBe("no");
  });

  it("empty topic → rc 1", async () => {
    expect(await soloRun(["init", "--args-file", argsFile(h.home, "--provider codex")])).toBe(1);
  });

  it("unknown provider → rc 3 (env-independent: reads shipped contracts.yaml)", async () => {
    expect(await soloRun(["init", "--args-file", argsFile(h.home, "do thing --provider nope")])).toBe(3);
  });

  it("provider known but binary not on PATH → rc 3", async () => {
    const rc = await initWith(["do", "thing"], { haveCmd: () => false, instrumentBinary: () => "codex", pickRandomInstrument: () => "violin" });
    expect(rc).toBe(3);
  });

  it("in-flight (art dir exists) → rc 2", async () => {
    expect(await initWith(["dup", "topic", "--provider", "codex"], okDeps)).toBe(0);
    expect(await initWith(["dup", "topic", "--provider", "codex"], okDeps)).toBe(2);
  });
});

// Minimal stdout capture helper (no extra deps).
function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: any, ..._rest: any[]) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

import { branchWith } from "../src/commands/solo.js";
import type { Runner } from "../src/core/gitwork.js";

describe("solo branch (branchWith core)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  function fake(): { r: Runner; calls: string[][] } {
    const calls: string[][] = [];
    const r: Runner = { run(cmd, args) {
      calls.push([cmd, ...args]);
      const k = [cmd, ...args].join(" ");
      if (k === "git rev-parse --git-dir") return { code: 0, stdout: ".git" };
      if (k === "git symbolic-ref --short HEAD") return { code: 0, stdout: "main" };
      if (k === "git rev-parse HEAD") return { code: 0, stdout: "base000" };
      if (k === "git status --porcelain") return { code: 0, stdout: "" };
      if (k === "git show-ref --verify --quiet refs/heads/feat/solo-auth") return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    } };
    return { r, calls };
  }

  it("writes execute/ snapshot files and creates the branch; rc 0", async () => {
    // pre-create _solo so atomicWrite's parent exists (init normally does this)
    const { soloExecDir } = await import("../src/core/solo.js");
    mkdtempSync(join(tmpdir(), "x-")); // noop to keep import order
    const { mkdirSync } = await import("node:fs");
    mkdirSync(soloExecDir("auth"), { recursive: true });

    const { r, calls } = fake();
    const rc = await branchWith("auth", "/proj", r);
    expect(rc).toBe(0);
    expect(calls).toContainEqual(["git", "checkout", "-q", "-b", "feat/solo-auth"]);
    const exec = soloExecDir("auth");
    expect(readFileSync(join(exec, "target_cwd.txt"), "utf8").trim()).toBe("/proj");
    expect(readFileSync(join(exec, "start-branch.txt"), "utf8").trim()).toBe("main");
    expect(readFileSync(join(exec, "branch-base.sha"), "utf8").trim()).toBe("base000");
    expect(readFileSync(join(exec, "branch.txt"), "utf8").trim()).toBe("feat/solo-auth");
  });

  it("not-git target → rc 1", async () => {
    const r: Runner = { run: () => ({ code: 128, stdout: "" }) };
    const { mkdirSync } = await import("node:fs");
    const { soloExecDir } = await import("../src/core/solo.js");
    mkdirSync(soloExecDir("nope"), { recursive: true });
    expect(await branchWith("nope", "/proj", r)).toBe(1);
  });
});

import { turnSendWith } from "../src/commands/solo.js";

describe("solo turn-send (turnSendWith core)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  async function scaffold(topic: string) {
    const { soloArtDir, soloExecDir } = await import("../src/core/solo.js");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(soloExecDir(topic), { recursive: true });
    const art = soloArtDir(topic);
    writeFileSync(join(art, "instrument.txt"), "violin\n");
    writeFileSync(join(art, "selected-provider.txt"), "codex\n");
    writeFileSync(join(art, "task-brief.md"), "## Goal\nDo X");
    writeFileSync(join(soloExecDir(topic), "branch.txt"), "feat/solo-auth\n");
  }

  it("round 1: writes OFFSET, prompt file, calls send; rc 0", async () => {
    await scaffold("auth");
    const sends: string[][] = [];
    const rc = await turnSendWith("auth", 1, {
      offsetFor: () => 42,
      send: async (args) => { sends.push(args); return 0; },
    });
    expect(rc).toBe(0);
    const { soloExecDir } = await import("../src/core/solo.js");
    const exec = soloExecDir("auth");
    expect(readFileSync(join(exec, "turn-1.txt"), "utf8")).toBe("OFFSET=42\n");
    expect(readFileSync(join(exec, "turn-prompt-1.md"), "utf8")).toContain("## Goal\nDo X");
    expect(sends[0]).toEqual(["violin", "auth", `@${join(exec, "turn-prompt-1.md")}`]);
  });

  it("round 1 idempotency: existing turn-1.txt → rc 1", async () => {
    await scaffold("auth");
    const { soloExecDir } = await import("../src/core/solo.js");
    writeFileSync(join(soloExecDir("auth"), "turn-1.txt"), "OFFSET=0\n");
    expect(await turnSendWith("auth", 1, { offsetFor: () => 0, send: async () => 0 })).toBe(1);
  });

  it("round 2 without a fix bundle → rc 1", async () => {
    await scaffold("auth");
    expect(await turnSendWith("auth", 2, { offsetFor: () => 0, send: async () => 0 })).toBe(1);
  });
});

import { turnWaitWith } from "../src/commands/solo.js";

describe("solo turn-wait (turnWaitWith core)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  async function scaffold(topic: string, stateBody: string) {
    const { soloArtDir, soloExecDir } = await import("../src/core/solo.js");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(soloExecDir(topic), { recursive: true });
    writeFileSync(join(soloArtDir(topic), "instrument.txt"), "violin\n");
    writeFileSync(join(soloArtDir(topic), "selected-provider.txt"), "codex\n");
    writeFileSync(join(soloExecDir(topic), `turn-1.txt`), stateBody);
  }

  it("done → appends TS=ok; rc 0", async () => {
    await scaffold("auth", "OFFSET=10\n");
    const rc = await turnWaitWith("auth", 1, { wait: async () => ({ event: "done", summary: "ok" }) });
    expect(rc).toBe(0);
    const { soloExecDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloExecDir("auth"), "turn-1.txt"), "utf8")).toBe("OFFSET=10\nTS=ok\n");
  });

  it("question → captures payload + TS=question", async () => {
    await scaffold("auth", "OFFSET=0\n");
    await turnWaitWith("auth", 1, { wait: async () => ({ event: "question", message: "which db?" }) });
    const { soloExecDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloExecDir("auth"), "turn-1.txt"), "utf8")).toContain("TS=question");
    expect(readFileSync(join(soloExecDir("auth"), "question-1.txt"), "utf8")).toContain("which db?");
  });

  it("timeout (null) → TS=timeout", async () => {
    await scaffold("auth", "OFFSET=0\n");
    await turnWaitWith("auth", 1, { wait: async () => null });
    const { soloExecDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloExecDir("auth"), "turn-1.txt"), "utf8")).toContain("TS=timeout");
  });

  it("missing OFFSET → rc 1", async () => {
    await scaffold("auth", "TS=stale\n");
    expect(await turnWaitWith("auth", 1, { wait: async () => null })).toBe(1);
  });
});

describe("solo detect-test", () => {
  let outSpy: ReturnType<typeof captureStdout>;
  beforeEach(() => { outSpy = captureStdout(); });
  afterEach(() => { outSpy.restore(); });

  it("prints the detected command for a given cwd; rc 0", async () => {
    const r = mkdtempSync(join(tmpdir(), "dt2-")); writeFileSync(join(r, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
    expect(await soloRun(["detect-test", r])).toBe(0);
    expect(outSpy.text().trim()).toBe("npm test");
  });
});

import { finishWith } from "../src/commands/solo.js";

describe("solo finish (finishWith core)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  async function scaffold(topic: string, finishFlag: string) {
    const { soloArtDir, soloExecDir } = await import("../src/core/solo.js");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(soloExecDir(topic), { recursive: true });
    const exec = soloExecDir(topic);
    writeFileSync(join(exec, "target_cwd.txt"), "/proj\n");
    writeFileSync(join(exec, "branch.txt"), "feat/solo-auth\n");
    writeFileSync(join(exec, "start-branch.txt"), "main\n");
    writeFileSync(join(exec, "finish.txt"), finishFlag + "\n");
    writeFileSync(join(soloArtDir(topic), "task-brief.md"), "## Goal\nX");
    writeFileSync(join(exec, "verify-result.txt"), "PASS (npm test)\n");
  }

  function fake(replies: Record<string, { code: number; stdout: string }>) {
    const calls: string[][] = [];
    return { calls, r: { run: (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return replies[[cmd, ...args].join(" ")] ?? { code: 0, stdout: "" }; } } };
  }

  it("finish.txt=no → restore only, records branch-only; rc 0", async () => {
    await scaffold("auth", "no");
    const { calls, r } = fake({});
    expect(await finishWith("auth", r as any, true)).toBe(0);
    expect(calls).toContainEqual(["git", "checkout", "-q", "main"]);
    const { soloExecDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloExecDir("auth"), "finish-result.txt"), "utf8")).toContain("branch-only");
  });

  it("finish.txt=yes + remote → push/pr path, records outcome", async () => {
    await scaffold("auth", "yes");
    const { calls, r } = fake({
      "git remote": { code: 0, stdout: "origin\n" },
      "git push -q -u origin feat/solo-auth": { code: 0, stdout: "" },
      "git remote get-url origin": { code: 0, stdout: "url\n" },
    });
    expect(await finishWith("auth", r as any, true)).toBe(0);
    expect(calls.some((c) => c[0] === "gh")).toBe(true);
    const { soloExecDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloExecDir("auth"), "finish-result.txt"), "utf8")).toContain("pr-opened");
  });
});

describe("solo summary", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  async function scaffold(topic: string) {
    const { soloArtDir, soloExecDir } = await import("../src/core/solo.js");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(soloExecDir(topic), { recursive: true });
    const art = soloArtDir(topic), exec = soloExecDir(topic);
    writeFileSync(join(art, "topic.txt"), topic + "\n");
    writeFileSync(join(art, "timing.txt"), "started=2026-05-29T06:00:00Z\n");
    writeFileSync(join(art, "selected-provider.txt"), "codex\n");
    writeFileSync(join(art, "instrument.txt"), "violin\n");
    writeFileSync(join(exec, "branch.txt"), "feat/solo-auth\n");
    writeFileSync(join(exec, "verify-result.txt"), "PASS (npm test)\n");
    writeFileSync(join(exec, "diff-stats.txt"), "2 files changed\n");
    writeFileSync(join(exec, "target_cwd.txt"), "/proj\n");
    writeFileSync(join(exec, "branch-base.sha"), "base000\n");
  }

  it("ok summary → SUMMARY.md with status ok; rc 0", async () => {
    await scaffold("auth");
    expect(await soloRun(["summary", "auth"])).toBe(0);
    const { soloArtDir } = await import("../src/core/solo.js");
    const md = readFileSync(join(soloArtDir("auth"), "SUMMARY.md"), "utf8");
    expect(md).toContain("status: ok");
    expect(md).toContain("- Branch: feat/solo-auth");
  });

  it("aborted summary → SUMMARY.md (aborted) + RESUME.md", async () => {
    await scaffold("auth");
    expect(await soloRun(["summary", "auth", "--aborted", "build", "part-turn-failed", "turn", "failed", "twice"])).toBe(0);
    const { soloArtDir } = await import("../src/core/solo.js");
    expect(readFileSync(join(soloArtDir("auth"), "SUMMARY.md"), "utf8")).toContain("status: aborted");
    expect(readFileSync(join(soloArtDir("auth"), "SUMMARY.md"), "utf8")).toContain("turn failed twice");
    expect(existsSync(join(soloArtDir("auth"), "RESUME.md"))).toBe(true);
  });
});
