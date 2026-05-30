// tests/perform-cmd.test.ts — B2b: perform pre-snapshot / branch / scope-check / summary / finish /
// forensics / archive verbs. Fake Runner injection; CONSORT_HOME temp; byte-exact state-file asserts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir, performTopicDir } from "../src/core/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";
import {
  preSnapshotWith, branchWith, scopeCheckWith, summaryWith, finishWith, archiveRun, run,
} from "../src/commands/perform.js";

const TOPIC = "add-oauth";

// ---- fakeRunner: maps "cmd arg arg..." -> {code,stdout}; unscripted argv -> {code:0,stdout:""}. ----
function fakeRunner(script: Record<string, { code?: number; stdout?: string }>): Runner {
  return {
    run(cmd: string, args: string[]): RunResult {
      const key = [cmd, ...args].join(" ");
      const hit = script[key];
      return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "" };
    },
  };
}

// capture process.stdout.write + process.stderr.write for the duration of fn().
async function capture(fn: () => Promise<number>): Promise<{ rc: number; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write;
  try { const rc = await fn(); return { rc, out: out.join(""), err: err.join("") }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}

function seedArt(): string {
  const art = performArtDir(TOPIC);
  mkdirSync(art, { recursive: true });
  return art;
}
// single-repo iterTargets row: writes target_cwd.txt → one {slug:"main", cwd} row.
function seedTargetCwd(art: string, cwd: string): void {
  writeFileSync(join(art, "target_cwd.txt"), cwd + "\n");
}

describe("perform pre-snapshot", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  it("art-dir missing → rc 1", async () => {
    const { rc } = await capture(() => preSnapshotWith(TOPIC, {}, () => fakeRunner({})));
    expect(rc).toBe(1);
  });

  it("single-repo clean tree → baselines/main.tsv with state=clean + baseline_sha in key order, rc 0", async () => {
    const art = seedArt();
    seedTargetCwd(art, "/repo/main");
    // preSnapshot git calls: rev-parse --git-dir (ok), symbolic-ref (branch), rev-parse HEAD (sha),
    // status --porcelain (empty=clean) → state clean, baseSha = preSha.
    const r = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git\n" },
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main\n" },
      "git rev-parse HEAD": { code: 0, stdout: "ABC123\n" },
      "git status --porcelain": { code: 0, stdout: "" },
    });
    const { rc, out } = await capture(() => preSnapshotWith(TOPIC, {}, () => r));
    expect(rc).toBe(0);
    void out;
    const tsv = readFileSync(join(art, "baselines", "main.tsv"), "utf8");
    // exact key order, and the snapshot_ts line is dynamic — strip it for the byte-exact head.
    const head = tsv.split("\n").filter((l) => !l.startsWith("snapshot_ts=")).join("\n");
    expect(head).toBe("slug=main\ncwd=/repo/main\nbranch=main\nbaseline_sha=ABC123\nstate=clean\n");
    expect(tsv).toMatch(/^snapshot_ts=.+$/m);
  });

  it("not-git → rc 2", async () => {
    const art = seedArt();
    seedTargetCwd(art, "/repo/main");
    const r = fakeRunner({ "git rev-parse --git-dir": { code: 128, stdout: "" } });
    const { rc } = await capture(() => preSnapshotWith(TOPIC, {}, () => r));
    expect(rc).toBe(2);
  });
});

