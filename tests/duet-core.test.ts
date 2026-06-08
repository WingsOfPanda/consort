// tests/duet-core.test.ts
import { describe, it, expect } from "vitest";
import { parseDuetArgs, deriveSlug, duetArtDir, duetExecDir } from "../src/core/duet.js";

describe("parseDuetArgs", () => {
  it("captures --repo (value flag), --provider, --in-place; rest is the verbatim task", () => {
    const a = parseDuetArgs(["--repo", "/abs/repoB", "--provider", "claude", "--in-place", "wire up", "the", "thing"]);
    expect(a.repo).toBe("/abs/repoB");
    expect(a.provider).toBe("claude");
    expect(a.inPlace).toBe(true);
    expect(a.taskText).toBe("wire up the thing");
  });
  it("supports --repo=… and --provider=… inline forms; default no in-place, no provider", () => {
    const a = parseDuetArgs(["--repo=/x", "--provider=codex", "do it"]);
    expect(a.repo).toBe("/x");
    expect(a.provider).toBe("codex");
    expect(a.inPlace).toBe(false);
    expect(a.taskText).toBe("do it");
  });
  it("a bare --repo with no value leaves repo undefined and does not eat the task", () => {
    const a = parseDuetArgs(["--repo", "--provider", "codex", "task here"]);
    expect(a.repo).toBeUndefined();
    expect(a.taskText).toBe("task here");
  });
});

describe("duet path helpers", () => {
  it("art dir is _duet under the topic dir; exec is execute under that", () => {
    const art = duetArtDir("my-topic");
    expect(art.endsWith("/my-topic/_duet")).toBe(true);
    expect(duetExecDir("my-topic")).toBe(art + "/execute");
  });
  it("re-exports deriveSlug (single slug algorithm)", () => {
    expect(deriveSlug("Add OAuth Login!")).toBe("add-oauth-login");
  });
});

import { renderDuetSummary, renderDuetResume } from "../src/core/duet.js";

describe("renderDuetResume", () => {
  it("records repo B, branch+mode, last round, task, and a restore pointer (no auto-resume)", () => {
    const md = renderDuetResume({
      topic: "t", repo: "/abs/repoB", branch: "feat/duet-t", mode: "branch",
      lastRound: 3, task: "do the thing", phase: "round", gate: "round-wait",
    });
    expect(md).toContain("# RESUME — t (aborted at round.round-wait)");
    expect(md).toContain("/abs/repoB");
    expect(md).toContain("feat/duet-t");
    expect(md).toContain("Last round: 3");
    expect(md).toContain("do the thing");
    expect(md).toMatch(/cannot auto-resume/i);
  });
});

describe("renderDuetSummary", () => {
  it("emits a command: duet frontmatter and the cross-repo facts", () => {
    const md = renderDuetSummary({
      topic: "t", status: "ok", started: "s", ended: "e", duration: 5,
      provider: "codex", instrument: "viola", repo: "/abs/repoB", mode: "branch",
      branch: "feat/duet-t", rounds: 4, verify: "PASS", diffStats: "1 file",
      archived: "/arch", finishResult: "pr\tpr-opened",
    });
    expect(md).toMatch(/^---\ncommand: duet\n/);
    expect(md).toContain("/abs/repoB");
    expect(md).toContain("rounds: 4");
  });
});
