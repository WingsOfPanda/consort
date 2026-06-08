// tests/duet-cmd.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run as duetRun, initWith } from "../src/commands/duet.js";
import type { InitDeps } from "../src/commands/duet.js";
import { duetArtDir, duetExecDir } from "../src/core/duet.js";
import { freshHome } from "./helpers/tmpHome.js";

// Inline stdout capture (copied per file, like solo-cmd.test.ts).
function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as unknown as { write: unknown }).write = (chunk: unknown) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as unknown as { write: unknown }).write = orig; } };
}

const okDeps: InitDeps = {
  haveCmd: () => true,
  instrumentBinary: () => "codex",
  pickRandomInstrument: () => "viola",
  isGitRepo: () => true,
  headSha: () => "abc123",
};

describe("duet run() dispatch", () => {
  it("unknown verb → rc 2", async () => { expect(await duetRun(["nope"])).toBe(2); });
});

describe("duet init", () => {
  let h: { home: string; cleanup: () => void };
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => { h = freshHome(); out = captureStdout(); });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("scaffolds _duet, writes state incl. target_cwd/mode, prints KV; rc 0", async () => {
    const repo = join(h.home, "repoB"); mkdirSync(repo, { recursive: true });
    const rc = await initWith(["--repo", repo, "add", "oauth"], okDeps);
    expect(rc).toBe(0);
    const art = duetArtDir("add-oauth"), exec = duetExecDir("add-oauth");
    expect(existsSync(join(exec))).toBe(true);
    expect(readFileSync(join(exec, "target_cwd.txt"), "utf8").trim()).toBe(repo);
    expect(readFileSync(join(exec, "mode.txt"), "utf8").trim()).toBe("branch");
    expect(readFileSync(join(art, "topic-text.txt"), "utf8")).toBe("add oauth");
    expect(out.text()).toMatch(/^SLUG=add-oauth$/m);
    expect(out.text()).toMatch(new RegExp(`^TARGET=${repo}$`, "m"));
    expect(out.text()).toMatch(/^MODE=branch$/m);
  });

  it("missing --repo → rc 1", async () => {
    expect(await initWith(["just", "a", "task"], okDeps)).toBe(1);
  });
  it("non-absolute --repo → rc 1", async () => {
    expect(await initWith(["--repo", "relative/path", "task"], okDeps)).toBe(1);
  });
  it("--repo with whitespace → rc 1", async () => {
    // (verbatim-tail can't deliver a spaced --repo token; reject defensively)
    expect(await initWith(["--repo", "/has space", "task"], okDeps)).toBe(1);
  });
  it("non-git --repo in branch mode → rc 1", async () => {
    const repo = join(h.home, "plain"); mkdirSync(repo, { recursive: true });
    expect(await initWith(["--repo", repo, "task"], { ...okDeps, isGitRepo: () => false })).toBe(1);
  });
  it("--in-place skips the git check and records mode=in-place", async () => {
    const repo = join(h.home, "plain2"); mkdirSync(repo, { recursive: true });
    const rc = await initWith(["--repo", repo, "--in-place", "quick fix"], { ...okDeps, isGitRepo: () => false });
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("quick-fix"), "mode.txt"), "utf8").trim()).toBe("in-place");
  });
  it("already in flight → rc 2", async () => {
    const repo = join(h.home, "repoB"); mkdirSync(repo, { recursive: true });
    await initWith(["--repo", repo, "dup"], okDeps);
    expect(await initWith(["--repo", repo, "dup"], okDeps)).toBe(2);
  });
});

import { branchWith } from "../src/commands/duet.js";
import type { Runner } from "../src/core/gitwork.js";
import { writeFileSync } from "node:fs";

function fakeRunner(map: Record<string, { code?: number; stdout?: string }>): Runner {
  return { run: (cmd, args) => { const key = [cmd, ...args].join(" "); const r = map[key] ?? matchPrefix(map, key); return { code: r?.code ?? 0, stdout: r?.stdout ?? "" }; } };
}
function matchPrefix(map: Record<string, { code?: number; stdout?: string }>, key: string) {
  for (const k of Object.keys(map)) if (key.startsWith(k)) return map[k]; return undefined;
}

describe("duet branch", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  function seedInit(slug: string, repo: string) {
    const exec = duetExecDir(slug); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "target_cwd.txt"), repo + "\n");
    writeFileSync(join(exec, "mode.txt"), "branch\n");
  }

  it("cuts feat/duet-<slug> and records start-branch/base; rc 0", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({
      "git rev-parse --git-dir": { code: 0 },
      "git symbolic-ref --short HEAD": { stdout: "main\n" },
      "git rev-parse HEAD": { stdout: "deadbeef\n" },
      "git status --porcelain": { stdout: "" },
      "git show-ref": { code: 1 },              // branch doesn't exist yet
      "git checkout -q -b feat/duet-t": { code: 0 },
    });
    const rc = await branchWith("t", "/abs/repoB", r);
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "branch.txt"), "utf8").trim()).toBe("feat/duet-t");
    expect(readFileSync(join(duetExecDir("t"), "start-branch.txt"), "utf8").trim()).toBe("main");
  });

  it("refuses when repo B is already on another feat/duet-* branch (single-occupancy); rc 1", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({
      "git rev-parse --git-dir": { code: 0 },
      "git symbolic-ref --short HEAD": { stdout: "feat/duet-other\n" },
      "git rev-parse HEAD": { stdout: "deadbeef\n" },
      "git status --porcelain": { stdout: "" },
    });
    expect(await branchWith("t", "/abs/repoB", r)).toBe(1);
  });

  it("rc 1 when target is not a git repo", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({ "git rev-parse --git-dir": { code: 1 } });
    expect(await branchWith("t", "/abs/repoB", r)).toBe(1);
  });
});