describe("perform branch", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  it("art-dir missing → rc 1", async () => {
    const { rc } = await capture(() => branchWith({ topic: TOPIC, noBranch: false }, {}, () => fakeRunner({})));
    expect(rc).toBe(1);
  });

  it("ref absent → creates feat/perform-<topic>, records it; branch-base.sha from baseline", async () => {
    const art = seedArt();
    seedTargetCwd(art, "/repo/main");
    mkdirSync(join(art, "baselines"), { recursive: true });
    writeFileSync(join(art, "baselines", "main.tsv"), "slug=main\nbaseline_sha=ABC\n");
    const r = fakeRunner({
      "git show-ref --verify --quiet refs/heads/feat/perform-add-oauth": { code: 1, stdout: "" },
      "git checkout -q -b feat/perform-add-oauth": { code: 0, stdout: "" },
    });
    const { rc } = await capture(() => branchWith({ topic: TOPIC, noBranch: false }, {}, () => r));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "perform-branches.tsv"), "utf8")).toBe("main\tfeat/perform-add-oauth\n");
    expect(readFileSync(join(art, "branch-base.sha"), "utf8")).toBe("ABC\n");
  });

  it("--no-branch → records the current branch (symbolic-ref), no checkout -b", async () => {
    const art = seedArt();
    seedTargetCwd(art, "/repo/main");
    let sawCheckoutB = false;
    const r: Runner = {
      run(cmd, args) {
        const key = [cmd, ...args].join(" ");
        if (key === "git checkout -q -b feat/perform-add-oauth") sawCheckoutB = true;
        if (key === "git symbolic-ref --short HEAD") return { code: 0, stdout: "develop\n" };
        return { code: 0, stdout: "" };
      },
    };
    const { rc } = await capture(() => branchWith({ topic: TOPIC, noBranch: true }, {}, () => r));
    expect(rc).toBe(0);
    expect(sawCheckoutB).toBe(false);
    expect(readFileSync(join(art, "perform-branches.tsv"), "utf8")).toBe("main\tdevelop\n");
  });

  it("--branch=custom (ref absent) → records custom", async () => {
    const art = seedArt();
    seedTargetCwd(art, "/repo/main");
    const r = fakeRunner({
      "git show-ref --verify --quiet refs/heads/custom": { code: 1, stdout: "" },
      "git checkout -q -b custom": { code: 0, stdout: "" },
    });
    const { rc } = await capture(() => branchWith({ topic: TOPIC, noBranch: false, branchName: "custom" }, {}, () => r));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "perform-branches.tsv"), "utf8")).toBe("main\tcustom\n");
  });
});

describe("perform scope-check", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  function seedScope(art: string): void {
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"),
      "# d\n\n## Components\n\n| File | Note |\n| --- | --- |\n| `src/a.ts` | x |\n");
  }

  it("missing inputs → rc 1", async () => {
    seedArt(); // no target_cwd.txt / branch-base.sha
    const { rc } = await capture(() => scopeCheckWith2(TOPIC, () => fakeRunner({})));
    expect(rc).toBe(1);
  });

  it("one out-of-scope path → scope-out-of-scope.txt + OOS_COUNT=1, rc 0", async () => {
    const art = seedArt();
    seedScope(art);
    const r = fakeRunner({
      "git diff --name-only BASE..HEAD": { code: 0, stdout: "src/a.ts\nsrc/rogue.ts\n" },
    });
    const { rc, out } = await capture(() => scopeCheckWith2(TOPIC, () => r));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "scope-out-of-scope.txt"), "utf8")).toBe("src/rogue.ts\n");
    expect(out).toContain("OOS_COUNT=1\n");
    expect(out).toContain(`OOS_PATH=${join(art, "scope-out-of-scope.txt")}\n`);
  });

  it("all in scope → OOS_COUNT=0, empty oos file, rc 0", async () => {
    const art = seedArt();
    seedScope(art);
    const r = fakeRunner({ "git diff --name-only BASE..HEAD": { code: 0, stdout: "src/a.ts\n" } });
    const { rc, out } = await capture(() => scopeCheckWith2(TOPIC, () => r));
    expect(rc).toBe(0);
    expect(out).toContain("OOS_COUNT=0\n");
    expect(readFileSync(join(art, "scope-out-of-scope.txt"), "utf8")).toBe("");
  });
});

