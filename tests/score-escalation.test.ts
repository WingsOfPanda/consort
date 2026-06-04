// tests/score-escalation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir } from "../src/core/paths.js";
import { outboxPath } from "../src/core/ipc.js";
import { researchSendWith, researchWaitWith, diffRun, spawnAllWith, verifySendWith, verifyWaitWith, adjudicateRun, synthesizeRun, walkStateRun, detectMultiRepoRun, emitDagRun, checkDagRun, drilldownWith, forensicsRun, archiveRun } from "../src/commands/score.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

/** Seed a minimal initialised topic: _score/topic.txt + roster.txt. */
function seedTopic(topic: string, rows: Array<{ provider: string; instrument: string }>): string {
  const art = scoreArtDir(topic);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "topic.txt"), topic.replace(/-/g, " "));
  writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
  return art;
}

describe("score research-send", () => {
  it("writes the prompt + OFFSET state, then calls send (rc 0)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const calls: string[][] = [];
    const rc = await researchSendWith("cache-policy", "viola", "codex", {
      offsetFor: () => 42,
      send: async (args) => { calls.push(args); return 0; },
    });
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toBe("OFFSET=42\n");
    const prompt = readFileSync(join(art, "viola_research_prompt.md"), "utf8");
    expect(prompt).toContain("## Claims");
    expect(prompt).toContain(join(partDir("viola", "codex", "cache-policy"), "findings.md"));
    expect(calls[0]).toEqual(["--from", "maestro", "viola", "cache-policy", `@${join(art, "viola_research_prompt.md")}`]);
  });

  it("refuses if the state file already exists (rc 1)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=0\n");
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 0, send: async () => 0 });
    expect(rc).toBe(1);
  });

  it("send failure keeps the state file and returns rc 1", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 7, send: async () => 1 });
    expect(rc).toBe(1);
    expect(existsSync(join(art, "research-viola.txt"))).toBe(true);
  });
});

describe("score research-wait", () => {
  function seedState(topic: string, instrument: string, provider: string, offset = 0): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, `research-${instrument}.txt`), `OFFSET=${offset}\n`);
    mkdirSync(partDir(instrument, provider, topic), { recursive: true });
    return art;
  }
  const dep = (ev: any, mult = "1.0") => ({ wait: async () => ev, multiplier: () => mult });

  it("done + cited findings → FS=ok + .done sentinel (rc 0)", async () => {
    const art = seedState("t", "viola", "codex");
    writeFileSync(join(partDir("viola", "codex", "t"), "findings.md"), "## Claims\n1. [a:1] x\n");
    const rc = await researchWaitWith("t", "viola", "codex", dep({ event: "done", summary: "ok" }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=ok");
    expect(existsSync(join(art, "research-viola.done"))).toBe(true);
  });

  it("done with no findings.md → FS=missing", async () => {
    const art = seedState("t", "viola", "codex");
    await researchWaitWith("t", "viola", "codex", dep({ event: "done", summary: "ok" }));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=missing");
  });

  it("timeout (null) → FS=timeout; error → FS=failed", async () => {
    const art = seedState("t", "viola", "codex");
    await researchWaitWith("t", "viola", "codex", dep(null));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=timeout");
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=0\n"); // reset
    await researchWaitWith("t", "viola", "codex", dep({ event: "error", reason: "x" }));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=failed");
  });

  it("question → captures payload, appends bumped OFFSET + FS=question", async () => {
    const art = seedState("t", "viola", "codex", 5);
    writeFileSync(outboxPath("viola", "codex", "t"), "0123456789ABC"); // size 13 → bumped offset
    await researchWaitWith("t", "viola", "codex", dep({ event: "question", message: "which db?" }));
    const state = readFileSync(join(art, "research-viola.txt"), "utf8");
    expect(state).toContain("FS=question");
    expect(state).toMatch(/OFFSET=13/); // bumped to current outbox size
    expect(readFileSync(join(art, "question-viola.txt"), "utf8")).toContain("which db?");
  });

  it("missing state file → rc 1", async () => {
    mkdirSync(scoreArtDir("t"), { recursive: true });
    expect(await researchWaitWith("t", "viola", "codex", dep(null))).toBe(1);
  });
});

