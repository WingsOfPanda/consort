// tests/perform-sibling.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateSiblings, captureSiblingBaseline, formatBaselineFile, parseBaselineFile,
  diffSiblingAgainstBaseline, formatRogueBlock, revertAndReplay, rescueBranchName,
} from "../src/core/performSibling.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

function fakeRunner(replies: Record<string, RunResult>) {
  const calls: string[][] = [];
  const r: Runner = {
    run(cmd, args) { calls.push([cmd, ...args]); return replies[[cmd, ...args].join(" ")] ?? { code: 0, stdout: "" }; },
  };
  return { r, calls };
}

describe("enumerateSiblings", () => {
  let hub: string;
  beforeEach(() => { hub = mkdtempSync(join(tmpdir(), "consort-sib-")); });
  afterEach(() => { rmSync(hub, { recursive: true, force: true }); });
  function makeRepo(slug: string, gitIsDir = true) {
    const dir = join(hub, slug); mkdirSync(dir, { recursive: true });
    if (gitIsDir) mkdirSync(join(dir, ".git")); else writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
  }
  it("keeps git-repo siblings, sorted, excluding declared targets", () => {
    makeRepo("zeta"); makeRepo("alpha"); makeRepo("beta");
    const res = enumerateSiblings(hub, ["beta"]);
    expect(res.outcome).toBe("ok");
    expect(res.siblings).toEqual(["alpha", "zeta"]);
  });
  it("skips hidden dirs, non-repos, and submodule gitlink (.git FILE)", () => {
    makeRepo("good");
    mkdirSync(join(hub, ".hidden", ".git"), { recursive: true });
    mkdirSync(join(hub, "plain"));
    makeRepo("submod", false);
    expect(enumerateSiblings(hub, []).siblings).toEqual(["good"]);
  });
  it("empty exclusion list returns all repo siblings", () => {
    makeRepo("a");
    expect(enumerateSiblings(hub, []).siblings).toEqual(["a"]);
  });
  it("non-existent hub -> not-a-directory, empty list", () => {
    expect(enumerateSiblings(join(hub, "nope"), [])).toEqual({ outcome: "not-a-directory", siblings: [] });
  });
});

describe("captureSiblingBaseline", () => {
  it("ok: emits byte-identical <slug>\\t<sha>\\t<branch>\\n row", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git\n" },
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main\n" },
      "git rev-parse HEAD": { code: 0, stdout: "deadbeef\n" },
    });
    const res = captureSiblingBaseline(r, "/home/me/proj/sidekick");
    expect(res.outcome).toBe("ok");
    expect(res.slug).toBe("sidekick");
    expect(res.sha).toBe("deadbeef");
    expect(res.branch).toBe("main");
    expect(res.row).toBe("sidekick\tdeadbeef\tmain\n");
  });
  it("not-git: rev-parse --git-dir fails", () => {
    const { r } = fakeRunner({ "git rev-parse --git-dir": { code: 128, stdout: "" } });
    expect(captureSiblingBaseline(r, "/x/y").outcome).toBe("not-git");
  });
  it("detached: symbolic-ref fails", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git" },
      "git symbolic-ref --short HEAD": { code: 1, stdout: "" },
    });
    expect(captureSiblingBaseline(r, "/x/y").outcome).toBe("detached");
  });
});

describe("baseline file round-trip", () => {
  it("formatBaselineFile concatenates rows verbatim", () => {
    expect(formatBaselineFile(["a\t1\tmain\n", "b\t2\tdev\n"])).toBe("a\t1\tmain\nb\t2\tdev\n");
    expect(formatBaselineFile([])).toBe("");
  });
  it("parseBaselineFile parses, skips blanks, preserves tabs in branch field", () => {
    const body = "a\t1\tmain\n\nb\t2\tfeat/x\n";
    expect(parseBaselineFile(body)).toEqual([
      { slug: "a", sha: "1", branch: "main" },
      { slug: "b", sha: "2", branch: "feat/x" },
    ]);
  });
  it("parseBaselineFile drops short (<3 field) lines", () => {
    expect(parseBaselineFile("onlyslug\n")).toEqual([]);
  });
});