import { roundSendWith, roundWaitWith } from "../src/commands/duet.js";
import type { TurnSendDeps, TurnWaitDeps } from "../src/commands/duet.js";
import type { OutboxEvent } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";

function seedPart(slug: string, repo: string) {
  const art = duetArtDir(slug), exec = duetExecDir(slug);
  mkdirSync(exec, { recursive: true });
  writeFileSync(join(art, "instrument.txt"), "viola\n");
  writeFileSync(join(art, "selected-provider.txt"), "codex\n");
  writeFileSync(join(art, "topic-text.txt"), "implement X");
  writeFileSync(join(exec, "target_cwd.txt"), repo + "\n");
  writeFileSync(join(exec, "branch.txt"), `feat/duet-${slug}\n`);
  // outbox must exist for the guard
  const pd = partDir("viola", "codex", slug); mkdirSync(pd, { recursive: true }); writeFileSync(join(pd, "outbox.jsonl"), "");
}

describe("duet round-send / round-wait", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  it("round-send 1 records OFFSET and sends the composed brief", async () => {
    seedPart("t", "/abs/repoB");
    let sent: string[] | undefined;
    const deps: TurnSendDeps = { offsetFor: () => 0, send: async (a) => { sent = a; return 0; } };
    const rc = await roundSendWith("t", 1, deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8")).toContain("OFFSET=0");
    expect(sent?.[0]).toBe("viola");
    expect(sent?.[2]).toMatch(/^@.*round-prompt-1\.md$/);
    expect(readFileSync(join(duetExecDir("t"), "round-prompt-1.md"), "utf8")).toContain("implement X");
  });

  it("round-send 2 requires followup-2.md (rc 1 if missing)", async () => {
    seedPart("t", "/abs/repoB");
    const deps: TurnSendDeps = { offsetFor: () => 0, send: async () => 0 };
    expect(await roundSendWith("t", 2, deps)).toBe(1);
  });

  it("round-wait classifies done→ok and writes TS=ok", async () => {
    seedPart("t", "/abs/repoB");
    writeFileSync(join(duetExecDir("t"), "round-1.txt"), "OFFSET=0\n");
    const deps: TurnWaitDeps = { wait: async () => ({ event: "done", summary: "x", ts: "now" } as OutboxEvent) };
    expect(await roundWaitWith("t", 1, deps)).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8")).toContain("TS=ok");
  });

  it("round-wait on a question writes question-N.txt and APPENDS a bumped OFFSET + TS=question", async () => {
    seedPart("t", "/abs/repoB");
    writeFileSync(join(duetExecDir("t"), "round-1.txt"), "OFFSET=0\n");
    // make the outbox non-empty so the bumped offset differs
    writeFileSync(join(partDir("viola", "codex", "t"), "outbox.jsonl"), '{"event":"question","question":"?","ts":"now"}\n');
    const deps: TurnWaitDeps = { wait: async () => ({ event: "question", question: "?", ts: "now" } as unknown as OutboxEvent) };
    expect(await roundWaitWith("t", 1, deps)).toBe(0);
    const st = readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8");
    expect(st).toMatch(/TS=question/);
    expect((st.match(/OFFSET=/g) || []).length).toBe(2); // original + bumped
    expect(existsSync(join(duetExecDir("t"), "question-1.txt"))).toBe(true);
  });
});

import { finishWith } from "../src/commands/duet.js";

describe("duet finish", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  it("fails closed (rc 1) when target_cwd.txt is absent — never pushes the conductor repo", async () => {
    const { run: finishRun } = await import("../src/commands/duet.js");
    duetExecDir("t"); mkdirSync(duetExecDir("t"), { recursive: true }); // exec dir but NO target_cwd.txt
    expect(await finishRun(["finish", "t"])).toBe(1);
  });

  it("branch mode: writes diff-stats + finish-result, builds a duet: PR title", async () => {
    const exec = duetExecDir("t"); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "mode.txt"), "branch\n");
    writeFileSync(join(exec, "branch.txt"), "feat/duet-t\n");
    writeFileSync(join(exec, "start-branch.txt"), "main\n");
    writeFileSync(join(exec, "branch-base.sha"), "base1\n");
    writeFileSync(join(exec, "verify-result.txt"), "PASS\n");
    writeFileSync(join(duetArtDir("t"), "topic-text.txt"), "the task");
    let prTitle = "";
    const r: Runner = { run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (key.startsWith("git diff --shortstat")) return { code: 0, stdout: " 1 file changed\n" };
      if (key === "git remote") return { code: 0, stdout: "origin\n" };
      if (key.startsWith("git push")) return { code: 0, stdout: "" };
      if (key.startsWith("git remote get-url")) return { code: 0, stdout: "git@x:y.git\n" };
      if (cmd === "gh") { prTitle = args[args.indexOf("--title") + 1]; return { code: 0, stdout: "" }; }
      return { code: 0, stdout: "" };
    } };
    const rc = await finishWith("t", r, true);
    expect(rc).toBe(0);
    expect(prTitle).toBe("duet: feat/duet-t");
    expect(readFileSync(join(exec, "diff-stats.txt"), "utf8")).toContain("1 file changed");
    expect(readFileSync(join(exec, "finish-result.txt"), "utf8")).toContain("pr");
  });

  it("in-place mode: no branch ops, records in-place finish-result", async () => {
    const exec = duetExecDir("t"); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "mode.txt"), "in-place\n");
    const r: Runner = { run: () => ({ code: 0, stdout: "" }) };
    expect(await finishWith("t", r, true)).toBe(0);
    expect(readFileSync(join(exec, "finish-result.txt"), "utf8")).toContain("in-place");
  });
});