describe("score diff", () => {
  function seedFindings(topic: string, rows: Array<{ provider: string; instrument: string; findings: string }>): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
    for (const r of rows) {
      mkdirSync(partDir(r.instrument, r.provider, topic), { recursive: true });
      writeFileSync(join(partDir(r.instrument, r.provider, topic), "findings.md"), r.findings);
    }
    return art;
  }

  it("N=2: writes diff.md + two *_only_items.txt (rc 0)", async () => {
    const art = seedFindings("t", [
      { provider: "codex", instrument: "viola", findings: "## Claims\n1. [a:1] shared\n2. [b:1] viola-only\n" },
      { provider: "claude", instrument: "cello", findings: "## Claims\n1. [a:1] shared\n3. [c:1] cello-only\n" },
    ]);
    const rc = await diffRun(["t"]);
    expect(rc).toBe(0);
    expect(existsSync(join(art, "diff.md"))).toBe(true);
    expect(existsSync(join(art, "viola_only_items.txt"))).toBe(true);
    expect(existsSync(join(art, "cello_only_items.txt"))).toBe(true);
    expect(readFileSync(join(art, "diff.md"), "utf8")).toContain("## Agreed");
  });

  it("refuses if diff.md already exists (rc 1)", async () => {
    const art = seedFindings("t", [
      { provider: "codex", instrument: "viola", findings: "## Claims\n1. [a:1] x\n" },
      { provider: "claude", instrument: "cello", findings: "## Claims\n1. [a:1] x\n" },
    ]);
    writeFileSync(join(art, "diff.md"), "stale\n");
    expect(await diffRun(["t"])).toBe(1);
  });

  it("missing a part's findings.md → rc 1", async () => {
    const art = scoreArtDir("t");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), "codex\tviola\nclaude\tcello\n");
    mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    writeFileSync(join(partDir("viola", "codex", "t"), "findings.md"), "## Claims\n1. [a:1] x\n");
    expect(await diffRun(["t"])).toBe(1); // cello findings.md absent
  });
});

describe("score spawn-all", () => {
  function seedRoster(topic: string, rows: Array<{ provider: string; instrument: string }>): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
    return art;
  }
  // fake preflight writes the panes file the way the real one does
  const fakePreflight = (art: string, rows: Array<{ instrument: string }>) => async (_args: string[]) => {
    writeFileSync(join(art, "preflight-panes.txt"), rows.map((r, i) => `${r.instrument}\t%${i + 1}`).join("\n") + "\n");
    return 0;
  };

  it("all parts ok → spawn-results.tsv + rc 0; preflight gets the i:p roster arg", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const art = seedRoster("t", rows);
    const pfArgs: string[][] = [];
    const spawnArgs: string[][] = [];
    const rc = await spawnAllWith("t", {
      preflight: async (a) => { pfArgs.push(a); return fakePreflight(art, rows)(a); },
      spawn: async (a) => { spawnArgs.push(a); return 0; },
      repoRoot: () => "/repo",
    });
    expect(rc).toBe(0);
    expect(pfArgs[0]).toContain("--roster");
    expect(pfArgs[0][pfArgs[0].indexOf("--roster") + 1]).toBe("viola:codex,cello:claude");
    expect(readFileSync(join(art, "spawn-results.tsv"), "utf8")).toBe("viola\tcodex\t0\t\ncello\tclaude\t0\t\n");
    expect(spawnArgs.every((a) => a.includes("--target-pane") && a.includes("--cwd") && a.includes("/repo"))).toBe(true);
  });

  it("partial failure → rc 1", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const art = seedRoster("t", rows);
    const rc = await spawnAllWith("t", {
      preflight: fakePreflight(art, rows),
      spawn: async (a) => (a[0] === "cello" ? 1 : 0),
      repoRoot: () => "/repo",
    });
    expect(rc).toBe(1);
    expect(readFileSync(join(art, "spawn-results.tsv"), "utf8")).toContain("cello\tclaude\t1\tspawn-failed");
  });

  it("preflight failure → rc 2 (no spawns)", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    seedRoster("t", rows);
    let spawned = 0;
    const rc = await spawnAllWith("t", { preflight: async () => 1, spawn: async () => { spawned++; return 0; }, repoRoot: () => "/repo" });
    expect(rc).toBe(2);
    expect(spawned).toBe(0);
  });

  it("roster with <2 parts → rc 2", async () => {
    seedRoster("t", [{ provider: "codex", instrument: "viola" }]);
    expect(await spawnAllWith("t", { preflight: async () => 0, spawn: async () => 0, repoRoot: () => "/repo" })).toBe(2);
  });
});