describe("perform finish", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  function seedFinish(art: string): void {
    seedTargetCwd(art, "/repo/main");
    writeFileSync(join(art, "perform-branches.tsv"), "main\tfeat/perform-foo\n");
    mkdirSync(join(art, "baselines"), { recursive: true });
    writeFileSync(join(art, "baselines", "main.tsv"), "slug=main\ncwd=/repo/main\nbranch=main\n");
  }

  it("art-dir missing → rc 1", async () => {
    const { rc } = await capture(() => finishWith2(TOPIC, "merge", () => fakeRunner({}), false));
    expect(rc).toBe(1);
  });

  it("bad action → rc 2 (rejected by finishRun before reaching finishWith)", async () => {
    const { rc } = await capture(() => run(["finish", TOPIC, "bogus"]));
    expect(rc).toBe(2);
  });

  it("merge action: show-ref ok + merge ok → finish-results.tsv === main\\tmerge\\tmerged, rc 0", async () => {
    const art = seedArt();
    seedFinish(art);
    const r = fakeRunner({
      "git show-ref --verify --quiet refs/heads/feat/perform-foo": { code: 0, stdout: "" },
      "git checkout -q main": { code: 0, stdout: "" },
      "git merge --no-edit -q feat/perform-foo": { code: 0, stdout: "" },
      "git branch -q -D feat/perform-foo": { code: 0, stdout: "" },
    });
    const { rc } = await capture(() => finishWith2(TOPIC, "merge", () => r, false));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "finish-results.tsv"), "utf8")).toBe("main\tmerge\tmerged\n");
  });
});

describe("perform archive (real archiveTopic under CONSORT_HOME)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  it("moves _perform under the archive root, rc 0", async () => {
    const art = seedArt(); // <topicDir>/_perform
    // seed a sibling part dir with a status.json so finalizeArchived has something to touch.
    const partDir = join(performTopicDir(TOPIC), "cody-codex");
    mkdirSync(partDir, { recursive: true });
    writeFileSync(join(partDir, "status.json"), '{"state":"done"}');
    writeFileSync(join(art, "topic.txt"), TOPIC);
    const { rc } = await capture(() => archiveRun([TOPIC]));
    expect(rc).toBe(0);
    expect(existsSync(art)).toBe(false); // _perform moved away
  });

  it("missing topic → rc 2", async () => {
    const { rc } = await capture(() => archiveRun([]));
    expect(rc).toBe(2);
  });
});

describe("perform summary", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => { h.cleanup(); });

  it("clean tree → block printed, posts/main.tsv state=no-leftovers, rc 0", async () => {
    const art = seedArt();
    // real-ish cwd dir (must be a directory for isDir guard).
    const cwd = join(h.home, "repo-main");
    mkdirSync(cwd, { recursive: true });
    seedTargetCwd(art, cwd);
    mkdirSync(join(art, "baselines"), { recursive: true });
    writeFileSync(join(art, "baselines", "main.tsv"),
      `slug=main\ncwd=${cwd}\nbranch=main\nbaseline_sha=ABC\nstate=clean\nsnapshot_ts=2026-05-30T00:00:00Z\n`);
    const r = fakeRunner({
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main\n" },
      "git status --porcelain": { code: 0, stdout: "" },          // empty → no-leftovers
      "git rev-parse HEAD": { code: 0, stdout: "DEF\n" },
      "git diff --shortstat ABC..HEAD": { code: 0, stdout: "" },
      "git log --reverse --oneline ABC..HEAD": { code: 0, stdout: "" },
    });
    const { rc, out } = await capture(() => summaryWith2(TOPIC, () => r, () => "2026-05-30T01:00:00Z"));
    expect(rc).toBe(0);
    expect(out).toContain(`=== main [${cwd}] ===`);
    const post = readFileSync(join(art, "posts", "main.tsv"), "utf8");
    expect(post).toContain("state=no-leftovers\n");
    expect(post).toContain("branch=main\n");
    expect(post).toContain("post_sha=DEF\n");
  });
});

// ---- thin wrappers that adapt the {runnerFor,...} Deps shape to the test's runnerFor callback. ----
async function scopeCheckWith2(topic: string, runnerFor: (cwd: string) => Runner): Promise<number> {
  return scopeCheckWith(topic, { runnerFor });
}
async function summaryWith2(topic: string, runnerFor: (cwd: string) => Runner, now: () => string): Promise<number> {
  return summaryWith(topic, { runnerFor, now });
}
async function finishWith2(topic: string, action: "merge" | "pr" | "keep" | "discard", runnerFor: (cwd: string) => Runner, hasGh: boolean): Promise<number> {
  return finishWith(topic, action, { runnerFor, hasGh });
}