describe("diffSiblingAgainstBaseline", () => {
  const okRepo = { "git rev-parse --git-dir": { code: 0, stdout: ".git" } };
  it("ok: returns trimmed oneline log over base..refs/heads/branch", () => {
    const { r, calls } = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q base000": { code: 0, stdout: "base000\n" },
      "git rev-parse --verify -q refs/heads/main": { code: 0, stdout: "abc\n" },
      "git log base000..refs/heads/main --oneline": { code: 0, stdout: "c2 second\nc1 first\n" },
    });
    const res = diffSiblingAgainstBaseline(r, "base000", "main");
    expect(res.outcome).toBe("ok");
    expect(res.log).toBe("c2 second\nc1 first");
    expect(calls).toContainEqual(["git", "log", "base000..refs/heads/main", "--oneline"]);
  });
  it("ok with no rogue commits -> empty log", () => {
    const { r } = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q base000": { code: 0, stdout: "base000" },
      "git rev-parse --verify -q refs/heads/main": { code: 0, stdout: "abc" },
      "git log base000..refs/heads/main --oneline": { code: 0, stdout: "" },
    });
    expect(diffSiblingAgainstBaseline(r, "base000", "main")).toEqual({ outcome: "ok", log: "" });
  });
  it("not-git / unknown-baseline / missing-branch outcomes", () => {
    const notGit = fakeRunner({ "git rev-parse --git-dir": { code: 128, stdout: "" } });
    expect(diffSiblingAgainstBaseline(notGit.r, "b", "main").outcome).toBe("not-git");
    const badBase = fakeRunner({ ...okRepo, "git rev-parse --verify -q b": { code: 1, stdout: "" } });
    expect(diffSiblingAgainstBaseline(badBase.r, "b", "main").outcome).toBe("unknown-baseline");
    const noBranch = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q b": { code: 0, stdout: "b" },
      "git rev-parse --verify -q refs/heads/main": { code: 1, stdout: "" },
    });
    expect(diffSiblingAgainstBaseline(noBranch.r, "b", "main").outcome).toBe("missing-branch");
  });
});

describe("formatRogueBlock", () => {
  it("emits <slug>\\n<log>\\n when there are rogue commits", () => {
    expect(formatRogueBlock("sidekick", "c1 one\nc2 two")).toBe("sidekick\nc1 one\nc2 two\n");
  });
  it("empty log -> empty block (no header)", () => {
    expect(formatRogueBlock("sidekick", "")).toBe("");
  });
});

describe("rescueBranchName", () => {
  it("uses the rebranded feat/perform-<topic>-rescue shape", () => {
    expect(rescueBranchName("auth")).toBe("feat/perform-auth-rescue");
  });
});

describe("revertAndReplay", () => {
  const topic = "auth";
  const rescue = "feat/perform-auth-rescue";
  it("happy path: replay oldest-first, revert newest-first, returns ok", () => {
    const { r, calls } = fakeRunner({ [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" } });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "ok", rescue });
    expect(calls).toContainEqual(["git", "branch", rescue, "base000"]);
    expect(calls).toContainEqual(["git", "checkout", "-q", rescue]);
    expect(calls.filter((c) => c[1] === "cherry-pick").map((c) => c[2])).toEqual(["s1", "s2", "s3"]);
    expect(calls.filter((c) => c[1] === "revert" && c[2] === "--no-edit").map((c) => c[3])).toEqual(["s3", "s2", "s1"]);
  });
  it("rescue branch pre-exists -> rescue-exists, no mutation", () => {
    const { r, calls } = fakeRunner({ [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 0, stdout: "" } });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"])).toEqual({ outcome: "rescue-exists", rescue });
    expect(calls.some((c) => c[1] === "branch")).toBe(false);
  });
  it("branch-create failure -> branch-create-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      [`git branch ${rescue} base000`]: { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("branch-create-failed");
  });
  it("checkout-rescue failure -> checkout-rescue-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      [`git checkout -q ${rescue}`]: { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("checkout-rescue-failed");
  });
  it("cherry-pick conflict -> aborts, returns to branch, reports failed sha", () => {
    const { r, calls } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git cherry-pick s2": { code: 1, stdout: "" },
    });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "cherry-pick-conflict", rescue, failedSha: "s2" });
    expect(calls).toContainEqual(["git", "cherry-pick", "--abort"]);
    expect(calls).toContainEqual(["git", "checkout", "-q", "main"]);
    expect(calls.some((c) => c[1] === "cherry-pick" && c[2] === "s3")).toBe(false);
  });
  it("checkout-back failure -> checkout-back-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git checkout -q main": { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("checkout-back-failed");
  });
  it("revert conflict -> aborts revert, reports failed sha, rescue intact", () => {
    const { r, calls } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git revert --no-edit s3": { code: 1, stdout: "" },
    });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "revert-conflict", rescue, failedSha: "s3" });
    expect(calls).toContainEqual(["git", "revert", "--abort"]);
  });
});