describe("score verify-send", () => {
  function seedV(topic: string, rows: Array<{ provider: string; instrument: string }>, buckets: Record<string, string>): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
    writeFileSync(join(art, "topic.txt"), topic);
    for (const [f, c] of Object.entries(buckets)) writeFileSync(join(art, f), c);
    return art;
  }
  const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];

  it("N=2: scope = other's bucket; composes + sends (rc 0)", async () => {
    const art = seedV("t", rows, { "viola_only_items.txt": "[a:1] vc\n", "cello_only_items.txt": "[b:2] cc\n" });
    const calls: string[][] = [];
    const rc = await verifySendWith("t", "viola", "codex", { offsetFor: () => 7, send: async (a) => { calls.push(a); return 0; } });
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "verify-claims-viola.txt"), "utf8")).toContain("[b:2] cc"); // cello's, not viola's
    expect(readFileSync(join(art, "verify-viola.txt"), "utf8")).toBe("OFFSET=7\n");
    expect(calls[0]).toContain("@" + join(art, "viola_verify_prompt.md"));
  });

  it("empty scope → VS=skipped, no send (rc 0)", async () => {
    const art = seedV("t", rows, { "viola_only_items.txt": "", "cello_only_items.txt": "" });
    let sent = 0;
    const rc = await verifySendWith("t", "cello", "claude", { offsetFor: () => 0, send: async () => { sent++; return 0; } });
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "verify-cello.txt"), "utf8")).toBe("VS=skipped\n");
    expect(sent).toBe(0);
  });

  it("refuses if verify-<inst>.txt exists (rc 1)", async () => {
    const art = seedV("t", rows, { "viola_only_items.txt": "x\n", "cello_only_items.txt": "y\n" });
    writeFileSync(join(art, "verify-viola.txt"), "OFFSET=0\n");
    expect(await verifySendWith("t", "viola", "codex", { offsetFor: () => 0, send: async () => 0 })).toBe(1);
  });
});

describe("score verify-wait", () => {
  function seedVw(topic: string, instrument: string, provider: string, body: string): string {
    const art = scoreArtDir(topic); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, `verify-${instrument}.txt`), body);
    mkdirSync(partDir(instrument, provider, topic), { recursive: true });
    return art;
  }
  const dep = (ev: any) => ({ wait: async () => ev, multiplier: () => "1.0" });

  it("VS=skipped short-circuit: writes .done, no wait (rc 0)", async () => {
    const art = seedVw("t", "viola", "codex", "VS=skipped\n");
    let waited = 0;
    const rc = await verifyWaitWith("t", "viola", "codex", { wait: async () => { waited++; return null; }, multiplier: () => "1.0" });
    expect(rc).toBe(0); expect(waited).toBe(0);
    expect(existsSync(join(art, "verify-viola.done"))).toBe(true);
  });

  it("done + non-empty verify.md → VS=ok", async () => {
    const art = seedVw("t", "viola", "codex", "OFFSET=0\n");
    writeFileSync(join(partDir("viola", "codex", "t"), "verify.md"), "## Verdicts\n1. AGREE [a:1] x\n");
    await verifyWaitWith("t", "viola", "codex", dep({ event: "done", summary: "ok" }));
    expect(readFileSync(join(art, "verify-viola.txt"), "utf8")).toContain("VS=ok");
  });

  it("question → bumped OFFSET + VS=question + payload", async () => {
    const art = seedVw("t", "viola", "codex", "OFFSET=3\n");
    writeFileSync(outboxPath("viola", "codex", "t"), "0123456789"); // size 10
    await verifyWaitWith("t", "viola", "codex", dep({ event: "question", message: "scope?" }));
    const s = readFileSync(join(art, "verify-viola.txt"), "utf8");
    expect(s).toContain("VS=question"); expect(s).toMatch(/OFFSET=10/);
    expect(readFileSync(join(art, "question-viola.txt"), "utf8")).toContain("scope?");
  });
});

describe("score adjudicate", () => {
  it("N=2: writes adjudicated-draft.md with the 4 sections; leaves adjudicated.md untouched", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), "codex\tviola\nclaude\tcello\n");
    writeFileSync(join(art, "viola_only_items.txt"), "[a:1] viola claim\n");
    writeFileSync(join(art, "cello_only_items.txt"), "[b:2] cello claim\n");
    for (const [inst, prov] of [["viola", "codex"], ["cello", "claude"]]) {
      mkdirSync(partDir(inst, prov, "t"), { recursive: true });
      writeFileSync(join(partDir(inst, prov, "t"), "verify.md"), "## Verdicts\n1. AGREE [b:2] cello claim\n   confirmed\n");
      writeFileSync(join(art, `verify-${inst}.txt`), "OFFSET=0\nVS=ok\n");
    }
    const rc = await adjudicateRun(["t"]);
    expect(rc).toBe(0);
    const draft = readFileSync(join(art, "adjudicated-draft.md"), "utf8");
    expect(draft).toContain("## Cross-verified");
    expect(draft).toContain("## Adjudicated");
    expect(draft).toContain("## Contested");
    expect(draft).toContain("## Not-verified");
    expect(existsSync(join(art, "adjudicated.md"))).toBe(false);
  });
});

describe("score synthesize", () => {
  it("refuses when adjudicated.md missing (rc 1)", async () => {
    mkdirSync(scoreArtDir("t"), { recursive: true });
    expect(await synthesizeRun(["t"])).toBe(1);
  });
  it("refuses while a '- PENDING:' line remains (rc 1)", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "adjudicated.md"), "## Cross-verified\n- PENDING: [a:1] x\n");
    expect(await synthesizeRun(["t"])).toBe(1);
  });
  it("seeds the 6 .draft/*.md (rc 0)", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc", ".draft"), { recursive: true });
    writeFileSync(join(art, "adjudicated.md"), "## Cross-verified\n- [Goal] ship it [a:1]\n");
    expect(await synthesizeRun(["t"])).toBe(0);
    expect(readFileSync(join(art, "design-doc", ".draft", "goal.md"), "utf8")).toContain("[Goal] ship it");
    expect(existsSync(join(art, "design-doc", ".draft", "success-criteria.md"))).toBe(true);
  });
});

describe("score walk-state", () => {
  it("prints section\\tstatus (skipped detected) to stdout", async () => {
    const dd = join(scoreArtDir("t"), "design-doc", ".draft"); mkdirSync(dd, { recursive: true });
    writeFileSync(join(dd, "goal.md"), "## Goal\n\nship it\n");
    writeFileSync(join(dd, "problem.md"), "_(skipped)_");
    let out = ""; const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try { await walkStateRun(["t"]); } finally { (process.stdout as any).write = orig; }
    expect(out).toContain("goal\tapproved");
    expect(out).toContain("problem\tskipped");
  });
});

describe("score detect-multi-repo", () => {
  it("emits TSV hits for sibling dirs whose slug substring-matches the corpus", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "adjudicated.md"), "## Cross-verified\n- [x] touches api and web modules\n");
    const hub = mkdtempSync(join(tmpdir(), "hub-"));
    for (const s of ["api", "web"]) { mkdirSync(join(hub, s)); writeFileSync(join(hub, s, "CLAUDE.md"), "x\n"); }
    mkdirSync(join(hub, "zzz")); writeFileSync(join(hub, "zzz", "CLAUDE.md"), "x\n");
    let out = ""; const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try { await detectMultiRepoRun(["t", "--cwd", hub]); } finally { (process.stdout as any).write = orig; }
    expect(out).toContain("api\t");
    expect(out).toContain("web\t");
    expect(out).not.toContain("zzz\t"); // slug not in corpus
  });
});

describe("score drilldown", () => {
  it("dispatches K=1, writes a non-empty file → rc 0; resolves the scratch path", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n");
    mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    const sends: string[][] = [];
    const rc = await drilldownWith(
      ["t", "Architecture", dd, "", join(art, "doc.md"), "viola", "codex"],
      { offsetFor: () => 0, send: async (a) => { sends.push(a); // simulate the part writing its drill file
          a[a.length - 1].slice(1); /* @<promptfile> not the out path */ return 0; },
        wait: async () => ({ event: "done" }), multiplier: () => "1.0" },
      { writeProbe: (p: string) => writeFileSync(p, "notes\n") }, // test hook: create the out file the part would write
    );
    expect(rc).toBe(0);
    expect(sends[0]).toContain("--from"); expect(sends[0]).toContain("maestro");
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-viola.md"))).toBe(true);
  });
  it("all-empty round → rc 1; bad arg count → rc 2", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n"); mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    const rc = await drilldownWith(["t", "Arch", dd, "", join(art, "doc.md"), "viola", "codex"],
      { offsetFor: () => 0, send: async () => 0, wait: async () => ({ event: "done" }), multiplier: () => "1.0" }, {});
    expect(rc).toBe(1); // no file written
    expect(await drilldownWith(["t", "Arch"], { offsetFor: () => 0, send: async () => 0, wait: async () => null, multiplier: () => "1.0" }, {})).toBe(2);
  });
  it("n=8 (subproject only) → K=1, subproject flows into the resolved path", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n"); mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    const sends: string[][] = [];
    const rc = await drilldownWith(
      ["t", "Architecture", dd, "", join(art, "doc.md"), "viola", "codex", "apisub"],
      { offsetFor: () => 0, send: async (a) => { sends.push(a); return 0; },
        wait: async () => ({ event: "done" }), multiplier: () => "1.0" },
      { writeProbe: (p: string) => writeFileSync(p, "notes\n") },
    );
    expect(rc).toBe(0);
    expect(sends.length).toBe(1); // subproject is rest[7], NOT a second part
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-viola.md"))).toBe(true);
  });
  it("n=10 (i2 m2 subproject) → K=2 parts, both files carry the subproject", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n");
    mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    mkdirSync(partDir("cello", "gemini", "t"), { recursive: true });
    const sends: string[][] = [];
    const rc = await drilldownWith(
      ["t", "Architecture", dd, "", join(art, "doc.md"), "viola", "codex", "cello", "gemini", "apisub"],
      { offsetFor: () => 0, send: async (a) => { sends.push(a); return 0; },
        wait: async () => ({ event: "done" }), multiplier: () => "1.0" },
      { writeProbe: (p: string) => writeFileSync(p, "notes\n") },
    );
    expect(rc).toBe(0);
    expect(sends.length).toBe(2); // i2=cello parsed as a second part
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-viola.md"))).toBe(true);
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-cello.md"))).toBe(true);
  });
});

describe("score forensics + archive", () => {
  it("forensics prints a path when there are findings, else empty (rc 0)", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc"), { recursive: true });
    writeFileSync(join(art, "design-doc", "audit.log"), "ISSUE=no_goal_section\n");
    let out = ""; const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    let rc = 0; try { rc = await forensicsRun(["t"]); } finally { (process.stdout as any).write = orig; }
    expect(rc).toBe(0);
    expect(out).toMatch(/forensics[/\\]2\d{3}-\d\d-\d\d[/\\].*-score-t\.md/);
  });
  it("archive moves _score and rmdirs the topic (rc 0)", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc"), { recursive: true });
    writeFileSync(join(art, "topic.txt"), "t");
    expect(await archiveRun(["t"])).toBe(0);
    expect(existsSync(art)).toBe(false); // moved to archive
  });
});

describe("score emit-dag + check-dag", () => {
  it("emit-dag renders dag-rows.tsv to the execution-dag draft; check-dag passes it", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc", ".draft"), { recursive: true });
    writeFileSync(join(art, "dag-rows.tsv"), "1\tapi\tbuild the API\tnone\n2\tweb\tship the web app\t1\n");
    expect(await emitDagRun(["t"])).toBe(0);
    const draft = readFileSync(join(art, "design-doc", ".draft", "execution-dag.md"), "utf8");
    expect(draft).toMatch(/^## Execution DAG\n/);
    expect(draft).toContain("1. api — build the API");
    expect(draft).toContain("2. web — ship the web app (depends on 1)");
    expect(await checkDagRun(["t"])).toBe(0); // conformant
  });
  it("check-dag rc 1 + malformed line when the draft uses a hyphen", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc", ".draft"), { recursive: true });
    writeFileSync(join(art, "design-doc", ".draft", "execution-dag.md"), "## Execution DAG\n\n1. api - bad dash\n");
    const errs: string[] = []; const s = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (x: string) => { errs.push(String(x)); return true; };
    let rc = 0; try { rc = await checkDagRun(["t"]); } finally { (process.stderr as any).write = s; }
    expect(rc).toBe(1);
    expect(errs.join("")).toContain("1. api - bad dash");
  });
});
